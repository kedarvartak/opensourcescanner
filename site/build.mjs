#!/usr/bin/env node
// Static site generator. Reads data/*.json, writes dist/.
//
// Emits ~thousands of prerendered pages: the traffic engine is long-tail search
// ("good first issues rust"), and a client-rendered SPA is invisible to it
// (docs/12 §2). Every page ships its issues as real HTML.

import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises'
import { layout, esc, slug, ago, compactNum, ORIGIN } from './lib/html.mjs'
import { boardList, picksList, chips } from './lib/components.mjs'
import { sieveSvg, sieveLegend, sieveBands } from './lib/sieve.mjs'

const ROOT = new URL('../', import.meta.url)
const DATA = new URL('data/', ROOT)
const DIST = new URL('dist/', ROOT)

// Don't generate a facet page with fewer than this — thin pages hurt the whole
// domain's rankings, so fold small facets into their parent instead (R9).
const MIN_INVENTORY = 8

async function main() {
  const t0 = Date.now()
  const meta = JSON.parse(await readFile(new URL('meta.json', DATA), 'utf8'))
  const { i: issues } = JSON.parse(await readFile(new URL(meta.shards.issues[0], DATA), 'utf8'))
  const { r: repos } = JSON.parse(await readFile(new URL(meta.shards.repos, DATA), 'utf8'))
  const facets = JSON.parse(await readFile(new URL(meta.shards.facets, DATA), 'utf8'))

  await rm(DIST, { recursive: true, force: true })
  await mkdir(DIST, { recursive: true })

  const urls = []
  const page = async (path, html) => {
    const dir = path === '/' ? DIST : new URL(`.${path}`, DIST)
    await mkdir(dir, { recursive: true })
    await writeFile(new URL('index.html', dir), html)
    urls.push(path)
  }

  const ctx = { meta, issues, repos, facets }
  const byKey = new Map(issues.map((i) => [`${repos[i.r].n}#${i.n}`, i]))
  const picks = meta.todaysPicks.map((k) => byKey.get(k)).filter(Boolean)

  // ── Home: Today's 10, the daily ritual object (D26) ─────────────────────
  await page('/', homePage(ctx, picks))

  // ── New today: the one page guaranteed to differ daily (D27) ────────────
  const dayAgo = Date.now() / 1000 - 86400
  const fresh = issues.filter((i) => i.fs >= dayAgo)
  await page('/new/', newPage(ctx, fresh))

  // ── Full board ──────────────────────────────────────────────────────────
  await page('/browse/', browsePage(ctx))

  // ── Language pages + language × type ────────────────────────────────────
  for (const { k: lang, c } of facets.languages) {
    if (c < MIN_INVENTORY) continue
    const langIssues = issues.filter((i) => repos[i.r].l === lang)
    await page(`/${slug(lang)}/`, langPage(ctx, lang, langIssues, 1))

    for (const { k: type } of facets.types) {
      const sub = langIssues.filter((i) => i.ty === type)
      if (sub.length < MIN_INVENTORY) continue
      await page(`/${slug(lang)}/${type}/`, langTypePage(ctx, lang, type, sub, 2))
    }
  }

  // ── Topic pages ─────────────────────────────────────────────────────────
  for (const { k: topic, c } of facets.topics) {
    if (c < MIN_INVENTORY) continue
    const sub = issues.filter((i) => (repos[i.r].t ?? []).includes(topic))
    if (sub.length < MIN_INVENTORY) continue
    await page(`/topics/${slug(topic)}/`, topicPage(ctx, topic, sub, 2))
  }

  // ── Repo pages ──────────────────────────────────────────────────────────
  for (let ri = 0; ri < repos.length; ri++) {
    const sub = issues.filter((i) => i.r === ri)
    if (!sub.length) continue
    await page(`/repo/${repos[ri].n}/`, repoPage(ctx, repos[ri], sub, 3))
  }

  // ── Issue detail: the long-tail workhorse ───────────────────────────────
  for (const issue of issues) {
    const repo = repos[issue.r]
    const similar = issues
      .filter((o) => o !== issue && (o.r === issue.r || repos[o.r].l === repo.l))
      .slice(0, 4)
    await page(`/issue/${repo.n}/${issue.n}/`, issuePage(ctx, issue, repo, similar, 4))
  }

  // ── Editorial / trust ───────────────────────────────────────────────────
  await page('/how-it-works/', howItWorksPage(ctx))
  await page('/stats/', statsPage(ctx))

  // ── Feeds, sitemap, robots ──────────────────────────────────────────────
  await writeFile(new URL('feed.xml', DIST), rssFeed(ctx, picks))
  await writeFile(new URL('issues.json', DIST), JSON.stringify(jsonFeed(ctx), null, 2))
  await writeFile(new URL('sitemap.xml', DIST), sitemap(urls))
  await writeFile(new URL('robots.txt', DIST), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`)
  await writeFile(new URL('_headers', DIST), headers())

  await cp(new URL('assets/', new URL('site/', ROOT)), new URL('assets/', DIST), { recursive: true })
  await cp(DATA, new URL('data/', DIST), { recursive: true })

  console.log(`\n✓ built ${urls.length} pages in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`  ${issues.length} issues · ${repos.length} repos · ${facets.languages.length} languages`)
  console.log(`  dist/\n`)
}

