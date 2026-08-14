#!/usr/bin/env node
// Pipeline stages 4–6: score → emit → assert (docs/07 §5–7).
//
// Reads validated survivors, fetches repo health for the survivor repos only,
// scores, selects the board, and writes data/*.json in the doc-06 shape.
//
//   node pipeline/emit.mjs [--no-health]

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { validate, annotateTemplateFarms } from '../m0/lib/gates.mjs'
import { scoreIssue, flagsFor, selectBoard, todaysPicks } from './scoring/score.mjs'
import { TODAYS_PICK_COUNT } from './scoring/weights.mjs'
import { fetchHealth } from './repo-health.mjs'

const ROOT = new URL('../', import.meta.url)
const CACHE = new URL('.cache/', ROOT)
const DATA = new URL('data/', ROOT)
const STATE = new URL('state/', ROOT)

const noHealth = process.argv.includes('--no-health')

async function main() {
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)

  // ── Load and re-validate ────────────────────────────────────────────────
  // Re-running the gates here is assertion A3: defense in depth against a bug
  // between validation and emit letting a claimed issue onto the board.
  const raw = await readFile(new URL('issues.jsonl', CACHE), 'utf8')
  const all = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

  // Cross-issue pre-pass: template farming is only visible across a repo's
  // issues at once, so it must run before the per-issue gates.
  const farms = annotateTemplateFarms(all)
  if (farms.size) console.log(`  template farms: ${[...farms.keys()].join(', ')}`)

  const survivors = all.filter((i) => validate(i, now).ok)

  console.log(`\n▶ emit: ${survivors.length} survivors from ${all.length} candidates`)

  // ── Health for survivor repos only (the expensive pass, kept small) ─────
  const repoNames = [...new Set(survivors.map((i) => i.repository.nameWithOwner))]
  if (!noHealth) {
    const health = await fetchHealth(repoNames)
    for (const issue of survivors) {
      issue.repository.health = health[issue.repository.nameWithOwner] ?? null
    }
  }

  // ── Score and select ────────────────────────────────────────────────────
  for (const issue of survivors) {
    const { score, parts } = scoreIssue(issue, now)
    issue.score = score
    issue.scoreParts = parts
    issue.flags = flagsFor(issue)
  }

  const board = selectBoard(survivors)
  const picks = todaysPicks(board, today, TODAYS_PICK_COUNT)
  console.log(`  board: ${board.length} issues across ${new Set(board.map((i) => i.repository.nameWithOwner)).size} repos`)

  // ── Normalize: repos into their own table, referenced by index (docs/06) ─
  const repoIndex = new Map()
  const repos = []
  for (const issue of board) {
    const key = issue.repository.nameWithOwner
    if (!repoIndex.has(key)) {
      repoIndex.set(key, repos.length)
      repos.push(shapeRepo(issue.repository))
    }
  }

  const labelVocab = []
  const labelIndex = new Map()
  const issues = board.map((issue) => shapeIssue(issue, repoIndex, labelVocab, labelIndex, now))

  // ── Facets ──────────────────────────────────────────────────────────────
  const facets = buildFacets(board, repos)

  // ── State: first-seen dates and lifecycle history ───────────────────────
  const { firstSeen, events } = await updateState(board, today, now)
  for (const issue of issues) issue.fs = firstSeen[`${repos[issue.r].n}#${issue.n}`] ?? Math.floor(now / 1000)

  // ── Write ───────────────────────────────────────────────────────────────
  await mkdir(DATA, { recursive: true })
  const issuesFile = await writeHashed('issues', { i: issues })
  const reposFile = await writeHashed('repos', { r: repos })
  const facetsFile = await writeHashed('facets', facets)

  const rejected = countRejections(all, now)
  const meta = {
    v: 1,
    generatedAt: new Date(now).toISOString(),
    nextRefreshAt: new Date(now + 86400_000).toISOString(),
    counts: {
      issues: issues.length,
      repos: repos.length,
      languages: facets.languages.length,
    },
    todaysPicks: picks.map((p) => `${p.repository.nameWithOwner}#${p.number}`),
    shards: { issues: [issuesFile], repos: reposFile, facets: facetsFile },
    labels: labelVocab,
    stats: {
      candidatesScanned: all.length,
      rejected,
      passRate: +(survivors.length / Math.max(all.length, 1)).toFixed(4),
    },
  }
  await writeFile(new URL('meta.json', DATA), JSON.stringify(meta, null, 2))

  await assertInvariants({ issues, repos, meta })
  await gcOldShards([issuesFile, reposFile, facetsFile])

  console.log(`\n✓ data/ written`)
  console.log(`  ${issues.length} issues · ${repos.length} repos · ${facets.languages.length} languages`)
  console.log(`  today's picks: ${picks.length}`)
  console.log(`  new lifecycle events: ${events}\n`)
}

