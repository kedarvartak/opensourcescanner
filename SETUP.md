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

## 2. Connect Vercel (5 min)

Vercel builds from private repos on the free Hobby plan, and `vercel.json` gives us the
cache headers the data strategy needs.

1. https://vercel.com/new → **Import Git Repository** → `kedarvartak/unclaimed`
2. Vercel reads `vercel.json`, so leave the build settings alone. For the record it sets:
   - **Framework preset:** Other
   - **Build command:** `node site/build.mjs`
   - **Output directory:** `dist`
   - **Install command:** a no-op — this project has zero dependencies
3. Deploy

Every push to `main` now rebuilds and deploys. The daily refresh commits data → that
push triggers the deploy. **That's the whole 24-hour loop, with no manual step.**

> **Hobby is non-commercial only.** That is fine here because monetization is
> permanently out of scope (D30). If that ever changes, this needs Vercel Pro at
> $20/month — or a move back to Cloudflare Pages, which has no such restriction.

### Domain

Project → **Settings** → **Domains** → add `opensourcescanner.xyz`, then point the
registrar's nameservers or the apex `A`/`CNAME` records at Vercel as instructed. Set
`SITE_ORIGIN` as a build env var if you use a different host, so canonical URLs and the
sitemap point at the right place.

`vercel.json` sets `trailingSlash: true` to match the trailing slashes in our canonical
URLs and sitemap, so `/browse` redirects to `/browse/` instead of both resolving and
competing with each other in search.

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
