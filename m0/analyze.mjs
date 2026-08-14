#!/usr/bin/env node
// M0 stage 2 — analysis.
//
// Answers the questions docs/10 flagged as measurements:
//   RQ1  what % of labelled issues already have an open linked PR?   ← launch headline
//   RQ6  what's the true joint pass rate through all hard gates?
//   plus: per-gate independent rejection rates (which gate is expensive?)
//
// Writes docs/14-m0-findings.md. Re-runnable offline against the cache.

import { readFile, writeFile } from 'node:fs/promises'
import { GATES, validate, validateAll, linkedPRs, softClaim, cleanBody } from './lib/gates.mjs'

const CACHE = new URL('../.cache/', import.meta.url)
const OUT = new URL('../docs/14-m0-findings.md', import.meta.url)

async function main() {
  const raw = await readFile(new URL('issues.jsonl', CACHE), 'utf8')
  const issues = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const stats = JSON.parse(await readFile(new URL('harvest-stats.json', CACHE), 'utf8'))
  const now = Date.now()

  console.log(`\n▶ analyzing ${issues.length} issues\n`)

  // ── Per-gate, independently ─────────────────────────────────────────────
  // The key measurement: how much does each gate cost us ON ITS OWN? A gate
  // that rejects 60% alone is a very different finding from six gates that
  // each reject 15% but overlap heavily.
  const perGate = Object.fromEntries(GATES.map(([n]) => [n, { failed: 0, reasons: new Map() }]))
  for (const issue of issues) {
    const results = validateAll(issue, now)
    for (const [name, r] of Object.entries(results)) {
      if (!r.ok) {
        perGate[name].failed++
        const key = normalizeReason(r.reason)
        perGate[name].reasons.set(key, (perGate[name].reasons.get(key) ?? 0) + 1)
      }
    }
  }

  // ── Joint, short-circuiting (production ordering) ────────────────────────
  const survivors = []
  const firstFailure = new Map()
  for (const issue of issues) {
    const v = validate(issue, now)
    if (v.ok) survivors.push(issue)
    else firstFailure.set(v.gate, (firstFailure.get(v.gate) ?? 0) + 1)
  }

  const passRate = survivors.length / issues.length

  // ── RQ1: the launch headline ────────────────────────────────────────────
  let withOpenPR = 0, assigned = 0, softClaimed = 0
  for (const issue of issues) {
    if ((issue.assignees?.totalCount ?? 0) > 0) assigned++
    if (linkedPRs(issue).some((p) => p.state === 'OPEN')) withOpenPR++
    if (softClaim(issue, now)) softClaimed++
  }
  // Note: the harvest query already includes `no:assignee`, so `assigned` is
  // expected to be ~0. Claim detection here is dominated by linked PRs and
  // comment claims — which is exactly the point: those are the INVISIBLE ones.
  const takenAnyhow = issues.filter((i) => !validateAll(i, now).G2_takeability.ok).length

  // ── Breakdowns ──────────────────────────────────────────────────────────
  const byLanguage = tally(survivors, (i) => i.repository?.primaryLanguage?.name ?? '?')
  const byLanguageAll = tally(issues, (i) => i.repository?.primaryLanguage?.name ?? '?')
  const byTier = tally(issues, (i) => i._tier)
  const survivorsByTier = tally(survivors, (i) => i._tier)
  const byRepo = tally(survivors, (i) => i.repository?.nameWithOwner)

  const report = buildReport({
    issues, survivors, passRate, perGate, firstFailure, stats,
    rq1: { withOpenPR, assigned, softClaimed, takenAnyhow },
    byLanguage, byLanguageAll, byTier, survivorsByTier, byRepo, now,
  })

  await writeFile(OUT, report)
  await writeFile(new URL('survivors.jsonl', CACHE),
    survivors.map((i) => JSON.stringify(i)).join('\n') + '\n')

  // ── Console summary ─────────────────────────────────────────────────────
  console.log(`  candidates:   ${issues.length}`)
  console.log(`  survivors:    ${survivors.length}  (${pct(passRate)} pass rate)`)
  console.log(`  already taken:${String(takenAnyhow).padStart(6)}  (${pct(takenAnyhow / issues.length)}) ← RQ1`)
  console.log(`\n  per-gate independent rejection:`)
  for (const [name, g] of Object.entries(perGate)) {
    console.log(`    ${name.padEnd(20)} ${pct(g.failed / issues.length).padStart(6)}  (${g.failed})`)
  }
  console.log(`\n✓ wrote docs/14-m0-findings.md`)
  console.log(`\nNext: npm run m0:audit\n`)
}