// ─── Pages ──────────────────────────────────────────────────────────────────

function homePage({ meta, issues, repos, facets }, picks) {
  const scanned = meta.stats.candidatesScanned
  const taken = sieveBands(meta).find((b) => b.key === 'taken')?.n ?? 0
  const scanDate = new Date(meta.generatedAt).toISOString().slice(0, 10)

  const body = `
<section class="scan">
  <p class="eyebrow">Scan ${scanDate} · ${scanned.toLocaleString()} labelled issues · one square each</p>
  ${sieveSvg(meta)}
  ${sieveLegend(meta)}
</section>

<section class="thesis">
  <h1><span class="took">${taken.toLocaleString()}</span> of today’s “good first issues”
  already had someone on them. <span class="free">${meta.counts.issues}</span> are actually free.</h1>
  <p class="lede">An issue with nobody assigned still isn't yours if somebody already opened a pull
  request against it — and GitHub's own filters won't show you that. We check every issue for a
  linked pull request, a live maintainer, and enough detail to start, then re-check the whole
  board every 24 hours.</p>
  <div class="actions">
    <a class="btn" href="#today">See today's ${picks.length}</a>
    <a class="btn ghost" href="/browse/">Browse all ${meta.counts.issues}</a>
  </div>
</section>

<div class="sec" id="today">
  <h2>Today's ${picks.length}</h2>
  <span class="meta">${scanDate} · a new set tomorrow</span>
  <span class="spacer"></span>
  <a href="/browse/" class="meta">browse all ${meta.counts.issues} →</a>
</div>
${picksList(picks, repos, { root: '.' })}

${section('By language', facets.languages.filter((l) => l.c >= MIN_INVENTORY), (l) => `/${slug(l.k)}/`)}
${section('By topic', facets.topics.filter((t) => t.c >= MIN_INVENTORY).slice(0, 24), (t) => `/topics/${slug(t.k)}/`)}
`
  return layout({
    title: 'unclaimed.dev',
    description: `${meta.counts.issues} open source issues verified unclaimed in the last 24 hours. No assigned issues, no linked PRs, no dead repos.`,
    canonical: '/',
    meta,
    body,
    jsonLd: itemListLd(picks, repos, '/'),
  })
}

function newPage({ meta, repos }, fresh) {
  const body = `
<section class="hero">
  <h1>New today</h1>
  <p class="lede">Issues that joined the board since yesterday's refresh. This page is
  different every day.</p>
</section>
<div class="sec"><h2>${fresh.length} new issue${fresh.length === 1 ? '' : 's'}</h2>
<span class="meta">as of ${new Date(meta.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</span></div>
${fresh.length ? boardList(fresh, repos, { root: '..' }) : `<div class="empty"><p>Nothing new in the last 24 hours. <a href="/browse/">Browse the full board →</a></p></div>`}
`
  return layout({
    title: 'New today',
    description: 'Open source issues added to the board in the last 24 hours, all verified unclaimed.',
    canonical: '/new/', meta, body, depth: 1,
  })
}