// ─── Shaping (docs/06) ──────────────────────────────────────────────────────

function shapeRepo(r) {
  return {
    n: r.nameWithOwner,
    s: r.stargazerCount,
    l: r.primaryLanguage?.name ?? null,
    lic: r.licenseInfo?.spdxId ?? null,
    p: unix(r.pushedAt),
    t: (r.topics ?? []).slice(0, 6),
    h: r.health
      ? {
          mr: r.health.outsiderMergeRate == null ? null : +r.health.outsiderMergeRate.toFixed(2),
          mc: r.health.mergedCount,
          np: r.health.outsiderPRs,
          rh: r.health.medianResponseHours,
          rot: r.health.rottingPRs,
        }
      : null,
    f: [
      r.hasContributing && 'contributing',
      r.hasReadmeSetup && 'setup-docs',
      r.health?.hasCI && 'ci',
      r.health?.hasTests && 'tests',
    ].filter(Boolean),
  }
}

function shapeIssue(issue, repoIndex, vocab, index, now) {
  const labels = (issue.labels?.nodes ?? []).map((l) => {
    if (!index.has(l.name)) {
      index.set(l.name, vocab.length)
      vocab.push(l.name)
    }
    return index.get(l.name)
  })

  return {
    r: repoIndex.get(issue.repository.nameWithOwner),
    n: issue.number,
    t: issue.title,
    x: excerpt(issue.bodyText, 280),
    lb: labels.slice(0, 8),
    c: issue.comments?.totalCount ?? 0,
    rx: issue.reactions?.totalCount ?? 0,
    cr: unix(issue.createdAt),
    u: unix(issue.updatedAt),
    sc: issue.score,
    sp: Object.fromEntries(Object.entries(issue.scoreParts).map(([k, v]) => [k[0], Math.round(v)])),
    vf: Math.floor(now / 1000),
    fl: issue.flags,
    ty: issueType(issue),
  }
}

/** Coarse type from labels — powers the /{lang}/{type} SEO pages. */
function issueType(issue) {
  const names = (issue.labels?.nodes ?? []).map((l) => l.name.toLowerCase()).join(' ')
  if (/\bdoc|documentation\b/.test(names)) return 'docs'
  if (/\bbug|defect|fix\b/.test(names)) return 'bugs'
  if (/\btest|testing\b/.test(names)) return 'tests'
  if (/\bfeature|enhancement|improvement\b/.test(names)) return 'features'
  return 'other'
}

function excerpt(body = '', max) {
  const clean = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= max) return clean
  return clean.slice(0, clean.lastIndexOf(' ', max)) + '…'
}

function buildFacets(board, repos) {
  const langs = tally(board, (i) => i.repository.primaryLanguage?.name)
  const types = tally(board, (i) => issueType(i))
  const topics = tally(board, (i) => null, (i) => i.repository.topics ?? [])
  return {
    languages: Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ k, c })),
    types: Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ k, c })),
    topics: Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, c]) => ({ k, c })),
    stars: bucketize(board, (i) => i.repository.stargazerCount, [
      ['25-100', 25, 100], ['100-1k', 100, 1000], ['1k-10k', 1000, 10000], ['10k+', 10000, Infinity],
    ]),
  }
}

