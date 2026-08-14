// Card and badge rendering.
//
// Design rule from D05: never show the raw score. Show the FACTS behind it —
// "7/10 outsider PRs merged" is checkable; "87/100" invites arguing with an
// algorithm the reader can't see.

import { esc, ago, compactNum, slug } from './html.mjs'

const FLAG_LABELS = {
  mg: ['maintainer left guidance', 'good'],
  fp: ['points at a file', 'good'],
  rp: ['has repro steps', 'good'],
  cg: ['has CONTRIBUTING', ''],
  un: ['nobody circling', 'good'],
  pc: ['someone tried before', 'warn'],
}

/** Signals shown on a card. Facts only, each one actionable. */
export function signals(issue, repo, { verifiedAt } = {}) {
  const out = []

  if (verifiedAt) out.push(sig(`verified free ${ago(verifiedAt)}`, 'good'))

  const h = repo.h
  if (h?.rh != null) {
    const label = h.rh < 48 ? `maintainer replies in ~${Math.round(h.rh)}h` : `maintainer replies in ~${Math.round(h.rh / 24)}d`
    out.push(sig(label, h.rh <= 72 ? 'good' : h.rh > 240 ? 'warn' : ''))
  }
  if (h?.mr != null && h.np >= 3) {
    const pctv = Math.round(h.mr * 100)
    out.push(sig(`${h.mc}/${h.np} outsider PRs merged`, pctv >= 60 ? 'good' : pctv < 30 ? 'warn' : ''))
  }
  if (h?.rot > 0) out.push(sig(`${h.rot} PR${h.rot > 1 ? 's' : ''} rotting >90d`, 'warn'))

  for (const f of issue.fl ?? []) {
    const entry = FLAG_LABELS[f]
    if (entry) out.push(sig(entry[0], entry[1]))
  }

  if (issue.c > 6) out.push(sig(`${issue.c} comments — busy`, 'warn'))

  return `<div class="signals">${out.join('')}</div>`
}

const sig = (text, kind = '') => `<span class="sig ${kind}">${esc(text)}</span>`

export function issueCard(issue, repo, { root = '.', labels = [] } = {}) {
  const url = `https://github.com/${repo.n}/issues/${issue.n}`
  const repoUrl = `${root}/repo/${repo.n}/`
  const lang = repo.l
  return `<article class="card"
  data-lang="${esc(lang ?? '')}"
  data-type="${esc(issue.ty)}"
  data-stars="${repo.s}"
  data-score="${issue.sc}"
  data-comments="${issue.c}"
  data-resp="${repo.h?.rh ?? ''}"
  data-text="${esc((issue.t + ' ' + repo.n + ' ' + (issue.x || '')).toLowerCase())}">
  <div class="repo">
    <a class="name" href="${repoUrl}">${esc(repo.n)}</a>
    ${lang ? `<span class="sep">·</span><a href="${root}/${slug(lang)}/">${esc(lang)}</a>` : ''}
    <span class="sep">·</span><span>★ ${compactNum(repo.s)}</span>
    <span class="sep">·</span><span>${esc(repo.lic ?? '')}</span>
    <span class="sep">·</span><span>updated ${ago(issue.u)}</span>
  </div>
  <h3><a href="${url}" rel="noopener">${esc(issue.t)}</a></h3>
  ${issue.x ? `<p class="excerpt">${esc(issue.x)}</p>` : ''}
  ${signals(issue, repo, { verifiedAt: issue.vf })}
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

export function picksList(issues, repos, opts = {}) {
  return `<ol class="picks">${issues
    .map((i) => `<li>${issueCard(i, repos[i.r], opts)}</li>`)
    .join('')}</ol>`
}

export function chips(items, hrefFn, root) {
  return `<ul class="chips">${items
    .map((it) => `<li><a href="${hrefFn(it, root)}">${esc(it.k)} <span class="c">${it.c}</span></a></li>`)
    .join('')}</ul>`
}