function browsePage({ meta, issues, repos, facets }) {
  const body = `
<section class="hero">
  <h1>All ${meta.counts.issues} unclaimed issues</h1>
  <p class="lede">Filter locally — nothing here calls the network.</p>
</section>
${filterBar(facets)}
${boardList(issues, repos, { root: '..' })}
`
  return layout({
    title: 'Browse every unclaimed issue',
    description: `Filter ${meta.counts.issues} verified-unclaimed open source issues by language, type, and maintainer responsiveness.`,
    canonical: '/browse/', meta, body, depth: 1,
    jsonLd: itemListLd(issues.slice(0, 30), repos, '/browse/'),
  })
}

function langPage({ meta, repos, facets }, lang, list, depth) {
  const types = facets.types
    .map((t) => ({ k: t.k, c: list.filter((i) => i.ty === t.k).length }))
    .filter((t) => t.c >= MIN_INVENTORY)
  const body = `
<section class="hero">
  <span class="verified">verified ${ago(Math.floor(new Date(meta.generatedAt) / 1000))}</span>
  <h1>${esc(lang)} issues you can actually pick up</h1>
  <p class="lede">${list.length} open ${esc(lang)} issue${list.length === 1 ? '' : 's'} — none assigned, none with an open
  pull request already attached, none in an abandoned repo. Re-checked every 24 hours.</p>
</section>
${types.length ? `<div class="sec"><h2>Narrow it down</h2></div>${chips(types, (t) => `/${slug(lang)}/${t.k}/`)}` : ''}
<div class="sec"><h2>${list.length} issues</h2><span class="meta" id="result-count"></span></div>
${boardList(list, repos, { root: '..' })}
`
  return layout({
    title: `Good first issues in ${lang}`,
    description: `${list.length} ${lang} open source issues verified unclaimed in the last 24 hours — no assigned issues, no hidden pull requests, no dead projects.`,
    canonical: `/${slug(lang)}/`, meta, body, depth,
    jsonLd: itemListLd(list.slice(0, 30), repos, `/${slug(lang)}/`),
  })
}

function langTypePage({ meta, repos }, lang, type, list, depth) {
  const nice = { bugs: 'bug fixes', docs: 'documentation', tests: 'test', features: 'feature', other: 'open' }[type] ?? type
  const body = `
<section class="hero">
  <h1>${esc(lang)} ${esc(nice)} issues, still unclaimed</h1>
  <p class="lede">${list.length} verified-free ${esc(lang)} ${esc(nice)} issue${list.length === 1 ? '' : 's'}.
  <a href="/${slug(lang)}/">All ${esc(lang)} issues →</a></p>
</section>
${boardList(list, repos, { root: '../..' })}
`
  return layout({
    title: `${lang} ${nice} issues for new contributors`,
    description: `${list.length} unclaimed ${lang} ${nice} issues, verified free within the last 24 hours.`,
    canonical: `/${slug(lang)}/${type}/`, meta, body, depth,
  })
}

function topicPage({ meta, repos }, topic, list, depth) {
  const body = `
<section class="hero">
  <h1>Unclaimed <span style="font-family:var(--mono)">${esc(topic)}</span> issues</h1>
  <p class="lede">${list.length} issue${list.length === 1 ? '' : 's'} in ${esc(topic)} projects, all verified free.</p>
</section>
${boardList(list, repos, { root: '../..' })}
`
  return layout({
    title: `Open source ${topic} issues to contribute to`,
    description: `${list.length} unclaimed issues in ${topic} projects, verified within 24 hours.`,
    canonical: `/topics/${slug(topic)}/`, meta, body, depth,
  })
}

