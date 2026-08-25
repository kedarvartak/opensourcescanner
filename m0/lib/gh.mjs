// GitHub GraphQL client for the M0 spike.
//
// Implements the rate discipline from docs/03:
//   - 5,000 points/hour primary limit, cost measured per query (never assumed)
//   - secondary limits honoured via retry-after
//   - exponential backoff on 5xx / transient GraphQL errors
//
// Zero dependencies: native fetch, Node >= 20.

import { execSync } from 'node:child_process'

const ENDPOINT = 'https://api.github.com/graphql'

/** Resolve a token: explicit env first, then the gh CLI's stored credential. */
export function resolveToken() {
  const fromEnv = process.env.GH_HARVEST_TOKEN || process.env.GITHUB_TOKEN
  if (fromEnv) return fromEnv
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim()
  } catch {
    throw new Error(
      'No GitHub token. Set GH_HARVEST_TOKEN, or run `gh auth login`.'
    )
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class GitHubClient {
  constructor(token = resolveToken()) {
    this.token = token
    this.pointsSpent = 0
    this.requests = 0
    this.lastRateLimit = null
  }

  /**
   * Execute a GraphQL query with retries.
   * Returns `data`; throws only on non-recoverable errors.
   */
  async graphql(query, variables = {}, { retries = 5 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `bearer ${this.token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'opensourcescanner.xyz-m0-spike',
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(60_000),
        })
      } catch (err) {
        // Socket resets and timeouts are routine on long harvests — retry, don't die.
        if (attempt === retries) throw new Error(`Network: ${err.message}`)
        console.warn(`  ⚠  network error (${err.message}); retrying`)
        await sleep(backoffMs(attempt))
        continue
      }

      this.requests++

      // Secondary rate limit / abuse detection.
      if (res.status === 403 || res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') || 0)
        const reset = Number(res.headers.get('x-ratelimit-reset') || 0)
        const waitMs = retryAfter
          ? retryAfter * 1000
          : reset
            ? Math.max(0, reset * 1000 - Date.now()) + 1000
            : backoffMs(attempt)
        console.warn(`  ⏸  rate limited (${res.status}); waiting ${Math.ceil(waitMs / 1000)}s`)
        await sleep(waitMs)
        continue
      }

      if (res.status >= 500) {
        await sleep(backoffMs(attempt))
        continue
      }

      if (!res.ok) {
        let bodyText = ''
        try {
          bodyText = await res.text()
        } catch (err) {
          if (isTransientNetworkError(err)) {
            if (attempt === retries) throw new Error(`Network: ${err.message}`)
            console.warn(`  ⚠  network error (${err.message}); retrying`)
            await sleep(backoffMs(attempt))
            continue
          }
          throw err
        }
        throw new Error(`GitHub ${res.status}: ${bodyText.slice(0, 400)}`)
      }

      let body
      try {
        body = await res.json()
      } catch (err) {
        if (isTransientNetworkError(err)) {
          if (attempt === retries) throw new Error(`Network: ${err.message}`)
          console.warn(`  ⚠  network error (${err.message}); retrying`)
          await sleep(backoffMs(attempt))
          continue
        }
        throw err
      }

      if (body.errors?.length) {
        const messages = body.errors.map((e) => e.message).join('; ')
        // RATE_LIMITED comes back as a 200 with an error body.
        if (/rate limit/i.test(messages)) {
          const resetAt = body.data?.rateLimit?.resetAt
          const waitMs = resetAt
            ? Math.max(0, new Date(resetAt).getTime() - Date.now()) + 1000
            : 60_000
          console.warn(`  ⏸  primary rate limit; waiting ${Math.ceil(waitMs / 1000)}s`)
          await sleep(waitMs)
          continue
        }
        // "Resource limits for this query exceeded" means the query asked for too
        // many nodes at once. Retrying identically will fail identically — the
        // caller has to shrink the page size, so signal that specifically.
        if (/resource limit/i.test(messages)) {
          const err = new Error('Query too large for GitHub resource limits')
          err.code = 'RESOURCE_LIMIT'
          throw err
        }
        // Partial data with errors is otherwise common on search (e.g. a repo went
        // private mid-query). Keep the data, note it, move on.
        if (body.data) {
          console.warn(`  ⚠  partial result: ${messages.slice(0, 160)}`)
        } else {
          throw new Error(`GraphQL: ${messages.slice(0, 400)}`)
        }
      }

      if (body.data?.rateLimit) {
        this.lastRateLimit = body.data.rateLimit
        this.pointsSpent += body.data.rateLimit.cost ?? 0
        // Slow down before we hit the wall rather than after.
        if (body.data.rateLimit.remaining < 100) {
          const waitMs =
            Math.max(0, new Date(body.data.rateLimit.resetAt).getTime() - Date.now()) + 1000
          console.warn(`  ⏸  ${body.data.rateLimit.remaining} points left; waiting for reset`)
          await sleep(waitMs)
        }
      }

      return body.data
    }
    throw new Error('Exhausted retries')
  }

  stats() {
    return {
      requests: this.requests,
      pointsSpent: this.pointsSpent,
      pointsPerRequest: this.requests ? +(this.pointsSpent / this.requests).toFixed(2) : 0,
      remaining: this.lastRateLimit?.remaining ?? null,
      resetAt: this.lastRateLimit?.resetAt ?? null,
    }
  }
}

function backoffMs(attempt) {
  return Math.min(60_000, 1000 * 2 ** attempt)
}

function isTransientNetworkError(err) {
  if (!(err instanceof Error)) return false
  return /terminated|fetch failed|socket|timed? out|econnreset/i.test(err.message)
}
