#!/usr/bin/env node
// M0 stage 1 — harvest + enrich.
//
// Sharded by label × language, bisecting on created-date whenever a shard would
// exceed GitHub's hard 1,000-result cap (docs/03 §1, docs/07 §2). Writes an
// enriched JSONL cache so analyze.mjs can re-run offline as many times as we like.
//
//   node m0/harvest.mjs [--target 5000] [--languages Rust,Go] [--tier1-only]

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { GitHubClient } from './lib/gh.mjs'
import {
  SEARCH_ISSUES, COUNT_ISSUES, PAGE_SIZE, repoBatchQuery, labelRatioQuery,
} from './lib/queries.mjs'
import LABELS from '../config/labels.json' with { type: 'json' }

const CACHE = new URL('../.cache/', import.meta.url)
const ISSUES_FILE = new URL('issues.jsonl', CACHE)
const REPOS_FILE = new URL('repos.json', CACHE)
const STATS_FILE = new URL('harvest-stats.json', CACHE)

const args = parseArgs(process.argv.slice(2))
const TARGET = Number(args.target ?? 5000)
const LANGUAGES = args.languages ? args.languages.split(',') : LABELS.languages
const TIERS = args['tier1-only'] ? ['tier_1'] : ['tier_1', 'tier_2']
const WINDOW_MONTHS = 18
const MAX_BISECT_DEPTH = 4

// Adaptive: lowered permanently when GitHub rejects a query on resource limits.
let pageSize = Number(args['page-size'] ?? PAGE_SIZE)

const client = new GitHubClient()

// Module-scope so the target check can happen INSIDE pagination and bisection.
// Checking only between shards means one shard fetches up to 1,000 issues (25
// pages, ~100s) before noticing the target was already met.
const seen = new Map()
const done = () => seen.size >= TARGET

// Per-shard cap. Without it the first shard (TypeScript "good first issue" has
// 6,000+ matches) consumes the entire target and every other language gets zero
// — which starves the language landing pages that drive traffic. Round-robin
// breadth beats depth here.
const PER_SHARD = Number(args['per-shard'] ?? Math.max(60, Math.ceil(TARGET / 12)))
let shardTaken = 0
const shardFull = () => shardTaken >= PER_SHARD

async function main() {
  await mkdir(CACHE, { recursive: true })
  const t0 = Date.now()

  console.log(`\n▶ M0 harvest — target ${TARGET} issues`)
  console.log(`  languages: ${LANGUAGES.join(', ')}`)
  console.log(`  tiers:     ${TIERS.join(', ')}\n`)

  const shardLog = []
  const now = Date.now()
  const from = new Date(now - WINDOW_MONTHS * 30 * 86400_000)
  const to = new Date(now)

  outer: for (const tier of TIERS) {
    for (const label of LABELS[tier]) {
      for (const language of LANGUAGES) {
        if (done()) break outer
        const before = seen.size
        shardTaken = 0
        await harvestShard({ label, language, tier, from, to }, 0, shardLog)
        if (seen.size > before) {
          process.stdout.write('\r' + ' '.repeat(78) + '\r')
          console.log(`  ${label} / ${language}: +${seen.size - before} (total ${seen.size})`)
        }
      }
    }
  }

  const issues = [...seen.values()].slice(0, TARGET)
  console.log(`\n✓ harvested ${issues.length} unique issues`)

  // ── Repo enrichment: dedupe first (~5,000 issues live in ~800 repos) ──
  const repoNames = [...new Set(issues.map((i) => i.repository?.nameWithOwner).filter(Boolean))]
  console.log(`\n▶ enriching ${repoNames.length} unique repos`)
  const repos = await enrichRepos(repoNames)

  // Attach repo-derived signals the gates need.
  for (const issue of issues) {
    const extra = repos[issue.repository?.nameWithOwner]
    if (extra) Object.assign(issue.repository, extra)
  }

  await writeFile(ISSUES_FILE, issues.map((i) => JSON.stringify(i)).join('\n') + '\n')
  await writeFile(REPOS_FILE, JSON.stringify(repos, null, 2))

  const stats = {
    harvestedAt: new Date().toISOString(),
    issues: issues.length,
    repos: repoNames.length,
    durationSec: Math.round((Date.now() - t0) / 1000),
    api: client.stats(),
    shards: shardLog,
    overflowedShards: shardLog.filter((s) => s.overflowed).length,
    config: { TARGET, LANGUAGES, TIERS, WINDOW_MONTHS },
  }
  await writeFile(STATS_FILE, JSON.stringify(stats, null, 2))

  console.log(`\n✓ wrote .cache/issues.jsonl (${issues.length} issues)`)
  console.log(`  ${stats.durationSec}s · ${stats.api.requests} requests · ` +
              `${stats.api.pointsSpent} points (${stats.api.pointsPerRequest}/req)`)
  if (stats.overflowedShards) {
    console.log(`  ⚠ ${stats.overflowedShards} shard(s) hit the 1,000 cap even after bisecting`)
  }
  console.log(`\nNext: npm run m0:analyze\n`)
}

