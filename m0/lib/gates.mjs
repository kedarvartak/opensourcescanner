// Hard gates G1–G6 from docs/04 §1.
//
// Each gate is an independent predicate over an enriched issue record, so M0 can
// measure BOTH the per-gate rejection rate (how much does each gate cost us,
// alone?) and the joint pass rate. That distinction is the whole point of the
// spike: if one gate is rejecting 60% by itself, we need to know it's that one.
//
// Each returns { ok: true } or { ok: false, reason: string }.

import LABELS from '../../config/labels.json' with { type: 'json' }

const DAY = 24 * 60 * 60 * 1000
const ok = { ok: true }
const no = (reason) => ({ ok: false, reason })

export const THRESHOLDS = {
  REPO_PUSHED_WITHIN_DAYS: 60,
  ISSUE_UPDATED_WITHIN_DAYS: 120,
  OLD_ISSUE_MONTHS: 18,
  OLD_ISSUE_UPDATED_WITHIN_DAYS: 30,
  MIN_BODY_CHARS: 160,
  MIN_TITLE_CHARS: 15,
  MIN_STARS: 25,
  MIN_RECENT_AUTHORS: 2,
  MAX_BEGINNER_LABEL_RATIO: 0.4,
  MAX_TASKLIST_ITEMS: 5,
  CLAIM_TTL_DAYS: 21,
}

const BOT_LOGINS = new Set([
  'dependabot', 'dependabot[bot]', 'renovate', 'renovate[bot]',
  'github-actions', 'github-actions[bot]', 'imgbot', 'imgbot[bot]',
  'snyk-bot', 'allcontributors', 'allcontributors[bot]', 'codecov',
  'greenkeeper[bot]', 'mergify[bot]', 'sonarcloud[bot]',
])

// OSI-approved SPDX ids we accept. Deliberately conservative: an unlicensed repo
// is not legally contributable, so this is correctness, not taste (docs/04 G3.5).
const OSI_LICENSES = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'GPL-2.0', 'GPL-3.0',
  'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0', 'MPL-2.0', 'ISC', 'Unlicense', 'Zlib',
  'EPL-2.0', 'EPL-1.0', 'CDDL-1.0', 'BSL-1.0', 'PostgreSQL', 'OFL-1.1',
  'Artistic-2.0', 'NCSA', 'MS-PL', 'ECL-2.0', 'CC0-1.0',
])

const PLAYGROUND_PATTERNS = [
  /first-?contributions?/i, /hacktoberfest-?(practice|starter|sample)/i,
  /^awesome-/i, /-tutorial$/i, /^learn-/i, /^demo-/i, /playground/i,
  /^30-days-of/i, /coding-?challenge/i, /interview-?questions?/i,
]

