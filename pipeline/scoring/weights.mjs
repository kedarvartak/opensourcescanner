// LOCKED 2026-08-15. Rationale in docs/04 §3. Change only with data from state/history.
//
// These weights encode who the product is for. Responsiveness leads because the
// growth loop is "a user gets a PR merged and tells someone" — nothing else
// produces word-of-mouth, and an unmergeable repo is the one silent failure left
// after the hard gates.

export const WEIGHTS = {
  responsiveness: 0.30, // D1 — will a human review my PR?
  specificity: 0.25, // D2 — can I start without asking questions?
  openness: 0.18, // D5 — am I competing with six other people?
  approachability: 0.15, // D3 — is the project set up for newcomers?
  freshness: 0.12, // D4 — is this still live?
}

export const SCORE_THRESHOLD = 55 // tier-1 seed labels
export const SCORE_THRESHOLD_T2 = 65 // tier-2 ("help wanted") — higher bar
export const MAX_ISSUES_PER_REPO = 4 // per day on the board (docs/04 §3, R5)
export const TODAYS_PICK_COUNT = 10 // the daily ritual object (D26)

// Build assertion A7. Floating point makes an exact === comparison unsafe.
const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
if (Math.abs(sum - 1) > 1e-9) {
  throw new Error(`WEIGHTS must sum to 1.0, got ${sum}`)
}
