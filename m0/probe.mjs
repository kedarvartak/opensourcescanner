#!/usr/bin/env node
// Token probe. Answers one question: will this token actually run the harvest?
//
//   GH_HARVEST_TOKEN=xxx node m0/probe.mjs
//   node m0/probe.mjs            # falls back to `gh auth token`
//
// Exists because "the token authenticates" and "the token can do what the
// harvest needs" are different claims. The harvest doesn't just read issue
// metadata — it reads repository *file contents* (CONTRIBUTING.md, README.md,
// the .github/workflows tree) to score approachability, and that is exactly
// the capability that behaves differently across token types. A token that
// sails through a `viewer { login }` check can still return null for every
// file read, which would silently degrade scoring rather than fail loudly.

import { GitHubClient, resolveToken } from './lib/gh.mjs'

const PROBE = `
query {
  rateLimit { limit remaining cost resetAt }
  viewer { login }
  search(query: "label:\\"good first issue\\" state:open", type: ISSUE, first: 1) {
    issueCount
    nodes {
      ... on Issue {
        number
        title
        repository {
          nameWithOwner
          stargazerCount
          licenseInfo { spdxId }
          contributing: object(expression: "HEAD:CONTRIBUTING.md") { __typename }
          readme: object(expression: "HEAD:README.md") { ... on Blob { byteSize } }
          ci: object(expression: "HEAD:.github/workflows") { ... on Tree { entries { name } } }
        }
      }
    }
  }
}`

const ok = (s) => `  \x1b[32m✓\x1b[0m ${s}`
const bad = (s) => `  \x1b[31m✗\x1b[0m ${s}`

const main = async () => {
  let token
  try {
    token = resolveToken()
  } catch (e) {
    console.error(`\n${bad(e.message)}\n`)
    process.exit(1)
  }

  const kind = token.startsWith('github_pat_')
    ? 'fine-grained PAT'
    : token.startsWith('ghp_')
      ? 'classic PAT'
      : token.startsWith('gho_')
        ? 'OAuth / gh CLI credential'
        : token.startsWith('ghs_')
          ? 'Actions GITHUB_TOKEN'
          : 'unknown'

  console.log(`\n  Token type: ${kind}\n`)

  let data
  try {
    data = await new GitHubClient(token).graphql(PROBE)
  } catch (e) {
    console.error(bad(`GraphQL request failed: ${e.message}`))
    console.error('\n  A classic PAT with NO scopes ticked is the safest token that works.\n')
    process.exit(1)
  }

  const { rateLimit, viewer, search } = data
  const repo = search.nodes[0]?.repository

  console.log(ok(`authenticated as ${viewer.login}`))

  // A token scoped to selected repositories authenticates cleanly and still
  // returns an empty search, because GraphQL search only surfaces repos the
  // token can reach — and this harvest reads repos the owner does not own.
  // Zero results is a hard failure, not a small number.
  const canSee = search.issueCount > 0
  console.log(
    canSee
      ? ok(`search works — ${search.issueCount.toLocaleString('en-US')} matching issues visible`)
      : bad('search returned 0 results — this token cannot see other people\'s public repos')
  )
  if (!canSee) {
    console.error(
      '\n  A token scoped to selected repositories will authenticate, report the full\n' +
      '  5,000/hr ceiling, and harvest nothing. Use a classic PAT with no scopes\n' +
      '  ticked, or a fine-grained PAT with repository access set to\n' +
      '  "Public repositories (read-only)".\n'
    )
    process.exit(1)
  }
  console.log(
    rateLimit.limit >= 5000
      ? ok(`rate limit ${rateLimit.limit}/hr (authenticated ceiling)`)
      : bad(`rate limit only ${rateLimit.limit}/hr — harvest will be throttled`)
  )

  if (!repo) {
    console.log(bad('no repository returned — cannot check file-content reads'))
    process.exit(1)
  }

  console.log(ok(`repo metadata — ${repo.nameWithOwner}, ★${repo.stargazerCount}, ${repo.licenseInfo?.spdxId ?? 'no license'}`))

  // The part that actually discriminates between token types.
  const readFiles = repo.readme != null || repo.contributing != null || repo.ci != null
  console.log(
    readFiles
      ? ok('file-content reads work (README / CONTRIBUTING / workflows tree)')
      : bad('file-content reads returned null — approachability scoring will silently degrade')
  )

  const verdict = readFiles && rateLimit.limit >= 5000
  console.log(
    verdict
      ? '\n  \x1b[32mThis token can run the harvest.\x1b[0m\n'
      : '\n  \x1b[31mThis token is not sufficient.\x1b[0m Use a classic PAT with no scopes ticked.\n'
  )
  process.exit(verdict ? 0 : 1)
}

main().catch((e) => {
  console.error(`\n${bad(e.stack)}\n`)
  process.exit(1)
})
