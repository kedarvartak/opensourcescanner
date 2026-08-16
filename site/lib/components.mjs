// Card and badge rendering.
//
// Design rule from D05: never show the raw score. Show the FACTS behind it —
// "7/10 outsider PRs merged" is checkable; "87/100" invites arguing with an
// algorithm the reader can't see.
//
// Colour is load-bearing, not decorative: blue means we cleared it, rust means
// somebody is already on it or the project will make you wait.

import { esc, ago, compactNum, slug } from './html.mjs'

const FLAG_LABELS = {
  mg: ['maintainer left guidance', 'good'],
  fp: ['points at a file', 'good'],
  rp: ['has repro steps', 'good'],
  cg: ['has CONTRIBUTING', ''],
  un: ['nobody circling', 'good'],
  pc: ['someone tried before', 'warn'],
}

const sig = (text, kind = '', extra = '') =>
  `<span class="sig ${kind}">${esc(text)}${extra}</span>`

/** A merge rate is a proportion, so draw it as one rather than as a badge. */
const bar = (fraction) =>
  `<span class="bar"><i style="--f:${fraction.toFixed(2)}"></i></span>`

/** Signals shown on a card. Facts only, each one actionable. */
export function signals(issue, repo) {
  const out = []
  const h = repo.h

  if (h?.rh != null) {
    const label =
      h.rh < 48
        ? `replies in ~${Math.round(h.rh)}h`
        : `replies in ~${Math.round(h.rh / 24)}d`
    out.push(sig(label, h.rh <= 72 ? 'good' : h.rh > 240 ? 'warn' : ''))
  }
  if (h?.mr != null && h.np >= 3) {
    const pct = Math.round(h.mr * 100)
    out.push(
      sig(`${h.mc}/${h.np} outside PRs merged`, pct >= 60 ? 'good' : pct < 30 ? 'warn' : '', bar(h.mr))
    )
  }
  if (h?.rot > 0) out.push(sig(`${h.rot} PR${h.rot > 1 ? 's' : ''} rotting >90d`, 'warn'))

  for (const f of issue.fl ?? []) {
    const entry = FLAG_LABELS[f]
    if (entry) out.push(sig(entry[0], entry[1]))
  }

  if (issue.c > 6) out.push(sig(`${issue.c} comments — busy`, 'warn'))

  return `<div class="signals">${out.join('')}</div>`
}

export function issueCard(issue, repo, { root = '.' } = {}) {
  const url = `https://github.com/${repo.n}/issues/${issue.n}`
  const lang = repo.l
  return `<article class="card"
  data-lang="${esc(lang ?? '')}"
  data-type="${esc(issue.ty)}"
  data-stars="${repo.s}"
  data-score="${issue.sc}"
  data-comments="${issue.c}"
  data-resp="${repo.h?.rh ?? ''}"
  data-text="${esc((issue.t + ' ' + repo.n + ' ' + (issue.x || '')).toLowerCase())}">
  <div class="card-top">
    <a class="slug" href="${root}/repo/${repo.n}/">${esc(repo.n)}</a>
    <span class="num">#${issue.n}</span>
    <span class="stamp">cleared ${ago(issue.vf)}</span>
  </div>
  <h3><a href="${url}" rel="noopener">${esc(issue.t)}</a></h3>
  ${issue.x ? `<p class="excerpt">${esc(issue.x)}</p>` : ''}
  <div class="facts">
    ${lang ? `<a href="${root}/${slug(lang)}/">${esc(lang)}</a>` : ''}
    <span>★ ${compactNum(repo.s)}</span>
    ${repo.lic ? `<span>${esc(repo.lic)}</span>` : ''}
    <span>updated ${ago(issue.u)}</span>
  </div>
  ${signals(issue, repo)}
</article>`
}

export function boardList(issues, repos, opts = {}) {
  if (!issues.length) {
    return `<div class="empty"><p>No issues match. Try widening the filters.</p></div>`
  }
  return `<ul class="board" id="board">${issues
    .map((i) => `<li>${issueCard(i, repos[i.r], opts)}</li>`)
    .join('')}</ul>`
}

// Deliberately not an <ol> with visible ordinals: the ten picks are chosen for
// language and project spread, not ranked against each other, so numbering them
// would assert an order the data does not have.
export function picksList(issues, repos, opts = {}) {
  return `<ul class="picks" id="board">${issues
    .map((i) => `<li>${issueCard(i, repos[i.r], opts)}</li>`)
    .join('')}</ul>`
}

export function chips(items, hrefFn, root) {
  return `<ul class="chips">${items
    .map((it) => `<li><a href="${hrefFn(it, root)}">${esc(it.k)} <span class="c">${it.c}</span></a></li>`)
    .join('')}</ul>`
}
