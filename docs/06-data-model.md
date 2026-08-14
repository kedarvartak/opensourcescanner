# 06 — Data Model & Payload Budget

## 1. Design pressure

The dataset is downloaded by every visitor, so **every byte per issue is multiplied by
the whole corpus.** At 3,000 issues, one extra 40-byte field costs 120 KB raw. This is
why the schema below is aggressively abbreviated and why repo data is normalized out.

Three rules:

1. **Normalize repos.** ~3,000 issues live in ~800 repos. Repo name, stars, license and
   health scores are stored once in a `repos` table and referenced by index.
2. **Short keys.** `t` not `title`. Unreadable in raw form, irrelevant — nobody reads it
   by hand, and it's ~15% of payload.
3. **Derive, don't store.** Don't ship `daysSinceUpdate`; ship the timestamp and compute
   it client-side. Don't ship both `score` and its five components unless the UI shows
   the breakdown (it should, for one issue at a time — so ship components only in a
   lazily-fetched detail shard).

## 2. `data/meta.json`

Small, frequently revalidated, the entry point to everything else.

```jsonc
{
  "v": 1,                                  // schema version
  "generatedAt": "2026-08-15T03:07:22Z",
  "nextRefreshAt": "2026-08-16T03:00:00Z",
  "counts": { "issues": 3127, "repos": 814, "languages": 23 },
  "shards": {
    "issues": ["issues.a4f19c.json"],      // content-hashed, immutable
    "repos":  "repos.7b2e01.json",
    "facets": "facets.3c9d55.json"
  },
  "stats": {                               // shown in the UI footer — the trust signal
    "candidatesScanned": 41203,
    "rejected": { "claimed": 9871, "deadRepo": 6042, "stale": 11290,
                  "noContext": 7455, "farming": 2418, "other": 1000 },
    "passRate": 0.0759
  }
}
```

The `rejected` breakdown is not debug output — it's the marketing. "We looked at 41,203
issues and rejected 38,076" is the entire value proposition rendered as a number, and it
costs nothing to ship.

## 3. `data/repos.<hash>.json`

```jsonc
{
  "r": [
    {
      "n": "vercel/next.js",       // nameWithOwner
      "s": 128400,                 // stars
      "l": "TypeScript",           // primary language
      "lic": "MIT",
      "p": 1755225600,             // pushedAt, unix seconds
      "h": {                       // health, 0-100 (doc 04 D1/D3)
        "resp": 82,                // responsiveness
        "appr": 91,                // approachability
        "mr": 0.7                  // outsider PR merge rate
      },
      "f": ["contributing", "ci", "tests"]   // onboarding artifacts present
    }
  ]
}
```

## 4. `data/issues.<hash>.json`

```jsonc
{
  "i": [
    {
      "id": 2481930221,            // GitHub issue node id (numeric db id)
      "r": 0,                      // index into repos.r[]
      "n": 51234,                  // issue number → URL = /{repo.n}/issues/{n}
      "t": "Fix off-by-one in pagination cursor when limit exceeds page size",
      "x": "The cursor calculation in `lib/paginate.ts:88` assumes…",  // ≤300 char excerpt
      "lb": [3, 7],                // indices into facets.labels[]
      "c": 2,                      // comment count
      "rx": 5,                     // reactions
      "cr": 1752710400,            // createdAt
      "u": 1755139200,             // updatedAt
      "fs": 1754870400,            // firstSeen on OUR board (from state/)
      "sc": 87,                    // composite score
      "vf": 1755225742,            // validatedAt — powers "verified free 4h ago"
      "fl": ["mg"]                 // flags: mg=maintainer guidance in thread,
                                   //        pc=previously claimed, rp=has repro steps,
                                   //        fp=references a file path
    }
  ]
}
```

**Size estimate per issue:** ~230 bytes raw with a 300-char excerpt trimmed to ~120 on
average → 3,000 issues ≈ **700 KB raw ≈ 130–170 KB brotli**. Comfortably inside the
500 KB budget with room to grow to ~8,000 issues.

> If the corpus outgrows the budget, shard by language and load only the languages the
> user selects — `meta.shards.issues` is already an array for exactly this reason.
> Don't build it until measurement demands it.

## 5. `data/facets.<hash>.json`

Deduplicated vocabularies plus precomputed counts, so the filter UI renders instantly
without scanning the corpus.

```jsonc
{
  "labels":    ["good first issue", "help wanted", "bug", "documentation", "…"],
  "languages": [{ "k": "TypeScript", "c": 812 }, { "k": "Python", "c": 640 }],
  "topics":    [{ "k": "cli", "c": 88 }, { "k": "web", "c": 412 }],
  "buckets": {
    "stars":  [{ "k": "25-100", "c": 210 }, { "k": "100-1k", "c": 980 }],
    "effort": [{ "k": "small", "c": 1400 }, { "k": "medium", "c": 1100 }]
  }
}
```

## 6. `state/` schemas (never served to the client)

### `state/current.json`
Yesterday's board — the input to the daily re-validation pass.
```jsonc
{ "generatedAt": "…", "issues": [{ "k": "vercel/next.js#51234", "fs": 1754870400, "sc": 87 }] }
```

### `state/repo-health.json`
Expensive-to-compute D1/D3 scores, TTL 7 days, so daily builds don't recompute them.
```jsonc
{ "vercel/next.js": { "computedAt": 1754870400, "resp": 82, "appr": 91, "mr": 0.7, "n": 30 } }
```

### `state/history/YYYY-MM.jsonl`
Append-only lifecycle events — the compounding asset from [04](04-issue-validity-model.md) §5.
```jsonl
{"ts":1755225742,"k":"vercel/next.js#51234","e":"listed","sc":87}
{"ts":1755312142,"k":"vercel/next.js#51234","e":"dropped","why":"assigned"}
```

Event vocabulary: `listed` · `dropped` (with `why`: `assigned` | `pr_opened` | `closed` |
`stale` | `score_fell` | `repo_failed`) · `relisted` (a claim expired past `CLAIM_TTL`).

## 7. Schema versioning

`meta.v` is checked by the client on load. On mismatch the client shows "the data format
changed, reload" rather than rendering garbage from a cached old shard. Bump `v` on any
breaking field change; content hashes handle everything non-breaking automatically.
