// The five scoring dimensions from docs/04 §3. Each returns 0–100.
//
// Pure functions, no I/O — so they're snapshot-testable. A scoring regression is
// silent (nothing errors, the board just gets worse), which makes tests here more
// important than in code that can crash.

import { cleanBody, linkedPRs } from '../../m0/lib/gates.mjs'

const DAY = 86400_000
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x))
const daysSince = (iso, now) => (now - new Date(iso).getTime()) / DAY

/** Decay from 100 → 0 as `days` goes 0 → `horizon`. */
const decay = (days, horizon) => clamp(100 * (1 - days / horizon))

// ─── D1 Maintainer responsiveness — "will a human review my PR?" ────────────
// The heaviest weight. Computed per repo from the health pass; falls back to
// commit-activity proxies when health data is missing so a repo is never
// silently zeroed for lacking data it was never asked for.

export function d1_responsiveness(issue, now = Date.now()) {
  const r = issue.repository ?? {}
  const h = r.health

  if (!h) {
    // Fallback: commit cadence and team size. Weak, and deliberately capped at
    // 60 so a repo with no health data can never outrank a measured-good one.
    const pushed = decay(daysSince(r.pushedAt, now), 60)
    const team = clamp((r.recentAuthors ?? 0) * 12)
    return clamp(0.6 * pushed + 0.4 * team, 0, 60)
  }

  // % of recent outsider PRs that got merged — the single most direct answer
  // to "is contributing here worth my evening?"
  const mergeRate = h.outsiderPRs >= 3 ? h.outsiderMergeRate * 100 : 45 // unknown ⇒ neutral

  // Median hours to first maintainer response. 24h → 100, 14d → 0.
  const respScore =
    h.medianResponseHours == null
      ? 45
      : clamp(100 * (1 - (h.medianResponseHours - 24) / (14 * 24 - 24)))

  // Rotting PRs are a strong negative: open >90d with no maintainer comment.
  const rotPenalty = clamp((h.rottingPRs ?? 0) * 12, 0, 40)

  return clamp(0.5 * mergeRate + 0.5 * respScore - rotPenalty)
}

// ─── D2 Issue specificity — "can I start without asking questions?" ─────────

const FILE_PATH = /\b[\w./-]+\.(js|ts|tsx|jsx|py|go|rs|java|rb|php|c|cpp|h|css|html|md|yml|yaml|json|toml)\b/i
const REPRO = /steps to reproduce|to reproduce|reproduction steps|^\s*1\.\s/im
const ACCEPTANCE = /acceptance criteria|expected behaviou?r|definition of done|what needs to (be done|happen)/i

export function d2_specificity(issue) {
  const body = cleanBody(issue.bodyText)
  const raw = issue.bodyText ?? ''

  // Log-scaled, saturating around 1,200 chars — past that, more words stop
  // meaning more clarity.
  let score = clamp((Math.log10(Math.max(body.length, 1) / 100) / Math.log10(12)) * 45)

  if (/```/.test(raw)) score += 10 // code block / stack trace
  if (FILE_PATH.test(raw)) score += 18 // points at a file — the strongest "where do I start"
  if (REPRO.test(raw)) score += 15
  if (ACCEPTANCE.test(raw)) score += 8

  // A maintainer replying with guidance is the strongest signal a human will
  // help you. Weighted heavily and deliberately.
  if (hasMaintainerGuidance(issue)) score += 20

  return clamp(score)
}

export function hasMaintainerGuidance(issue) {
  return (issue.comments?.nodes ?? []).some(
    (c) =>
      ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.authorAssociation) &&
      (c.bodyText ?? '').length > 120
  )
}

// ─── D3 Project approachability ─────────────────────────────────────────────

export function d3_approachability(issue) {
  const r = issue.repository ?? {}
  let score = 30 // baseline: it passed the hard gates, so it's a real project

  if (r.hasContributing) score += 25
  if (r.hasReadmeSetup) score += 15
  if (r.health?.hasCI) score += 10
  if (r.health?.hasTests) score += 10

  // Smaller codebases are easier to hold in your head. diskUsage is in KB.
  const mb = (r.diskUsage ?? 0) / 1024
  if (mb < 50) score += 10
  else if (mb > 500) score -= 10

  return clamp(score)
}

// ─── D4 Freshness ───────────────────────────────────────────────────────────
// Lowest weight by design: the hard gates already removed everything stale, and
// heavy freshness weighting churns the board daily, which destroys the stable
// URLs the SEO strategy depends on (docs/12 §2).

export function d4_freshness(issue, now = Date.now()) {
  const issueFresh = decay(daysSince(issue.updatedAt, now), 120)
  const repoFresh = decay(daysSince(issue.repository?.pushedAt, now), 60)
  // Mild penalty for old-and-untouched: it correlates with "actually hard".
  const agePenalty = clamp(daysSince(issue.createdAt, now) / 30, 0, 15)
  return clamp(0.5 * issueFresh + 0.5 * repoFresh - agePenalty)
}

// ─── D5 Openness / low crowding ─────────────────────────────────────────────
// Uncrowded issues are what ONLY we can show. Anything crowded is already
// discoverable via GitHub search, so ranking it high makes us a GitHub mirror.

export function d5_openness(issue, now = Date.now()) {
  const recent = (issue.comments?.nodes ?? []).filter(
    (c) => daysSince(c.createdAt, now) <= 30
  )
  const outsiders = new Set(
    recent
      .filter((c) => !['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.authorAssociation))
      .map((c) => c.author?.login)
      .filter(Boolean)
  )

  let score = 100 - outsiders.size * 22 // each person circling costs a lot
  score -= Math.min((issue.comments?.totalCount ?? 0) * 1.5, 25)

  // A previously-linked-but-closed PR means someone tried and gave up. That's
  // ambiguous — could be hard, could be abandoned — so a mild penalty only.
  if (linkedPRs(issue).some((p) => p.state === 'CLOSED')) score -= 10

  // Reactions mean the issue matters to people. Mild positive.
  score += Math.min((issue.reactions?.totalCount ?? 0) * 2, 10)

  return clamp(score)
}

export const DIMENSIONS = {
  responsiveness: d1_responsiveness,
  specificity: d2_specificity,
  approachability: d3_approachability,
  freshness: d4_freshness,
  openness: d5_openness,
}
