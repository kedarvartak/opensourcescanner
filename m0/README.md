# M0 — Measurement Spike

Throwaway measurement code. **Not the production pipeline** — M1 rewrites this in
TypeScript against the `Forge` interface (docs/05 §4). The purpose here is to answer
questions cheaply, and to be deleted afterwards.

Zero dependencies: native `fetch`, Node ≥ 20, no `npm install` needed.

## Run it

```bash
npm run m0              # harvest → analyze → audit
```

Or stage by stage:

```bash
node m0/harvest.mjs --target 5000        # → .cache/issues.jsonl  (hits the API)
node m0/analyze.mjs                      # → docs/14-m0-findings.md  (offline)
node m0/audit.mjs 30                     # → docs/14a-m0-audit.md   (offline)
```

Auth: uses `GH_HARVEST_TOKEN` / `GITHUB_TOKEN`, falling back to `gh auth token`.

### Flags

| Flag | Default | Purpose |
|---|---|---|
| `--target N` | 5000 | Stop after N unique issues |
| `--languages Rust,Go` | top 10 | Restrict the language shards |
| `--tier1-only` | off | Skip `help wanted` etc. |
| `--page-size N` | 40 | Lowered automatically on `RESOURCE_LIMIT` |
| `--fresh` | off | Push the activity filter into the query (the M1 path — see below) |

## The three stages

**`harvest.mjs`** — sharded by label × language, bisecting on `created:` whenever a shard
would exceed GitHub's hard 1,000-result cap. Enriches issues, then repos in a *second,
deduped* pass (~5,000 issues live in ~800 repos, so per-issue repo fetching would cost 6×
for identical data). Writes a JSONL cache.

**`analyze.mjs`** — applies every gate **independently** (which gate is expensive on its
own?) *and* jointly with short-circuiting (where do issues actually die?). Runs offline
against the cache, so it's free to re-run after every threshold tweak. Writes
`docs/14-m0-findings.md`.

**`audit.mjs`** — deterministic 30-issue sample, max 2 per repo, as a tick-box worksheet.
**This is the actual M0 gate**: ≥ 80% must be genuinely takeable (docs/11). Pass *rate*
gates nothing; pass *quality* gates everything. Determinism matters so re-running never
invalidates a half-finished audit.

## Findings that already changed the design

Measured on a 120-issue Rust sample, 2026-08-15:

1. **GraphQL search costs 1 point per request, not the ~21 estimated in docs/03 §2.**
   Node-based costing doesn't bite the way the docs assumed. The nightly budget has far
   more headroom than planned — the real constraint is wall-clock (~4s/page), not points.
2. **~87% of candidates fail G4.1 (no activity in 120 days)** — by far the most expensive
   gate. In production this belongs *in the search query* (`--fresh`), not in the
   post-enrichment gate chain: it removes most of the corpus before we pay to enrich it.
   M0 deliberately runs **without** the prefilter so the launch statistic keeps an honest
   denominator.
3. **GitHub enforces an undocumented per-query resource limit** well below the documented
   500,000-node ceiling. 100 issues × (20 timeline + 20 labels + 10 comments) trips it;
   40 is safe. The client halves the page size automatically on `RESOURCE_LIMIT`.

## Deliberate limitations

- No resumable cursors (M1 needs them; a 3-day spike doesn't).
- `.cache/` is gitignored — findings docs are the committed artifact, not the raw data.
- Gates live in `m0/lib/gates.mjs` and are the *reference implementation* for docs/04 §1.
  M1 ports them with unit tests and fixtures; treat any divergence as a bug in M1.
