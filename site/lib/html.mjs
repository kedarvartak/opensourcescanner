// Templating primitives. No framework: this site is "render JSON to HTML", and
// string templating does that with zero dependencies and instant builds — which
// matters for a job that runs unattended in cron every night.

export const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const attr = (s = '') => esc(s)

const SITE = 'unclaimed.dev'
const ORIGIN = process.env.SITE_ORIGIN || 'https://unclaimed.dev'

export function layout({
  title,
  description,
  canonical,
  body,
  meta,
  jsonLd,
  bodyClass = '',
  depth = 0,
}) {
  const root = depth === 0 ? '.' : Array(depth).fill('..').join('/')
  const fullTitle = title === SITE ? title : `${title} · ${SITE}`
  const stale = meta ? hoursSince(meta.generatedAt) > 30 : false

  const font = (f) =>
    `<link rel="preload" as="font" type="font/woff2" crossorigin href="${root}/assets/fonts/${f}.woff2">`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(description)}">
<meta name="theme-color" content="#faf9f7">
<meta name="color-scheme" content="light">
<link rel="canonical" href="${attr(ORIGIN + canonical)}">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${attr(ORIGIN + canonical)}">
<meta property="og:site_name" content="${SITE}">
<meta name="twitter:card" content="summary_large_image">
${font('sans')}${font('serif')}${font('mono')}
<link rel="stylesheet" href="${root}/assets/style.css">
<link rel="alternate" type="application/rss+xml" title="${SITE} — new issues" href="${root}/feed.xml">
<link rel="icon" href="${root}/assets/favicon.svg" type="image/svg+xml">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body class="${bodyClass}">
<header class="site">
  <div class="wrap">
    <a class="logo" href="${root}/">unclaimed.dev</a>
    <nav class="site">
      <a href="${root}/new/">New today</a>
      <a href="${root}/browse/">Browse</a>
      <a href="${root}/how-it-works/" data-secondary>How it works</a>
      <a href="${root}/stats/" data-secondary>Stats</a>
    </nav>
  </div>
</header>
${stale ? `<div class="banner">This data is ${Math.round(hoursSince(meta.generatedAt))} hours old — the daily refresh has not landed. Some issues may already be taken.</div>` : ''}
<main id="main">
${body}
</main>
<footer class="site">
  ${meta ? footerStats(meta, root) : ''}
  <nav>
    <a href="${root}/how-it-works/">How we validate</a>
    <a href="${root}/stats/">Stats</a>
    <a href="${root}/feed.xml">RSS</a>
    <a href="${root}/issues.json">JSON</a>
    <a href="https://github.com/kedarvartak/unclaimed">Source</a>
  </nav>
  <p class="fine">Issue data from the GitHub API. Every listing links to the canonical issue.</p>
</footer>
<script src="${root}/assets/app.js" defer></script>
</body>
</html>`
}

/** The rejection numbers are the product thesis stated as a fact (docs/12 §5). */
function footerStats(meta, root) {
  const s = meta.stats
  const taken = s.rejected?.G2_takeability ?? 0
  return `<p class="rejected">We read ${s.candidatesScanned.toLocaleString()} issues.
    <span class="took">${taken.toLocaleString()} were already taken.</span>
    <span class="go">${meta.counts.issues.toLocaleString()} are yours.</span>
    <a href="${root}/how-it-works/">See how every one was checked &rarr;</a></p>`
}

export const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 3600_000

export function ago(unixSeconds) {
  const s = Date.now() / 1000 - unixSeconds
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  const d = Math.round(s / 86400)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  return mo < 12 ? `${mo}mo ago` : `${Math.round(mo / 12)}y ago`
}

export const compactNum = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

export const slug = (s) =>
  String(s).toLowerCase().replace(/\+/g, 'p').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export { ORIGIN, SITE }