function repoPage({ meta, repos }, repo, list, depth) {
  const h = repo.h
  const health = [
    h?.rh != null && `Maintainers reply in about ${h.rh < 48 ? `${Math.round(h.rh)} hours` : `${Math.round(h.rh / 24)} days`}.`,
    h?.mr != null && h.np >= 3 && `${h.mc} of the last ${h.np} pull requests from outside contributors were merged.`,
    h?.rot > 0 && `${h.rot} outside pull request${h.rot > 1 ? 's have' : ' has'} been open more than 90 days without a maintainer reply.`,
    repo.f.includes('contributing') && 'The project has a CONTRIBUTING guide.',
  ].filter(Boolean)

  const body = `
<section class="hero">
  <h1>${esc(repo.n)}</h1>
  <div class="facts">
    ${repo.l ? `<a href="${'../../..'}/${slug(repo.l)}/">${esc(repo.l)}</a>` : ''}
    <span>★ ${compactNum(repo.s)}</span>
    ${repo.lic ? `<span>${esc(repo.lic)}</span>` : ''}
  </div>
  <p class="lede">${list.length} issue${list.length === 1 ? '' : 's'} here are unclaimed right now.</p>
  <div class="actions">
    <a class="btn ghost" href="https://github.com/${esc(repo.n)}" rel="noopener">View on GitHub</a>
  </div>
</section>
${health.length ? `<div class="sec"><h2>What contributing here is like</h2></div>
<ul class="prose">${health.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
<div class="sec"><h2>Open issues you can take</h2></div>
${boardList(list, repos, { root: '../../..' })}
`
  return layout({
    title: `Contribute to ${repo.n}`,
    description: `${list.length} unclaimed issues in ${repo.n}, plus how responsive the maintainers actually are to outside contributors.`,
    canonical: `/repo/${repo.n}/`, meta, body, depth,
  })
}

function issuePage({ meta, repos }, issue, repo, similar, depth) {
  const url = `https://github.com/${repo.n}/issues/${issue.n}`
  const root = '../../../..'
  const body = `
<section class="hero">
  <span class="verified">cleared ${ago(issue.vf)}</span>
  <div class="facts">
    <a href="${root}/repo/${esc(repo.n)}/">${esc(repo.n)}</a>
    <span>#${issue.n}</span>
    ${repo.l ? `<a href="${root}/${slug(repo.l)}/">${esc(repo.l)}</a>` : ''}
    <span>★ ${compactNum(repo.s)}</span>
    ${repo.lic ? `<span>${esc(repo.lic)}</span>` : ''}
  </div>
  <h1>${esc(issue.t)}</h1>
  ${issue.x ? `<p class="lede">${esc(issue.x)}</p>` : ''}
  <div class="actions">
    <a class="btn" href="${url}" rel="noopener">Open #${issue.n} on GitHub</a>
    <a class="btn ghost" href="${root}/repo/${esc(repo.n)}/">More from ${esc(repo.n)}</a>
  </div>
</section>

<div class="sec"><h2>What we checked</h2></div>
<ul class="prose">
  <li>Nobody is assigned, and no open pull request references it — verified ${ago(issue.vf)}.</li>
  ${(issue.fl ?? []).includes('mg') ? '<li>A maintainer has already left guidance in the thread.</li>' : ''}
  ${(issue.fl ?? []).includes('fp') ? '<li>The issue points at a specific file, so you know where to start.</li>' : ''}
  ${(issue.fl ?? []).includes('rp') ? '<li>It includes reproduction steps.</li>' : ''}
  ${(issue.fl ?? []).includes('un') ? '<li>Nobody has commented, so you are not competing with anyone.</li>' : ''}
  ${repo.h?.mr != null && repo.h.np >= 3 ? `<li>${repo.h.mc} of the last ${repo.h.np} pull requests from outside contributors were merged.</li>` : ''}
  ${repo.h?.rh != null ? `<li>Maintainers reply in about ${repo.h.rh < 48 ? `${Math.round(repo.h.rh)} hours` : `${Math.round(repo.h.rh / 24)} days`}.</li>` : ''}
</ul>

${similar.length ? `<div class="sec"><h2>Similar unclaimed issues</h2></div>${boardList(similar, repos, { root })}` : ''}
`
  return layout({
    title: issue.t.length > 60 ? issue.t.slice(0, 57) + '…' : issue.t,
    description: `${repo.n}#${issue.n} — verified unclaimed. ${issue.x?.slice(0, 120) ?? ''}`,
    canonical: `/issue/${repo.n}/${issue.n}/`, meta, body, depth,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      name: issue.t,
      codeRepository: `https://github.com/${repo.n}`,
      programmingLanguage: repo.l,
      url,
    },
  })
}

