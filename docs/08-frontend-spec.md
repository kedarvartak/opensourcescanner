# 08 — Frontend Specification

## 1. The job the UI has to do

From [01](01-problem-research.md): **time-to-first-useful-issue < 30 seconds.** The
frontend's only job is to get a specific person to one specific issue they'll actually
start. A 3,000-row table does not do that; it recreates the paralysis the site exists to fix.

## 2. Information architecture

```
┌──────────────────────────────────────────────────────────────┐
│  open · every issue here was verified unclaimed 4h ago       │
│                                                              │
│  [ TypeScript ▾ ] [ ~2h ▾ ] [ any repo size ▾ ]  🎲 pick one │
├──────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐  │
│  │ vercel/next.js  ★128k  TypeScript          score 87    │  │
│  │ Fix off-by-one in pagination cursor when limit…        │  │
│  │ The cursor calculation in lib/paginate.ts:88 assumes…  │  │
│  │                                                        │  │
│  │ ✓ unclaimed 4h ago   ⏱ maintainer replies ~2d          │  │
│  │ ✓ 7/10 outsider PRs merged   👥 nobody circling        │  │
│  │ 📎 repro steps · file path · maintainer left guidance   │  │
│  └────────────────────────────────────────────────────────┘  │
│  … more cards …                                              │
├──────────────────────────────────────────────────────────────┤
│  scanned 41,203 · rejected 38,076 · why? →                   │
└──────────────────────────────────────────────────────────────┘
```

### The three UI decisions that matter

**1. Cards, not a table.** The differentiating data (responsiveness, merge rate, crowding)
is qualitative and doesn't fit columns. A table invites scanning-and-bouncing; a card
invites reading one thing.

**2. "🎲 Pick one for me" is a primary action, not a gimmick.** Borrowed from CodeTriage
(doc 02 §3). For P1 (first contribution), *choosing* is the paralysis. Deterministic per
day + per filter-set so it's shareable and doesn't reshuffle on re-render.

**3. The rejection stats are in the footer of every page.** "Scanned 41,203, rejected
38,076" is the product thesis stated as a fact. Link it to a page that explains each gate
— that page is [04](04-issue-validity-model.md) rendered for humans, and it's the main
reason a skeptical developer trusts the board.

## 3. Filters (all client-side, all instant)

| Filter | Type | Notes |
|---|---|---|
| Language | multi-select | Facet counts shown inline; the dominant filter |
| Effort | small / medium / larger | Derived from body length, scope keywords, label tiers — **estimate, labelled as such** |
| Repo size | stars buckets | Serves P3 (job-signal seeker) |
| Type | bug / docs / feature / test | From label mapping |
| Maintainer responsiveness | "replies within a week" toggle | The JTBD-2 filter — nobody else has this |
| Crowding | "nobody else circling" toggle | Uses D5 |
| Freshness | "active this week" | |

Full-text search over title + excerpt: linear scan with a normalized lowercase haystack.
At 3,000 items this is sub-millisecond — **do not add a search-index library**. Revisit
only if the corpus passes ~20,000 items.

All filter state goes in the URL query string, so any board view is linkable and shareable
(a cheap, real growth loop: "here are 12 unclaimed Rust CLI issues" is a postable link).

## 4. Rendering & performance

- Static site. Any framework, or none. Recommendation: **Astro or plain Vite + Preact** —
  the page is one interactive list; a full SPA framework is unearned weight.
- Virtualize the list above ~200 rendered cards.
- Ship the first ~30 cards **server-rendered into the HTML at build time** so the page is
  useful before the data fetch resolves. This is free with a static build and it's the
  difference between a 200 ms and a 1.2 s perceived load.
- Budget: LCP < 1.5 s on a 4G connection; total JS ≤ 60 KB gzip.

## 5. Honesty in the UI (non-negotiable)

The entire value proposition is trust. Two rules:

1. **Every claim is timestamped.** "Verified unclaimed 4h ago" — never "unclaimed" bare.
   Data can only be as fresh as the last build, and pretending otherwise is exactly the
   failure mode we're calling out in competitors.
2. **Estimates are labelled as estimates.** Effort is a guess from heuristics. Say
   "~2h (estimated)". A confident wrong number is worse than an honest fuzzy one.

A visible banner appears if `meta.generatedAt` is > 30 hours old: *"Data is
{n} hours old — the refresh may have failed. Issues may already be taken."* This is the
client-side half of the watchdog in [09](09-refresh-and-freshness.md).

## 6. Empty states

- **No results for filters:** show the nearest relaxations ("3 issues if you include
  Python") rather than a dead end.
- **Board unexpectedly small:** if `counts.issues < 300` the build should have failed
  (assertion A1), but the client handles it gracefully anyway.

## 7. Accessibility & progressive enhancement

- Cards are semantic `<article>`s inside a `<ul>`; the issue title is the link.
- Full keyboard navigation; `j`/`k` to move, `Enter` to open, `?` for help — this audience
  expects it.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- With JS disabled, the build-time-rendered first 30 cards still work as plain links.

## 8. Explicitly out of scope for v1

Accounts, saving, "claim this issue", comments, notifications — all require a backend.

The tempting middle ground is `localStorage` for a personal "saved" list. That's genuinely
backend-free and worth doing in v1.1 — but note the trap: a saved issue can be claimed by
someone else tomorrow, so the saved list must **re-validate against the fresh dataset on
every load** and mark entries as gone. A stale saved-list is the exact bug this whole
project exists to eliminate; don't reintroduce it in the last mile.
