#!/usr/bin/env node
// M0 stage 3 — hand-audit worksheet.
//
// The M0 gate is pass QUALITY, not pass rate (docs/11): ≥ 80% of survivors must be
// genuinely takeable. That can only be established by a human opening the issues.
// This generates a deterministic 30-issue sample as a checklist.
//
// Deterministic sampling matters: re-running must produce the SAME 30 issues, so a
// half-finished audit isn't invalidated by regenerating the worksheet.

import { readFile, writeFile } from 'node:fs/promises'

const CACHE = new URL('../.cache/', import.meta.url)
const OUT = new URL('../docs/14a-m0-audit.md', import.meta.url)
const SAMPLE_SIZE = Number(process.argv[2] ?? 30)

async function main() {
  const raw = await readFile(new URL('survivors.jsonl', CACHE), 'utf8')
  const survivors = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

  if (!survivors.length) {
    console.error('\n✖ No survivors to audit. Check docs/14-m0-findings.md.\n')
    process.exit(1)
  }

  // Stable hash sort → deterministic sample, spread across repos rather than
  // 30 issues from whichever repo happens to dominate.
  const sorted = [...survivors].sort((a, b) => hash(a.url) - hash(b.url))
  const sample = []
  const repoCount = new Map()
  for (const issue of sorted) {
    if (sample.length >= SAMPLE_SIZE) break
    const repo = issue.repository.nameWithOwner
    const n = repoCount.get(repo) ?? 0
    if (n >= 2) continue // max 2 per repo, so the audit isn't one project's opinion
    repoCount.set(repo, n + 1)
    sample.push(issue)
  }

  const rows = sample.map((issue, i) => {
    const r = issue.repository
    const body = (issue.bodyText || '').replace(/\s+/g, ' ').slice(0, 220)
    return `### ${i + 1}. [${r.nameWithOwner}#${issue.number}](${issue.url})

\`${r.primaryLanguage?.name ?? '?'}\` · ★${r.stargazerCount.toLocaleString()} · ${r.licenseInfo?.spdxId} · ${issue.comments.totalCount} comments · updated ${daysAgo(issue.updatedAt)}d ago
${r.hasContributing ? '· has CONTRIBUTING' : ''}${r.recentAuthors != null ? ` · ${r.recentAuthors} committers/90d` : ''}

**${issue.title}**

> ${body}${body.length >= 220 ? '…' : ''}

- [ ] **Actually unclaimed?** (no PR, no one working on it in comments)
- [ ] **Enough context to start?** (you could open the file and begin)
- [ ] **Repo alive?** (recent merged PRs from outsiders)
- [ ] **Scope sane?** (hours-to-days, not weeks)

Verdict: \`PASS\` / \`FAIL — reason\`

---
`
  }).join('\n')

  const doc = `# 14a — M0 Hand Audit

> ${sample.length} survivors sampled deterministically (max 2 per repo) from
> \`.cache/survivors.jsonl\`. Re-running \`npm run m0:audit\` reproduces the same sample,
> so a partially-completed audit is never invalidated.

**The M0 gate (docs/11): ≥ 80% PASS.** Below that, a signal is lying — find which gate is
wrong before writing pipeline code. Pass *rate* gates nothing; pass *quality* gates everything.

Open each issue, spend ~60 seconds, tick the boxes. Be harsh — the whole product is the
promise that these are real.

**Tally:** ___ / ${sample.length} passed

---

${rows}

## Notes

Record any pattern in the failures here. A failure mode that appears 3+ times is a missing
gate, not bad luck — write it up and add it to docs/04 §1 before M1.
`

  await writeFile(OUT, doc)
  console.log(`\n✓ wrote docs/14a-m0-audit.md — ${sample.length} issues across ${repoCount.size} repos`)
  console.log(`\n  Open it, spend 30 minutes, tick the boxes. This is the M0 gate.\n`)
}

const daysAgo = (iso) => Math.round((Date.now() - new Date(iso).getTime()) / 86400_000)

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

main().catch((e) => {
  if (e.code === 'ENOENT') {
    console.error('\n✖ No survivors cache. Run `npm run m0:harvest && npm run m0:analyze` first.\n')
    process.exit(1)
  }
  console.error(`\n✖ ${e.stack}`)
  process.exit(1)
})
