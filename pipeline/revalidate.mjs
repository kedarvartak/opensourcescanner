#!/usr/bin/env node
// Re-validate the current board (docs/09 §3 — the asymmetric refresh).
//
// The issues already on the board are the ones people clicked, so they're the
// most likely to have just been claimed — and the cheapest to check (~30
// requests for the whole board). Running this every 6 hours cuts worst-case
// claim staleness from 24h to 6h.
//
// It only ever REMOVES issues. Adding new ones needs a full harvest, and this
// job deliberately can't do that: a partially-failed run that removed claimed
// issues is a good outcome; one that added issues while leaving stale ones is not.

import { readFile, writeFile } from 'node:fs/promises'
import { GitHubClient } from '../m0/lib/gh.mjs'
import { G1_structural, G2_takeability, G4_relevance } from '../m0/lib/gates.mjs'

const ROOT = new URL('../', import.meta.url)
const DATA = new URL('data/', ROOT)
const STATE = new URL('state/', ROOT)
const BATCH = 25

const ISSUE_FIELDS = /* GraphQL */ `
  number
  locked
  state
  createdAt
  updatedAt
  bodyText
  author { login __typename }
  assignees { totalCount }
  labels(first: 15) { nodes { name } }
  comments(last: 6) { totalCount nodes { bodyText createdAt authorAssociation author { login } } }
  timelineItems(last: 12, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) {
    nodes {
      __typename
      ... on CrossReferencedEvent {
        source { __typename ... on PullRequest { number state isDraft author { login } } }
      }
      ... on ConnectedEvent {
        subject { __typename ... on PullRequest { number state isDraft } }
      }
    }
  }
`

function batchQuery(keys) {
  const aliases = keys
    .map(({ owner, name, number }, i) =>
      `  i${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { issue(number: ${number}) { ${ISSUE_FIELDS} } }`
    )
    .join('\n')
  return `query Revalidate {\n  rateLimit { cost remaining resetAt }\n${aliases}\n}`
}

async function main() {
  const now = Date.now()
  const meta = JSON.parse(await readFile(new URL('meta.json', DATA), 'utf8'))
  const issuesFile = new URL(meta.shards.issues[0], DATA)
  const { i: issues } = JSON.parse(await readFile(issuesFile, 'utf8'))
  const { r: repos } = JSON.parse(await readFile(new URL(meta.shards.repos, DATA), 'utf8'))

  console.log(`\n▶ revalidating ${issues.length} listed issues`)

  const client = new GitHubClient()
  const keys = issues.map((i, idx) => {
    const [owner, name] = repos[i.r].n.split('/')
    return { owner, name, number: i.n, idx }
  })

  const dropped = []
  const stillGood = new Set()

  for (let b = 0; b < keys.length; b += BATCH) {
    const batch = keys.slice(b, b + BATCH)
    let data
    try {
      data = await client.graphql(batchQuery(batch))
    } catch (e) {
      // On failure, KEEP the issues. Removing on a network error would empty the
      // board for a reason that has nothing to do with the issues themselves.
      console.warn(`  ⚠ batch ${b} failed, keeping those issues: ${e.message.slice(0, 90)}`)
      batch.forEach((k) => stillGood.add(k.idx))
      continue
    }

    batch.forEach((k, j) => {
      const node = data[`i${j}`]?.issue
      if (!node) {
        dropped.push({ idx: k.idx, why: 'gone' })
        return
      }
      const shaped = { ...node, __typename: 'Issue', repository: {} }
      if (node.state !== 'OPEN') return dropped.push({ idx: k.idx, why: 'closed' })
      for (const [name, gate] of [
        ['structural', G1_structural],
        ['takeability', G2_takeability],
        ['relevance', G4_relevance],
      ]) {
        const r = gate(shaped, now)
        if (!r.ok) return dropped.push({ idx: k.idx, why: `${name}: ${r.reason}` })
      }
      stillGood.add(k.idx)
    })
    process.stdout.write(`\r  checked ${Math.min(b + BATCH, keys.length)}/${keys.length}`)
  }
  process.stdout.write('\n')

  const droppedIdx = new Set(dropped.map((d) => d.idx))
  const kept = issues.filter((_, idx) => !droppedIdx.has(idx))
  const verifiedAt = Math.floor(now / 1000)
  for (const issue of kept) issue.vf = verifiedAt

  // Guard: a revalidation that removes most of the board is a bug in this job,
  // not 90% of the internet getting claimed in six hours.
  if (kept.length < issues.length * 0.5) {
    throw new Error(
      `refusing to drop ${issues.length - kept.length}/${issues.length} issues in one pass`
    )
  }

  await writeFile(issuesFile, JSON.stringify({ i: kept }))
  meta.counts.issues = kept.length
  meta.revalidatedAt = new Date(now).toISOString()
  meta.todaysPicks = meta.todaysPicks.filter((k) => {
    const [repoName, num] = k.split('#')
    return kept.some((i) => repos[i.r].n === repoName && String(i.n) === num)
  })
  await writeFile(new URL('meta.json', DATA), JSON.stringify(meta, null, 2))

  // Lifecycle events — the compounding dataset (docs/04 §5).
  if (dropped.length) {
    const month = new Date(now).toISOString().slice(0, 7)
    const file = new URL(`history/${month}.jsonl`, STATE)
    const prev = await readFile(file, 'utf8').catch(() => '')
    const lines = dropped
      .map((d) => {
        const issue = issues[d.idx]
        return JSON.stringify({
          ts: verifiedAt,
          k: `${repos[issue.r].n}#${issue.n}`,
          e: 'dropped',
          why: d.why,
        })
      })
      .join('\n')
    await writeFile(file, prev + lines + '\n')
  }

  console.log(`\n✓ ${kept.length} still free · ${dropped.length} dropped`)
  for (const d of dropped.slice(0, 12)) {
    console.log(`   − ${repos[issues[d.idx].r].n}#${issues[d.idx].n}: ${d.why}`)
  }
  console.log()
}

main().catch((e) => {
  console.error(`\n✖ ${e.stack}`)
  process.exit(1)
})
