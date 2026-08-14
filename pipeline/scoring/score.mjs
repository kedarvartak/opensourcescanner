// Composite scoring + board selection (docs/04 §3).

import { WEIGHTS, SCORE_THRESHOLD, SCORE_THRESHOLD_T2, MAX_ISSUES_PER_REPO } from './weights.mjs'
import { DIMENSIONS, hasMaintainerGuidance } from './dimensions.mjs'
import { linkedPRs } from '../../m0/lib/gates.mjs'

const FILE_PATH = /\b[\w./-]+\.(js|ts|tsx|jsx|py|go|rs|java|rb|php|c|cpp|h|css|html|md|yml|yaml|json|toml)\b/i
const REPRO = /steps to reproduce|to reproduce|reproduction steps/i

export function scoreIssue(issue, now = Date.now()) {
  const parts = {}
  for (const [name, fn] of Object.entries(DIMENSIONS)) parts[name] = fn(issue, now)

  const composite = Object.entries(WEIGHTS).reduce(
    (sum, [name, w]) => sum + w * parts[name],
    0
  )
  return { score: Math.round(composite), parts }
}

/** Short, factual badges. Facts the user can act on — never the score itself (D05). */
export function flagsFor(issue) {
  const flags = []
  const r = issue.repository ?? {}
  if (hasMaintainerGuidance(issue)) flags.push('mg') // maintainer left guidance
  if (FILE_PATH.test(issue.bodyText ?? '')) flags.push('fp') // references a file path
  if (REPRO.test(issue.bodyText ?? '')) flags.push('rp') // has repro steps
  if (r.hasContributing) flags.push('cg') // has CONTRIBUTING.md
  if ((issue.comments?.totalCount ?? 0) === 0) flags.push('un') // untouched — nobody circling
  if (linkedPRs(issue).some((p) => p.state === 'CLOSED')) flags.push('pc') // previously attempted
  return flags
}

/**
 * Select the board: threshold by tier, then cap per repo, then sort by score.
 *
 * The per-repo cap runs BEFORE the global sort so a single well-run project
 * can't take the entire top of the board — that would be both bad for users
 * (monotonous) and bad for maintainers (a dogpile). See R5 and assertion A8.
 */
export function selectBoard(scored) {
  const eligible = scored.filter(
    (i) => i.score >= (i._tier === 'tier_2' ? SCORE_THRESHOLD_T2 : SCORE_THRESHOLD)
  )

  const byRepo = new Map()
  for (const issue of eligible.sort((a, b) => b.score - a.score)) {
    const key = issue.repository.nameWithOwner
    const list = byRepo.get(key) ?? []
    if (list.length < MAX_ISSUES_PER_REPO) {
      list.push(issue)
      byRepo.set(key, list)
    }
  }

  return [...byRepo.values()].flat().sort((a, b) => b.score - a.score)
}

/**
 * "Today's 10" — the daily ritual object (D26).
 *
 * Deterministic per date so it's shareable and stable within a day, but rotated
 * so the set genuinely differs tomorrow even when the board barely changed.
 * Spread across repos and languages: ten issues from one project isn't a daily
 * digest, it's a dogpile.
 */
export function todaysPicks(board, dateStr, count = 10) {
  const seed = hash(dateStr)
  // Rank by score but rotate the starting offset by date, drawing from the top
  // half so quality stays high while the specific ten change.
  const pool = board.slice(0, Math.max(count * 6, Math.floor(board.length / 2)))
  const picks = []
  const usedRepos = new Set()
  const usedLangs = new Map()

  for (let i = 0; i < pool.length && picks.length < count; i++) {
    const issue = pool[(seed + i * 7919) % pool.length] // 7919 prime ⇒ full cycle
    if (!issue || picks.includes(issue)) continue
    const repo = issue.repository.nameWithOwner
    const lang = issue.repository.primaryLanguage?.name ?? '?'
    if (usedRepos.has(repo)) continue
    if ((usedLangs.get(lang) ?? 0) >= 3) continue // no language takes over the day
    usedRepos.add(repo)
    usedLangs.set(lang, (usedLangs.get(lang) ?? 0) + 1)
    picks.push(issue)
  }
  // Backfill if diversity constraints starved the list (small boards).
  for (const issue of pool) {
    if (picks.length >= count) break
    if (!picks.includes(issue)) picks.push(issue)
  }
  return picks
}

export function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
