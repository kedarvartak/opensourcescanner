# 05 — Architecture

## 1. Constraint recap

- No backend. No server, no DB, no serverless functions.
- Static hosting only.
- Refresh every 24 hours.
- Zero secrets reachable from the client.

## 2. The shape

```
┌────────────────────────────────────────────────────────────────┐
│  BUILD TIME  —  GitHub Actions, once per 24h (cron)            │
│                                                                │
│   GH_HARVEST_TOKEN (secret, never leaves CI)                   │
│            │                                                   │
│            ▼                                                   │
│   ┌─────────────────────────────────────────────────┐          │
│   │ 1 HARVEST   sharded search → candidate issue IDs │          │
│   │ 2 ENRICH    GraphQL batch → timeline, repo, etc. │          │
│   │ 3 VALIDATE  hard gates (doc 04 §1)               │          │
│   │ 4 SCORE     5 dimensions → composite (doc 04 §3) │          │
│   │ 5 EMIT      shard, minify, brotli → data/*.json  │          │
│   │ 6 ASSERT    post-build invariants; abort on fail │          │
│   └─────────────────────────────────────────────────┘          │
│            │                          │                        │
│            ▼                          ▼                        │
│    data/  (published)          state/  (history, committed)    │
│            │                                                   │
│            └── git commit ──────────────────────────┐          │
└────────────────────────────────────────────────────│──────────┘
                                                     ▼
┌────────────────────────────────────────────────────────────────┐
│  DEPLOY  —  static host (GitHub Pages / Cloudflare Pages)      │
│    index.html + JS bundle + data/*.json.br  (CDN, immutable)   │
└────────────────────────────────────────────────────────────────┘
                                                     │
                                                     ▼
┌────────────────────────────────────────────────────────────────┐
│  RUN TIME  —  browser                                          │
│    fetch data → in-memory index → filter/search/sort locally   │
│    ZERO GitHub API calls. ZERO secrets. Works offline once      │
│    loaded.                                                     │
└────────────────────────────────────────────────────────────────┘
```

## 3. Key decision: Git is the database

There's no DB, but the pipeline still needs state — yesterday's board (to re-validate it),
per-issue first-seen dates, cached repo-health scores, shard cursors. All of it lives in
the repo as committed JSON under `state/`.

This is unusual, so here's why it's the right call at this scale:

**Works because:**
- Dataset is small (single-digit MB), append-mostly, single-writer (one CI job).
- The commit *is* the transaction — atomic, timestamped, auditable, revertible.
- Free durability and free history. `git log data/meta.json` is the run history.
- A bad build is `git revert`-able in one command, from a phone.
- The commit doubles as the anti-auto-disable heartbeat (see [03](03-data-sources-and-api-constraints.md) §5).

**Breaks when:**
- The dataset exceeds ~50 MB, or history bloats the clone. **Mitigation:** commit only
  `state/current.json` plus a rolling `state/history/YYYY-MM.jsonl` (append-only, one
  compact line per issue-lifecycle event). Never commit full daily snapshots of
  everything — that's what balloons repos.
- Two writers race. **Mitigation:** `concurrency: { group: build, cancel-in-progress: false }`
  on the workflow. Exactly one build at a time, and never cancel a build mid-write.

**Revisit trigger:** if `state/` exceeds 50 MB or the clone step exceeds 60s, move
history to a release asset or an R2 bucket. Note this in [10](10-risks-and-open-questions.md).

## 4. Repository layout

```
open/
├── .github/workflows/
│   ├── refresh.yml          # cron 0 3 * * *  +  workflow_dispatch
│   ├── watchdog.yml         # cron 0 */6 * * *  — fails if data is stale
│   └── deploy.yml           # on push to main → build site → publish
├── pipeline/                # Node/TypeScript, runs only in CI
│   ├── forges/
│   │   ├── types.ts         # Forge interface — the v2 GitLab seam
│   │   └── github.ts        # GraphQL queries, sharding, retry/backoff
│   ├── harvest.ts
│   ├── enrich.ts
│   ├── validate/            # one file per gate group G1..G6, each unit-tested
│   ├── scoring/
│   │   ├── weights.ts       # ← the product decision (doc 04 §3)
│   │   └── dimensions/      # d1-responsiveness.ts … d5-openness.ts
│   ├── emit.ts              # shard + compress + manifest
│   └── assert.ts            # post-build invariants — the safety net
├── config/
│   ├── labels.yml           # seed labels to harvest (doc 07 §2)
│   ├── denylist.yml
│   └── allowlist.yml
├── state/                   # committed; the "database"
│   ├── current.json         # yesterday's board, for re-validation
│   ├── repo-health.json     # cached D1/D3 per repo, weekly TTL
│   ├── cursors.json         # shard resume points
│   └── history/2026-08.jsonl
├── data/                    # committed; served to the client
│   ├── meta.json            # build time, counts, schema version
│   ├── issues.<hash>.json   # sharded, content-hashed
│   └── facets.<hash>.json
├── web/                     # the frontend (see doc 08)
└── docs/                    # you are here
```

## 5. Why the pipeline is a separate program from the site

The frontend must never import pipeline code. Keeping them separate enforces the
invariant that the client cannot call GitHub — you can't accidentally ship a token or an
API call from a module that isn't in the bundle graph.

Shared types (the `Issue` shape in [06](06-data-model.md)) live in `pipeline/` and are
*emitted* as a `.d.ts` the web app consumes — a one-way dependency, checkable in CI.

## 6. Hosting choice

| | GitHub Pages | Cloudflare Pages |
|---|---|---|
| Cost | Free | Free |
| Brotli for `.json` | Automatic for text types | Automatic, plus better control |
| Custom cache headers | ✗ (no control) | ✓ `_headers` file |
| Build integration | Native with Actions | Connects to repo, or deploy from Actions |
| Analytics | ✗ | ✓ free, privacy-preserving |

**Recommendation: Cloudflare Pages**, mainly for `_headers` control — we want
`Cache-Control: public, max-age=31536000, immutable` on content-hashed data files and
`max-age=300` on `meta.json`. Without header control, the CDN either serves stale data or
re-downloads the whole dataset on every visit. Keep GitHub Pages as the fallback; the
build output is identical, so switching is a DNS change.

## 7. Runtime data flow in the browser

1. Fetch `data/meta.json` (small, short TTL) → learn the current content hashes.
2. Fetch `data/issues.<hash>.json` (immutable, long TTL) → cached forever after first load.
3. Hydrate into an in-memory array + prebuilt facet index.
4. All filtering, sorting and search happen locally. No network after load.

The hash indirection is what makes a 24-hour refresh cheap: returning visitors download
a ~1 KB `meta.json`, and only pull the full dataset when the hash actually changed.

## 8. Invariants (enforced in CI, not by discipline)

1. The web bundle contains no GitHub token and no `api.github.com` string. *(grep assert)*
2. `data/` is never hand-edited — it is build output only. *(CI check on diff authorship)*
3. Every issue in `data/` passed every hard gate in this build. *(assert.ts re-checks)*
4. `meta.json.generatedAt` is within 26 hours of deploy time. *(watchdog)*
5. Scoring weights sum to 1.0. *(unit test)*
6. Payload budget: initial fetch ≤ 500 KB brotli. *(build fails over budget)*