function buildReport(d) {
  const { issues, survivors, passRate, perGate, firstFailure, stats, rq1 } = d
  const total = issues.length

  const gateRows = Object.entries(perGate)
    .sort((a, b) => b[1].failed - a[1].failed)
    .map(([name, g]) => {
      const top = [...g.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([r, c]) => `${r} (${c})`).join('; ')
      return `| \`${name}\` | ${g.failed} | ${pct(g.failed / total)} | ${top || '—'} |`
    }).join('\n')

  const firstFailRows = [...firstFailure.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g, c]) => `| \`${g}\` | ${c} | ${pct(c / total)} |`)
    .join('\n')

  const langRows = Object.entries(d.byLanguageAll)
    .sort((a, b) => b[1] - a[1])
    .map(([lang, all]) => {
      const kept = d.byLanguage[lang] ?? 0
      const flag = kept < 40 ? ' ⚠️' : ''
      return `| ${lang} | ${all} | ${kept} | ${pct(kept / all)}${flag} |`
    }).join('\n')

  const topRepos = Object.entries(d.byRepo).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([r, c]) => `| ${r} | ${c} | ${pct(c / Math.max(survivors.length, 1))} |`).join('\n')

  const verdict = passRate >= 0.04
    ? '**Browse product is viable as designed.** Proceed to M1 with the current gates.'
    : passRate >= 0.01
      ? '**Corpus is thin.** Broaden seed labels and languages before M1 (D14: never loosen G2 or G3.5). "Today\'s 10" carries the product regardless.'
      : '**Corpus is very thin.** "Today\'s 10" becomes the primary product surface (D02). Re-check whether one gate is misfiring — see the per-gate table.'

  return `# 14 — M0 Findings

> Generated by \`npm run m0\` on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.
> Regenerate with \`npm run m0:analyze\` (runs offline against \`.cache/\`).

## Headline

| | |
|---|---|
| Candidates analyzed | **${total}** |
| Survived all hard gates | **${survivors.length}** |
| **Joint pass rate (RQ6)** | **${pct(passRate)}** |
| Unique repos in survivor set | ${Object.keys(d.byRepo).length} |

${verdict}

---

## RQ1 — the launch statistic

Of ${total} open issues carrying a beginner/help-wanted label **and already filtered by
GitHub's own \`no:assignee\`**:

| Signal | Count | Share |
|---|---|---|
| Has an **open linked PR** (invisible on GitHub's issue list) | ${rq1.withOpenPR} | ${pct(rq1.withOpenPR / total)} |
| **Soft-claimed** in comments within 21d, no PR | ${rq1.softClaimed} | ${pct(rq1.softClaimed / total)} |
| Formally assigned (should be ~0 — pre-filtered) | ${rq1.assigned} | ${pct(rq1.assigned / total)} |
| **Taken by any measure (G2 failure)** | **${rq1.takenAnyhow}** | **${pct(rq1.takenAnyhow / total)}** |

> **The launch line:** "GitHub says these ${total} issues are unassigned and free.
> ${pct(rq1.takenAnyhow / total)} of them are already being worked on — you just can't see it
> from the issue list."

Everything in that table is invisible to a normal GitHub search. This is the differentiator
from [docs/02](02-competitive-landscape.md) measured on real data.

---

## Per-gate independent rejection rates

Each gate applied **alone** to all ${total} candidates. This isolates which gate is
expensive — a single gate rejecting most of the pool is a very different finding from six
gates that each reject a little but overlap.

| Gate | Rejected | Share | Top reasons |
|---|---|---|---|
${gateRows}

## First-failure attribution (short-circuit ordering)

Where issues actually die in the production pipeline (cheapest gate first):

| Gate | First failures | Share |
|---|---|---|
${firstFailRows}

---

## Language breakdown

⚠️ marks languages under 40 survivors — below the inventory needed for a credible
language landing page (docs/12 §2, R9's minimum-inventory rule).

| Language | Candidates | Survivors | Pass rate |
|---|---|---|---|
${langRows}

## Tier comparison

| Tier | Candidates | Survivors | Pass rate |
|---|---|---|---|
| tier_1 (beginner-targeted) | ${d.byTier.tier_1 ?? 0} | ${d.survivorsByTier.tier_1 ?? 0} | ${pct((d.survivorsByTier.tier_1 ?? 0) / Math.max(d.byTier.tier_1 ?? 1, 1))} |
| tier_2 (help wanted) | ${d.byTier.tier_2 ?? 0} | ${d.survivorsByTier.tier_2 ?? 0} | ${pct((d.survivorsByTier.tier_2 ?? 0) / Math.max(d.byTier.tier_2 ?? 1, 1))} |

## Repo concentration

Assertion A8 caps any single repo at 5% of the board. Top survivor repos:

| Repo | Survivors | Share of board |
|---|---|---|
${topRepos}

---

## API cost (validates the docs/03 §3 budget)

| | Measured | Budgeted |
|---|---|---|
| Requests | ${stats.api.requests} | — |
| Points spent | ${stats.api.pointsSpent} | ~3,200 for a full run |
| **Points per request** | **${stats.api.pointsPerRequest}** | ~21 assumed |
| Wall clock | ${stats.durationSec}s | ~20–25 min full sweep |
| Shards that overflowed 1,000 even after bisecting | ${stats.overflowedShards} | 0 desired |

${stats.api.pointsPerRequest > 25
  ? '> ⚠️ **Cost per request exceeds the docs/03 estimate.** Re-check the node budget before M1 — trim `timelineItems`/`comments` page sizes if needed.'
  : '> ✅ Cost per request is within the docs/03 §2 estimate. The nightly budget holds.'}

---

## What to do with this

1. If a single gate rejects > 50% alone, inspect its top reasons before accepting it.
   Thresholds live in \`m0/lib/gates.mjs\` → \`THRESHOLDS\`.
2. Run \`npm run m0:audit\` and hand-check 30 survivors. **Pass quality gates M0, not pass
   rate** (docs/11): ≥ 80% genuinely takeable or a signal is lying.
3. Feed the RQ1 number into the launch post (D24).
`
}

const pct = (x) => `${(x * 100).toFixed(1)}%`
const tally = (arr, fn) => {
  const out = {}
  for (const x of arr) { const k = fn(x); if (k) out[k] = (out[k] ?? 0) + 1 }
  return out
}
// Collapse "no activity in 137d" → "no activity in Nd" so reasons aggregate.
const normalizeReason = (r) => r.replace(/\d+/g, 'N')

main().catch((e) => {
  if (e.code === 'ENOENT') {
    console.error('\n✖ No cache found. Run `npm run m0:harvest` first.\n')
    process.exit(1)
  }
  console.error(`\n✖ ${e.stack}`)
  process.exit(1)
})
