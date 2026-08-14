# Setup — going live

Four steps. Everything else is automatic.

---

## 1. Create the harvest token (2 min)

The pipeline needs more than the 1,000 req/hr that Actions' built-in `GITHUB_TOKEN`
allows. Create a **fine-grained personal access token** with public-read access only:

1. https://github.com/settings/personal-access-tokens/new
2. Name: `unclaimed-harvest`
3. Expiration: 1 year (calendar-reminder the rotation)
4. Repository access: **Public repositories (read-only)**
5. Permissions: leave defaults — public read is all we use
6. Generate, copy the token

Add it to the repo:

```bash
gh secret set GH_HARVEST_TOKEN --repo kedarvartak/unclaimed
# paste the token when prompted
```

> The token only ever exists in CI. The browser makes **zero** GitHub API calls —
> that's an architectural invariant, not a preference (docs/05 §8).

---

## 2. Connect Cloudflare Pages (5 min)

Cloudflare Pages builds from private repos on the free tier, and supports the
`_headers` file we need for the cache strategy. (GitHub Pages needs a paid plan for
private repos, and gives no header control.)

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**
2. Authorize GitHub, pick `kedarvartak/unclaimed`
3. Build settings:
   - **Framework preset:** None
   - **Build command:** `node site/build.mjs`
   - **Build output directory:** `dist`
   - **Node version:** add env var `NODE_VERSION` = `20`
4. Deploy

Every push to `main` now rebuilds and deploys. The daily refresh commits data → that
push triggers the deploy. **That's the whole 24-hour loop, with no manual step.**

### Domain

In the Pages project → **Custom domains** → add `unclaimed.dev` (register it first;
Cloudflare Registrar sells it at cost). Set `SITE_ORIGIN` as a build env var if you use
a different domain, so canonical URLs and the sitemap point at the right host.

---

## 3. Trigger the first real run

```bash
gh workflow run refresh.yml --repo kedarvartak/unclaimed -f target=4000
gh run watch --repo kedarvartak/unclaimed
```

Takes 30–60 minutes on the first run (no `state/repo-health.json` cache yet;
subsequent runs reuse it for 7 days and are much faster).

---

## 4. Verify

```bash
gh run list --repo kedarvartak/unclaimed --limit 5
```

Then check the deployed site: the footer should read *"Scanned N labelled issues ·
rejected M ..."* with real numbers, and the homepage badge should say *verified
unclaimed <hours> ago*.

---

## The refresh loop, once set up

| When | What runs | Cost |
|---|---|---|
| 03:00 UTC daily | Full harvest → validate → score → emit → commit | ~25 min |
| 09:00, 15:00, 21:00 UTC | Re-validate the board only (drops newly-claimed issues) | ~2 min |
| Every 6 hours | Watchdog — fails loudly if data is >30h old | ~30 sec |
| Any time | `gh workflow run refresh.yml` — the manual button | — |

Budget: **~1,050 of the 2,000 free private-repo Actions minutes/month** (docs/03 §5a).

### If a run fails

Nothing breaks. Every failure path is designed to leave yesterday's validated data live
rather than publish something wrong (docs/09 §4). The site keeps serving, and the
staleness banner appears automatically in the browser once data passes 30 hours old.

To recover: `gh workflow run refresh.yml`.

### To roll back bad data

```bash
git revert <commit>   # data/ and state/ are committed, so this just works
git push
```

---

## Local development

```bash
npm run dev       # build + preview at http://localhost:4321
npm run harvest   # hits the API (uses `gh auth token` if no env var set)
npm run emit      # score + validate + write data/
npm run build     # regenerate dist/
```

No `npm install` — the whole thing is zero-dependency by design, so a nightly cron job
has no supply chain to break.