function howItWorksPage({ meta }) {
  const r = meta.stats.rejected
  const rows = Object.entries(r).sort((a, b) => b[1] - a[1])
  const gateNames = {
    G1_structural: 'Not a real, open issue (bot-authored, locked, or actually a PR)',
    G2_takeability: 'Already taken — assigned, or an open/merged pull request references it',
    G3_repoViability: 'Repo not viable — archived, unlicensed, or no recent commits',
    G4_relevance: 'Stale or blocked — no activity in months, or an umbrella/tracking issue',
    G5_actionability: 'Not enough context to start — empty or template-only body',
    G6_antiFarming: 'Label farming — a contribution playground or star-farming repo',
  }
  const body = `
<section class="hero">
  <h1>How we decide what gets listed</h1>
  <p class="lede">We scanned <strong>${meta.stats.candidatesScanned.toLocaleString()}</strong> issues
  carrying a beginner or help-wanted label and listed <strong>${meta.counts.issues.toLocaleString()}</strong>.
  Here is exactly what happened to the rest.</p>
</section>

<section class="scan">
  ${sieveSvg(meta)}
  ${sieveLegend(meta)}
</section>

<div class="sec"><h2>Why issues were rejected</h2></div>
<div class="table-scroll"><table class="prose">
<tr><th>Reason</th><th>Issues rejected</th></tr>
${rows
  .map(
    ([g, c]) =>
      `<tr${g === 'G2_takeability' ? ' class="is-taken"' : ''}><td>${esc(gateNames[g] ?? g)}</td><td>${c.toLocaleString()}</td></tr>`
  )
  .join('')}
</table></div>

<div class="prose">
<h2>The gates, in order</h2>
<p>An issue must pass <em>every</em> one of these. No score can rescue a failure.</p>
<h3>1. It must be genuinely takeable</h3>
<p>Nobody assigned. No open pull request referencing it. No merged pull request that should
have closed it. No unexpired claim in the comments. <strong>This is the check other tools
don't do</strong> — GitHub's own <code>no:assignee</code> filter misses every issue where
someone quietly opened a PR, which is the most common way an issue is really taken.</p>
<h3>2. The project must be alive</h3>
<p>Not archived, issues enabled, pushed within 60 days, at least two different people
committing in the last 90 days, and an OSI-approved licence. A repo with no licence isn't
legally contributable, so we exclude it regardless of how good the issue looks.</p>
<h3>3. The issue must still be relevant</h3>
<p>Activity within 120 days, no blocking labels, and not an umbrella issue with a long
task list hiding weeks of work behind a friendly label.</p>
<h3>4. There must be enough to go on</h3>
<p>A real body, not an unfilled template. Enough context that you could open the file and
start.</p>
<h3>5. The repo must not be farming contributors</h3>
<p>Projects that label most of their backlog "good first issue" are farming for stars or
contributors, and the label carries no information there.</p>

<h2>Then we rank what's left</h2>
<p>Ranking weighs maintainer responsiveness most heavily — whether outside pull requests
actually get merged, and how fast maintainers reply. An issue you can start but whose PR
will never be reviewed is still a wasted evening.</p>

<h2>What we can't check</h2>
<p>Coordination that happens off GitHub — a Discord thread, a maintainer's private plan —
is invisible to any tool built on the API, including this one. We verify every listing
within 24 hours, and every card says when. That's an honest ceiling, not a perfect one.</p>
</div>
`
  return layout({
    title: 'How we validate every issue',
    description: 'The exact gates every issue must pass to be listed, and the live count of what got rejected and why.',
    canonical: '/how-it-works/', meta, body, depth: 1,
  })
}

function statsPage({ meta, issues, repos, facets }) {
  const withGuidance = issues.filter((i) => (i.fl ?? []).includes('mg')).length
  const uncrowded = issues.filter((i) => (i.fl ?? []).includes('un')).length
  const responsive = issues.filter((i) => repos[i.r].h?.rh != null && repos[i.r].h.rh <= 72).length
  const body = `
<section class="hero">
  <h1>Stats</h1>
  <p class="lede">Updated with every refresh. Last run
  ${new Date(meta.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.</p>
</section>
<div class="statgrid">
  <div class="stat"><div class="n">${meta.stats.candidatesScanned.toLocaleString()}</div><div class="l">issues scanned</div></div>
  <div class="stat hi"><div class="n">${meta.counts.issues.toLocaleString()}</div><div class="l">listed on the board</div></div>
  <div class="stat"><div class="n">${(meta.stats.passRate * 100).toFixed(1)}%</div><div class="l">pass rate</div></div>
  <div class="stat"><div class="n">${meta.counts.repos.toLocaleString()}</div><div class="l">projects</div></div>
  <div class="stat"><div class="n">${meta.counts.languages}</div><div class="l">languages</div></div>
  <div class="stat"><div class="n">${uncrowded.toLocaleString()}</div><div class="l">with nobody circling</div></div>
  <div class="stat"><div class="n">${withGuidance.toLocaleString()}</div><div class="l">where a maintainer left guidance</div></div>
  <div class="stat"><div class="n">${responsive.toLocaleString()}</div><div class="l">in repos replying within 3 days</div></div>
</div>
<div class="sec"><h2>Inventory by language</h2></div>
${chips(facets.languages, (l) => `/${slug(l.k)}/`)}
`
  return layout({
    title: 'Stats',
    description: 'How many issues we scan, how many survive validation, and what the board looks like right now.',
    canonical: '/stats/', meta, body, depth: 1,
  })
}