/** Recursive bisecting harvest — guarantees every executed query is under the cap. */
async function harvestShard(shard, depth, shardLog) {
  if (done() || shardFull()) return
  const q = buildQuery(shard)
  const { search } = await client.graphql(COUNT_ISSUES, { q })
  const total = search.issueCount

  if (total === 0) return

  if (total >= 1000) {
    if (depth < MAX_BISECT_DEPTH) {
      const mid = new Date((shard.from.getTime() + shard.to.getTime()) / 2)
      await harvestShard({ ...shard, to: mid }, depth + 1, shardLog)
      await harvestShard({ ...shard, from: mid }, depth + 1, shardLog)
      return
    }
    // Never truncate silently — that's invisible data loss (docs/07 §2).
    shardLog.push({ ...describeShard(shard), total, overflowed: true })
    console.warn(`  ⚠ shard overflow: ${shard.label}/${shard.language} = ${total}, taking 1000`)
  } else {
    shardLog.push({ ...describeShard(shard), total, overflowed: false })
  }

  await paginate(q, Math.min(total, 1000), shard)
}

/**
 * Page through a shard, shrinking the page size if GitHub rejects the query on
 * resource limits. Some issues have enormous timelines/comment threads, so a
 * page size that works everywhere else can still trip on one unlucky page.
 */
async function paginate(q, expected, shard) {
  let fetched = 0
  let after = null
  let first = pageSize

  while (fetched < expected && !done() && !shardFull()) {
    let data
    try {
      data = await client.graphql(SEARCH_ISSUES, { q, after, first })
    } catch (e) {
      if (e.code === 'RESOURCE_LIMIT' && first > 5) {
        first = Math.max(5, Math.floor(first / 2))
        console.warn(`  ⚠ query too large; page size → ${first}`)
        pageSize = Math.min(pageSize, first) // remember globally, don't relearn per shard
        continue
      }
      if (e.code === 'RESOURCE_LIMIT') {
        console.warn(`  ⚠ skipping unpageable slice of shard`)
        break
      }
      throw e
    }
    const nodes = (data.search?.nodes ?? []).filter((n) => n && n.__typename === 'Issue')
    fetched += nodes.length
    for (const issue of nodes) {
      if (seen.has(issue.id)) continue
      issue._tier = shard.tier
      issue._seedLabel = shard.label
      seen.set(issue.id, issue)
      shardTaken++
    }
    process.stdout.write(
      `\r  ${shard.label}/${shard.language} ${iso(shard.from)}→${iso(shard.to)}` +
      `  ${seen.size}/${TARGET}   `
    )
    if (!data.search?.pageInfo?.hasNextPage) break
    after = data.search.pageInfo.endCursor
  }
}

function buildQuery({ label, language, from, to }) {
  // Cheap gates pushed into the query itself: every issue filtered here is one
  // we never pay to enrich (docs/07 §2).
  const parts = [
    'is:issue', 'is:open', 'no:assignee', 'archived:false',
    `label:"${label}"`,
    `language:${language}`,
    `created:${iso(from)}..${iso(to)}`,
    '-label:wontfix', '-label:invalid', '-label:duplicate',
  ]
  // M0 default: NO activity prefilter, so the denominator stays honest — the
  // launch stat is "of all issues carrying this label, X% are unusable", and
  // prefiltering would quietly remove most of the bad ones first.
  //
  // --fresh is the production path (M1): G4.1 pushed into the query, which the
  // M0 run showed removes ~87% of candidates before we pay a single point to
  // enrich them. Enormous cost saving, identical output.
  if (args.fresh) {
    const cutoff = new Date(Date.now() - 120 * 86400_000)
    parts.push(`updated:>=${iso(cutoff)}`, 'sort:updated-desc')
  }
  return parts.join(' ')
}

