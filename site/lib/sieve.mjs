// The sieve — a unit chart of every issue scanned in the last run, one square
// each, drawn straight from meta.stats.
//
// This is the hero, and it is deliberately not decoration: the product's entire
// value is the rejection logic, so the honest way to open the page is to show
// the rejection at full scale. It redraws itself from real numbers every night.
//
// Only three states get colour, because only three carry meaning:
//   graphite — rejected for ordinary reasons (dead repo, too vague, umbrella…)
//   rust     — ALREADY BEING WORKED ON. The thesis. GitHub shows these as free.
//   blue     — cleared. Of these, the ones listed today are at full strength.
//
// Rendered as four <path> elements rather than 3,000 <rect>s: identical pixels,
// four DOM nodes instead of three thousand, and ~4 KB brotli instead of ~40.

import { num } from './html.mjs'

/** Gates whose rejections are "this was never startable" rather than "taken". */
const DIM_GATES = [
  'G3_repoViability',
  'G5_actionability',
  'G4_relevance',
  'G1_structural',
  'G6_antiFarming',
]

const COLS = 120
const PITCH = 6
const DOT = 4

/**
 * Build the band breakdown. Exported separately so the legend and the prose
 * can quote exactly the same numbers the chart draws — if they ever disagree,
 * the page is lying, and that is the one thing this site cannot afford.
 */
export function sieveBands(meta) {
  const rejected = meta.stats.rejected ?? {}
  const scanned = meta.stats.candidatesScanned
  const listed = meta.counts.issues

  const dim = DIM_GATES.reduce((n, g) => n + (rejected[g] ?? 0), 0)
  const taken = rejected.G2_takeability ?? 0
  const cleared = Math.max(0, scanned - dim - taken)
  const held = Math.max(0, cleared - listed)

  return [
    { key: 'dim', n: dim, label: 'not startable', hint: 'dead project, too vague, or an umbrella issue' },
    { key: 'taken', n: taken, label: 'already taken', hint: 'someone has a pull request open — GitHub still shows these as unassigned' },
    { key: 'held', n: held, label: 'held back', hint: 'cleared, but capped so no single project floods the board' },
    { key: 'listed', n: Math.min(listed, cleared), label: 'listed today', hint: 'you can start any of these right now' },
  ].filter((b) => b.n > 0)
}

/**
 * Path data for `count` squares starting at grid index `start`.
 *
 * After `z` the pen returns to the start of the subpath — the square's own
 * top-left — so the next square in the same row is a fixed relative hop of one
 * PITCH. Emitting `m6 0…` instead of a fresh absolute `M714 126…` costs 12
 * chars per square instead of 16, and the sieve is the largest single thing
 * this page ships. Only a row wrap needs absolute coordinates again.
 */
function bandPath(start, count) {
  const cell = `h${DOT}v${DOT}h-${DOT}z`
  let d = ''
  for (let k = 0; k < count; k++) {
    const i = start + k
    const col = i % COLS
    d += k > 0 && col !== 0
      ? `m${PITCH} 0${cell}`
      : `M${col * PITCH} ${Math.floor(i / COLS) * PITCH}${cell}`
  }
  return d
}

export function sieveSvg(meta) {
  const bands = sieveBands(meta)
  const total = bands.reduce((n, b) => n + b.n, 0)
  const rows = Math.ceil(total / COLS)

  let i = 0
  const paths = bands.map((band) => {
    const d = bandPath(i, band.n)
    i += band.n
    return `<path class="sv-${band.key}" d="${d}"/>`
  })

  return `<svg class="sieve" viewBox="0 0 ${COLS * PITCH - (PITCH - DOT)} ${rows * PITCH - (PITCH - DOT)}"
  role="img" aria-label="${bands.map((b) => `${num(b.n)} ${b.label}`).join(', ')}"
  preserveAspectRatio="xMidYMid meet">${paths.join('')}</svg>`
}

/** The legend is four numbers with labels, so it is built as a stat row. */
export function sieveLegend(meta) {
  return `<ul class="legend">${sieveBands(meta)
    .map(
      (b) => `<li class="lg-${b.key}"><b>${num(b.n)}</b>
    <span class="k">${b.label}</span><i>${b.hint}</i></li>`
    )
    .join('')}</ul>`
}
