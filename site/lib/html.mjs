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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(description)}">
<link rel="canonical" href="${attr(ORIGIN + canonical)}">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${attr(ORIGIN + canonical)}">
<meta property="og:site_name" content="${SITE}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${root}/assets/style.css">
<link rel="alternate" type="application/rss+xml" title="${SITE} — new issues" href="${root}/feed.xml">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>%F0%9F%94%93</text></svg>">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body class="${bodyClass}">
<header class="site">
  <div class="wrap">
    <a class="logo" href="${root}/">unclaimed<span class="dot">.</span>dev</a>
    <nav class="site">
      <a href="${root}/new/">New today</a>
      <a href="${root}/browse/">Browse</a>
      <a href="${root}/how-it-works/">How it works</a>
      <a href="${root}/stats/">Stats</a>
    </nav>
  </div>
</header>
<main class="wrap">
${stale ? `<div class="banner">⚠ This data is ${Math.round(hoursSince(meta.generatedAt))} hours old — the daily refresh may have failed. Some issues may already be taken.</div>` : ''}
${body}
</main>
<footer class="site">
  <div class="wrap">
    ${meta ? footerStats(meta, root) : ''}
    <nav>
      <a href="${root}/how-it-works/">How we validate</a>
      <a href="${root}/stats/">Stats</a>
      <a href="${root}/feed.xml">RSS</a>
      <a href="https://github.com/kedarvartak/unclaimed">Source</a>
    </nav>
    <p>Issue data from the GitHub API. Every listing links to the canonical issue.</p>
  </div>
</footer>
<script src="${root}/assets/app.js" defer></script>
</body>
</html>`
}

/** The rejection numbers are the product thesis stated as a fact (docs/12 §5). */
function footerStats(meta, root) {
  const s = meta.stats
  const rejected = s.candidatesScanned - meta.counts.issues
  return `<p class="rejected">Scanned <strong>${s.candidatesScanned.toLocaleString()}</strong> labelled issues ·
    rejected <strong>${rejected.toLocaleString()}</strong> as claimed, stale, or unusable ·
    listed <strong>${meta.counts.issues.toLocaleString()}</strong>.
    <a href="${root}/how-it-works/">Why?</a></p>`
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