export const CLAIM_PATTERNS = [
  /\bi(?:'d| would)? like to (?:work on|take|try)\b/i,
  /\bcan i (?:work on|take|try|have|do)\b/i,
  /\bi'?m (?:working on|taking|on) (?:this|it)\b/i,
  /\bi(?:'ll| will) (?:work on|take|try|do) (?:this|it)\b/i,
  /\btaking (?:this|it) (?:up|on)\b/i,
  /\bworking on (?:this|it)\b/i,
  /\bassign (?:this )?to me\b/i,
  /^\/assign/im,
  /\bpr incoming\b/i,
  /\blet me (?:try|take|work on) (?:this|it)\b/i,
]

// Umbrella markers that appear in titles rather than as checkbox lists.
const UMBRELLA_TITLE =
  /^\s*[\[(]?\s*(meta|tracking|epic|umbrella|roadmap|rfc)\s*[\])]?\s*[:\-–]?\s/i

const daysSince = (iso, now) => (now - new Date(iso).getTime()) / DAY
const lower = (s) => (s || '').toLowerCase()

// ─── G1 Structural ──────────────────────────────────────────────────────────

export function G1_structural(issue) {
  if (issue.__typename !== 'Issue') return no('not an issue (PR)')
  if (issue.locked) return no('locked')
  const author = issue.author
  if (!author) return no('ghost author')
  if (author.__typename === 'Bot') return no('bot author')
  if (BOT_LOGINS.has(lower(author.login))) return no(`bot author: ${author.login}`)
  return ok
}

// ─── G2 Takeability — the differentiator (docs/04 §1 G2) ────────────────────

/** Pull every PR referenced by this issue out of the timeline. */
export function linkedPRs(issue) {
  const out = []
  for (const node of issue.timelineItems?.nodes ?? []) {
    const pr = node?.source ?? node?.subject
    if (pr?.__typename === 'PullRequest') out.push(pr)
  }
  return out
}

export function G2_takeability(issue, now = Date.now()) {
  if ((issue.assignees?.totalCount ?? 0) > 0) return no('assigned')

  const prs = linkedPRs(issue)
  if (prs.some((p) => p.state === 'OPEN')) return no('open linked PR')
  if (prs.some((p) => p.state === 'MERGED')) return no('merged linked PR (stale)')

  const claim = softClaim(issue, now)
  if (claim) return no(`soft-claimed by ${claim.login} ${Math.round(claim.ageDays)}d ago`)

  return ok
}

/**
 * Soft-claim detection with expiry (docs/04 §2). A claim older than CLAIM_TTL
 * whose author never opened a PR means the issue is free again — permanently
 * excluding those would throw away a large, good slice of the board.
 */
export function softClaim(issue, now = Date.now()) {
  const prAuthors = new Set(
    linkedPRs(issue).map((p) => lower(p.author?.login)).filter(Boolean)
  )
  for (const c of issue.comments?.nodes ?? []) {
    if (!c?.bodyText) continue
    // A maintainer saying "I'll take this" is not a claim by an outsider, and
    // "go ahead, work on it" from a maintainer is the opposite of a claim.
    if (['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.authorAssociation)) continue
    const login = lower(c.author?.login)
    if (!login || prAuthors.has(login)) continue
    if (!CLAIM_PATTERNS.some((re) => re.test(c.bodyText))) continue
    const ageDays = daysSince(c.createdAt, now)
    if (ageDays <= THRESHOLDS.CLAIM_TTL_DAYS) {
      return { login: c.author.login, ageDays, text: c.bodyText.slice(0, 120) }
    }
  }
  return null
}

// ─── G3 Repo viability ──────────────────────────────────────────────────────

export function G3_repoViability(issue, now = Date.now()) {
  const r = issue.repository
  if (!r) return no('no repo data')
  if (r.isArchived) return no('archived')
  if (r.isDisabled) return no('disabled')
  if (!r.hasIssuesEnabled) return no('issues disabled')
  if (r.isMirror) return no('mirror')
  if (r.isFork) return no('fork')
  if (daysSince(r.pushedAt, now) > THRESHOLDS.REPO_PUSHED_WITHIN_DAYS) {
    return no(`repo stale (${Math.round(daysSince(r.pushedAt, now))}d since push)`)
  }
  const spdx = r.licenseInfo?.spdxId
  if (!spdx || spdx === 'NOASSERTION') return no('no license')
  if (!OSI_LICENSES.has(spdx)) return no(`non-OSI license: ${spdx}`)
  if ((r.stargazerCount ?? 0) < THRESHOLDS.MIN_STARS) {
    return no(`under ${THRESHOLDS.MIN_STARS} stars`)
  }
  // Requires the repo-enrichment pass; skipped if absent so the gate can be
  // measured independently of pass ordering.
  if (r.recentAuthors != null && r.recentAuthors < THRESHOLDS.MIN_RECENT_AUTHORS) {
    return no(`only ${r.recentAuthors} committer(s) in 90d`)
  }
  return ok
}

// ─── G4 Issue relevance ─────────────────────────────────────────────────────

export function G4_relevance(issue, now = Date.now()) {
  const updatedAgo = daysSince(issue.updatedAt, now)
  if (updatedAgo > THRESHOLDS.ISSUE_UPDATED_WITHIN_DAYS) {
    return no(`no activity in ${Math.round(updatedAgo)}d`)
  }
  const ageMonths = daysSince(issue.createdAt, now) / 30
  if (
    ageMonths > THRESHOLDS.OLD_ISSUE_MONTHS &&
    updatedAgo > THRESHOLDS.OLD_ISSUE_UPDATED_WITHIN_DAYS
  ) {
    return no(`${Math.round(ageMonths)}mo old and quiet`)
  }
  const names = (issue.labels?.nodes ?? []).map((l) => lower(l.name))
  const blocking = LABELS.blocking.find((b) => names.includes(lower(b)))
  if (blocking) return no(`blocking label: ${blocking}`)

  // Umbrella/tracking issues look approachable and are weeks of work.
  const unchecked = (issue.bodyText?.match(/^\s*[-*]\s*\[ \]/gm) ?? []).length
  if (unchecked > THRESHOLDS.MAX_TASKLIST_ITEMS) {
    return no(`umbrella issue (${unchecked} unchecked tasks)`)
  }
  // Maintainers also mark umbrellas in the TITLE, and those carry no checkboxes
  // at all — found by eye in the first real board, where "[META] Adding
  // subfeatures to audits" sailed through the checkbox test.
  if (UMBRELLA_TITLE.test(issue.title ?? '')) return no('umbrella/tracking issue (title)')

  return ok
}

// ─── G5 Actionability ───────────────────────────────────────────────────────

/** Strip code fences, images, links and HTML comments before measuring substance. */
export function cleanBody(bodyText = '') {
  return bodyText
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function G5_actionability(issue) {
  const title = (issue.title || '').trim()
  if (title.length < THRESHOLDS.MIN_TITLE_CHARS) return no('title too short')
  if (/^(test|issue|asdf|todo|untitled)\.?$/i.test(title)) return no('placeholder title')

  const body = cleanBody(issue.bodyText)
  if (body.length < THRESHOLDS.MIN_BODY_CHARS) {
    return no(`body too thin (${body.length} chars)`)
  }
  // An unfilled template is worse than no body: it looks substantial and says nothing.
  if (/\[ \] I have searched|<!-- *(describe|please) /i.test(issue.bodyText || '')) {
    const withoutTemplate = body.replace(/\[ \][^\n]*/g, '').trim()
    if (withoutTemplate.length < THRESHOLDS.MIN_BODY_CHARS) return no('unfilled template')
  }
  return ok
}

// ─── G6 Anti-farming ────────────────────────────────────────────────────────

export function G6_antiFarming(issue) {
  const r = issue.repository
  if (!r) return no('no repo data')

  const name = r.nameWithOwner || ''
  if (PLAYGROUND_PATTERNS.some((re) => re.test(name.split('/')[1] || ''))) {
    return no('contribution playground')
  }
  if (r.denylisted) return no('denylisted')

  // Legitimate projects label a MINORITY of their backlog as beginner-friendly.
  // A repo where most issues carry the label is farming (docs/04 G6.1).
  if (r.beginnerLabelRatio != null && r.openIssues?.totalCount >= 10) {
    if (r.beginnerLabelRatio > THRESHOLDS.MAX_BEGINNER_LABEL_RATIO) {
      return no(`label farming (${Math.round(r.beginnerLabelRatio * 100)}% beginner-labelled)`)
    }
  }
  if (!r.primaryLanguage?.name) return no('no primary language')
  return ok
}

// ─── Composition ────────────────────────────────────────────────────────────

export const GATES = [
  ['G1_structural', G1_structural],
  ['G4_relevance', G4_relevance],
  ['G5_actionability', G5_actionability],
  ['G2_takeability', G2_takeability],
  ['G3_repoViability', G3_repoViability],
  ['G6_antiFarming', G6_antiFarming],
]

/** Cheapest-first, short-circuiting — mirrors the production ordering (docs/07 §4). */
export function validate(issue, now = Date.now()) {
  for (const [name, gate] of GATES) {
    const r = gate(issue, now)
    if (!r.ok) return { ok: false, gate: name, reason: r.reason }
  }
  return { ok: true }
}

/** Every gate, independently — this is what M0 exists to measure. */
export function validateAll(issue, now = Date.now()) {
  const results = {}
  for (const [name, gate] of GATES) results[name] = gate(issue, now)
  return results
}
