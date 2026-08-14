// Repo health: the D1 (responsiveness) and part of D3 (approachability) inputs.
//
// This is the expensive pass, so it runs ONLY over repos that have at least one
// surviving issue — typically a few hundred, not the thousands we harvested.
// Results are cached in state/repo-health.json with a 7-day TTL, because
// responsiveness moves on the scale of weeks, not hours.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { GitHubClient } from '../m0/lib/gh.mjs'

const STATE = new URL('../state/', import.meta.url)
const CACHE_FILE = new URL('repo-health.json', STATE)
const TTL_DAYS = 7
const BATCH = 5 // heavy query; small batches stay under the resource limit

const HEALTH_FIELDS = /* GraphQL */ `
  nameWithOwner
  ci: object(expression: "HEAD:.github/workflows") { ... on Tree { entries { name } } }
  tests: object(expression: "HEAD:tests") { __typename }
  testDir: object(expression: "HEAD:test") { __typename }
  pullRequests(
    states: [MERGED, CLOSED, OPEN]
    first: 25
    orderBy: { field: CREATED_AT, direction: DESC }
  ) {
    nodes {
      state
      authorAssociation
      createdAt
      mergedAt
      closedAt
      comments(first: 5) { nodes { authorAssociation createdAt } }
    }
  }
  recentIssues: issues(
    states: [CLOSED, OPEN]
    first: 20
    orderBy: { field: CREATED_AT, direction: DESC }
  ) {
    nodes {
      createdAt
      comments(first: 5) { nodes { authorAssociation createdAt } }
    }
  }
`

function batchQuery(repos) {
  const aliases = repos
    .map((full, i) => {
      const [owner, name] = full.split('/')
      return `  h${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${HEALTH_FIELDS} }`
    })
    .join('\n')
  return `query Health {\n  rateLimit { cost remaining resetAt }\n${aliases}\n}`
}

const OUTSIDER = (assoc) => !['OWNER', 'MEMBER', 'COLLABORATOR'].includes(assoc)
const HOUR = 3600_000

/** Turn one repository payload into the health metrics D1/D3 consume. */
export function computeHealth(r, now = Date.now()) {
  const prs = r.pullRequests?.nodes ?? []
  const outsider = prs.filter((p) => OUTSIDER(p.authorAssociation))
  const decided = outsider.filter((p) => p.state !== 'OPEN')
  const merged = outsider.filter((p) => p.state === 'MERGED')

  // A PR open >90 days with no maintainer comment is the clearest sign that
  // contributing here wastes your time.
  const rottingPRs = outsider.filter((p) => {
    if (p.state !== 'OPEN') return false
    const ageDays = (now - new Date(p.createdAt).getTime()) / 86400_000
    if (ageDays < 90) return false
    return !(p.comments?.nodes ?? []).some((c) => !OUTSIDER(c.authorAssociation))
  }).length

  // Time from issue/PR creation to the first maintainer reply.
  const responseTimes = []
  for (const item of [...(r.recentIssues?.nodes ?? []), ...prs]) {
    const first = (item.comments?.nodes ?? []).find((c) => !OUTSIDER(c.authorAssociation))
    if (!first) continue
    const hours = (new Date(first.createdAt) - new Date(item.createdAt)) / HOUR
    if (hours >= 0 && hours < 24 * 365) responseTimes.push(hours)
  }

  return {
    computedAt: new Date(now).toISOString(),
    outsiderPRs: decided.length,
    outsiderMergeRate: decided.length ? merged.length / decided.length : null,
    mergedCount: merged.length,
    rottingPRs,
    medianResponseHours: responseTimes.length >= 3 ? Math.round(median(responseTimes)) : null,
    responseSamples: responseTimes.length,
    hasCI: (r.ci?.entries?.length ?? 0) > 0,
    hasTests: Boolean(r.tests || r.testDir),
  }
}

export async function fetchHealth(repoNames, { client = new GitHubClient() } = {}) {
  const cache = await loadCache()
  const now = Date.now()
  const stale = repoNames.filter((n) => {
    const c = cache[n]
    if (!c) return true
    return (now - new Date(c.computedAt).getTime()) / 86400_000 > TTL_DAYS
  })

  console.log(`  health: ${repoNames.length} repos, ${stale.length} need refresh`)

  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = stale.slice(i, i + BATCH)
    try {
      const data = await client.graphql(batchQuery(batch))
      batch.forEach((name, j) => {
        const r = data[`h${j}`]
        if (r) cache[name] = computeHealth(r, now)
      })
    } catch (e) {
      if (e.code === 'RESOURCE_LIMIT') {
        for (const one of batch) {
          try {
            const d = await client.graphql(batchQuery([one]))
            if (d.h0) cache[one] = computeHealth(d.h0, now)
          } catch { /* leave uncached; D1 falls back to activity proxies */ }
        }
      } else {
        console.warn(`  ⚠ health batch ${i} failed: ${e.message.slice(0, 100)}`)
      }
    }
    process.stdout.write(`\r  health: ${Math.min(i + BATCH, stale.length)}/${stale.length}`)
  }
  if (stale.length) process.stdout.write('\n')

  await mkdir(STATE, { recursive: true })
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2))
  return cache
}

async function loadCache() {
  try {
    return JSON.parse(await readFile(CACHE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