// ─── Fragments ──────────────────────────────────────────────────────────────

/** Render a facet section, or nothing at all — an empty heading looks broken. */
const section = (title, items, hrefFn) =>
  items.length ? `<div class="sec"><h2>${esc(title)}</h2></div>${chips(items, hrefFn)}` : ''

function filterBar(facets) {
  return `<div class="filters">
  <input type="search" id="f-search" placeholder="Search titles and repos… (press /)" aria-label="Search issues">
  <select id="f-lang" aria-label="Language"><option value="">Any language</option>
    ${facets.languages.map((l) => `<option value="${esc(l.k)}">${esc(l.k)} (${l.c})</option>`).join('')}</select>
  <select id="f-type" aria-label="Type"><option value="">Any type</option>
    ${facets.types.map((t) => `<option value="${esc(t.k)}">${esc(t.k)} (${t.c})</option>`).join('')}</select>
  <select id="f-sort" aria-label="Sort"><option value="score">Best match</option>
    <option value="stars">Most stars</option><option value="quiet">Least crowded</option></select>
  <label class="toggle"><input type="checkbox" id="f-quiet"> nobody circling</label>
  <label class="toggle"><input type="checkbox" id="f-responsive"> replies within a week</label>
  <span class="meta" id="result-count"></span>
</div>`
}

function itemListLd(list, repos, path) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    url: ORIGIN + path,
    numberOfItems: list.length,
    itemListElement: list.map((i, n) => ({
      '@type': 'ListItem',
      position: n + 1,
      name: i.t,
      url: `https://github.com/${repos[i.r].n}/issues/${i.n}`,
    })),
  }
}

function rssFeed({ meta, repos }, picks) {
  const items = picks
    .map((i) => {
      const repo = repos[i.r]
      return `<item>
<title>${esc(`${repo.n}: ${i.t}`)}</title>
<link>https://github.com/${repo.n}/issues/${i.n}</link>
<guid isPermaLink="false">${repo.n}#${i.n}</guid>
<pubDate>${new Date(meta.generatedAt).toUTCString()}</pubDate>
<description>${esc(i.x ?? '')}</description>
</item>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>unclaimed.dev — today's issues</title>
<link>${ORIGIN}/</link>
<description>Open source issues verified unclaimed within the last 24 hours.</description>
<lastBuildDate>${new Date(meta.generatedAt).toUTCString()}</lastBuildDate>
${items}
</channel></rss>`
}

function jsonFeed({ meta, issues, repos }) {
  return {
    generatedAt: meta.generatedAt,
    count: issues.length,
    issues: issues.map((i) => ({
      repo: repos[i.r].n,
      number: i.n,
      title: i.t,
      url: `https://github.com/${repos[i.r].n}/issues/${i.n}`,
      language: repos[i.r].l,
      stars: repos[i.r].s,
      type: i.ty,
      verifiedAt: i.vf,
    })),
  }
}

function sitemap(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${ORIGIN}${u}</loc><changefreq>daily</changefreq></url>`).join('\n')}
</urlset>`
}

/** Cache strategy from docs/05 §6 — this is why we host on Cloudflare Pages. */
function headers() {
  return `/assets/*
  Cache-Control: public, max-age=31536000, immutable

/data/*.json
  Cache-Control: public, max-age=31536000, immutable

/data/meta.json
  Cache-Control: public, max-age=300

/*
  Cache-Control: public, max-age=0, must-revalidate
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`
}

main().catch((e) => {
  console.error(`\n✖ ${e.stack}`)
  process.exit(1)
})