/** Batched repo enrichment: commit-author diversity, CONTRIBUTING, label ratio. */
async function enrichRepos(names) {
  const out = {}
  const since = new Date(Date.now() - 90 * 86400_000).toISOString()
  const BATCH = 10

  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH)
    let data
    try {
      data = await client.graphql(repoBatchQuery(batch), { since })
    } catch (e) {
      // A single huge repo (long history, giant README) can blow the batch.
      // Retry it one repo at a time rather than losing all ten.
      if (e.code === 'RESOURCE_LIMIT' && batch.length > 1) {
        for (const one of batch) {
          try {
            const d = await client.graphql(repoBatchQuery([one]), { since })
            Object.assign(out, extractRepo(one, d.r0))
          } catch { /* genuinely unfetchable; gates will treat it as missing data */ }
        }
        continue
      }
      console.warn(`  ⚠ repo batch ${i} failed: ${e.message.slice(0, 120)}`)
      continue
    }
    batch.forEach((name, j) => Object.assign(out, extractRepo(name, data[`r${j}`])))
    process.stdout.write(`\r  repos: ${Math.min(i + BATCH, names.length)}/${names.length}`)
  }
  process.stdout.write('\n')

  // Beginner-label ratio for G6.1, in a second batched pass.
  //
  // NOTE: repeated `label:` qualifiers are AND-ed by GitHub search, not OR-ed —
  // `label:"a" label:"b"` means "has both". The comma form is the OR. Getting
  // this wrong made G6.1 silently return a 0.000 ratio for every repo, so the
  // anti-farming gate never fired at all.
  const beginnerFragment = `label:${LABELS.tier_1.slice(0, 5).map((l) => `"${l}"`).join(',')}`
  const RATIO_BATCH = 15
  for (let i = 0; i < names.length; i += RATIO_BATCH) {
    const batch = names.slice(i, i + RATIO_BATCH)
    try {
      const data = await client.graphql(labelRatioQuery(batch, beginnerFragment))
      batch.forEach((name, j) => {
        const c = data[`c${j}`]?.issueCount
        const total = out[name]?.openIssues?.totalCount
        if (c != null && total) out[name].beginnerLabelRatio = c / total
      })
    } catch (e) {
      console.warn(`  ⚠ ratio batch ${i} failed: ${e.message.slice(0, 120)}`)
    }
    process.stdout.write(`\r  label ratios: ${Math.min(i + RATIO_BATCH, names.length)}/${names.length}`)
  }
  process.stdout.write('\n')

  return out
}

/** Map one repository payload into the extra fields the gates read. */
function extractRepo(name, r) {
  if (!r) return {}
  const history = r.defaultBranchRef?.target?.history
  const authors = new Set(
    (history?.nodes ?? [])
      .map((c) => c.author?.user?.login || c.author?.email)
      .filter(Boolean)
  )
  return {
    [name]: {
      recentAuthors: authors.size,
      recentCommits: history?.totalCount ?? 0,
      hasContributing: Boolean(r.contributing || r.contributingDocs),
      hasReadmeSetup: /##+\s*(development|getting started|setup|build|contributing)/i
        .test(r.readme?.text ?? ''),
      topics: (r.repositoryTopics?.nodes ?? []).map((t) => t.topic.name),
      openIssues: r.openIssues,
      createdAt: r.createdAt,
      diskUsage: r.diskUsage,
    },
  }
}

const iso = (d) => d.toISOString().slice(0, 10)
const describeShard = (s) => ({
  label: s.label, language: s.language, tier: s.tier,
  from: iso(s.from), to: iso(s.to),
})

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { out[key] = next; i++ } else out[key] = true
  }
  return out
}

main().catch((e) => {
  console.error(`\n✖ ${e.stack}`)
  process.exit(1)
})