function tally(arr, fn, multiFn) {
  const out = {}
  for (const x of arr) {
    const keys = multiFn ? multiFn(x) : [fn(x)]
    for (const k of keys) if (k) out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function bucketize(arr, fn, buckets) {
  return buckets.map(([k, lo, hi]) => ({
    k,
    c: arr.filter((x) => { const v = fn(x); return v >= lo && v < hi }).length,
  }))
}

// ─── State (docs/06 §6) ─────────────────────────────────────────────────────

async function updateState(board, today, now) {
  await mkdir(STATE, { recursive: true })
  await mkdir(new URL('history/', STATE), { recursive: true })

  const prev = await readJson(new URL('current.json', STATE), { issues: [] })
  const prevKeys = new Map(prev.issues.map((i) => [i.k, i]))
  const firstSeen = {}
  const lines = []
  const ts = Math.floor(now / 1000)

  for (const issue of board) {
    const k = `${issue.repository.nameWithOwner}#${issue.number}`
    const before = prevKeys.get(k)
    firstSeen[k] = before?.fs ?? ts
    if (!before) lines.push(JSON.stringify({ ts, k, e: 'listed', sc: issue.score }))
    prevKeys.delete(k)
  }
  // Anything left in prevKeys dropped off the board today. We don't always know
  // why without re-fetching, so record the fact and let the daily revalidation
  // pass attribute a reason. History cannot be back-filled, so log it now even
  // though nothing consumes it yet (docs/04 §5).
  for (const [k] of prevKeys) {
    lines.push(JSON.stringify({ ts, k, e: 'dropped', why: 'not_in_board' }))
  }

  const month = today.slice(0, 7)
  const historyFile = new URL(`history/${month}.jsonl`, STATE)
  const existing = await readText(historyFile, '')
  await writeFile(historyFile, existing + lines.map((l) => l + '\n').join(''))

  await writeFile(
    new URL('current.json', STATE),
    JSON.stringify(
      {
        generatedAt: new Date(now).toISOString(),
        issues: board.map((i) => ({
          k: `${i.repository.nameWithOwner}#${i.number}`,
          fs: firstSeen[`${i.repository.nameWithOwner}#${i.number}`],
          sc: i.score,
        })),
      },
      null,
      2
    )
  )
  return { firstSeen, events: lines.length }
}

function countRejections(all, now) {
  const out = {}
  for (const issue of all) {
    const v = validate(issue, now)
    if (!v.ok) out[v.gate] = (out[v.gate] ?? 0) + 1
  }
  return out
}

// ─── Assertions (docs/07 §7) ────────────────────────────────────────────────

async function assertInvariants({ issues, repos, meta }) {
  const fail = (msg) => { throw new Error(`ASSERTION FAILED: ${msg}`) }

  if (issues.length < 1) fail('A1: empty board')
  const keys = new Set(issues.map((i) => `${repos[i.r].n}#${i.n}`))
  if (keys.size !== issues.length) fail('A4: duplicate issue keys')

  const perRepo = {}
  for (const i of issues) perRepo[i.r] = (perRepo[i.r] ?? 0) + 1
  const maxShare = Math.max(...Object.values(perRepo)) / issues.length
  if (issues.length >= 100 && maxShare > 0.05) {
    fail(`A8: one repo holds ${(maxShare * 100).toFixed(1)}% of the board (max 5%)`)
  }

  const bytes = Buffer.byteLength(JSON.stringify({ i: issues }))
  const budget = 2_000_000 // ~500 KB brotli
  if (bytes > budget) fail(`A5: payload ${(bytes / 1e6).toFixed(2)}MB exceeds budget`)

  console.log(`  ✓ assertions passed (payload ${(bytes / 1024).toFixed(0)}KB raw, max repo share ${(maxShare * 100).toFixed(1)}%)`)
}

// ─── IO helpers ─────────────────────────────────────────────────────────────

async function writeHashed(name, obj) {
  const body = JSON.stringify(obj)
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 6)
  const file = `${name}.${hash}.json`
  await writeFile(new URL(file, DATA), body)
  return file
}

/** Content-hashed files are immutable, so old ones just accumulate. */
async function gcOldShards(keep) {
  const files = await readdir(DATA)
  const keepSet = new Set([...keep, 'meta.json'])
  for (const f of files) {
    if (!keepSet.has(f) && /\.[0-9a-f]{6}\.json$/.test(f)) {
      await unlink(new URL(f, DATA))
    }
  }
}

const unix = (iso) => Math.floor(new Date(iso).getTime() / 1000)
const readJson = async (url, fallback) => {
  try { return JSON.parse(await readFile(url, 'utf8')) } catch { return fallback }
}
const readText = async (url, fallback) => {
  try { return await readFile(url, 'utf8') } catch { return fallback }
}

main().catch((e) => {
  console.error(`\n✖ ${e.stack}`)
  process.exit(1)
})
