# 01 — Problem Research

## 1. The claim under test

> "Searching for an open source issue to work on is a genuine hassle."

This doc establishes *why*, decomposes the hassle into named failure modes, and
identifies which of them a static site can actually fix.

## 2. Evidence from the field

Practitioner writing on this converges remarkably: the `good first issue` label is
widely understood to be **broken as a difficulty signal**.

Recurring findings across sources:

1. **Labels don't mean difficulty.** The label is context-specific to each maintainer.
   An issue labelled `good first issue` in a compiler repo may require understanding
   type inference. The label means "good first issue *for someone already familiar with
   this codebase*."
2. **Issues go stale silently.** Bodies describe implementations that are no longer
   required. Nobody updates or closes them. They accumulate.
3. **Labels cluster in *complex* projects.** Large, mature projects have the process
   maturity to triage and label. Small, genuinely approachable projects usually don't
   label at all. So the label systematically points beginners at the hardest codebases.
4. **Most aggregator tools are themselves stale.** Several widely-linked directories
   haven't had meaningful data updates in years.
5. **Missing context is the norm.** Most labelled issues lack the repro steps, file
   pointers, or acceptance criteria a newcomer needs to even begin.

Sources are listed at the end of this doc.

## 3. Decomposition: the seven hassles

The umbrella complaint "it's hard to find an issue" is actually seven distinct problems.
Critically — **only some are solvable by a search tool.**

| # | Hassle | Description | Fixable by us? |
|---|---|---|---|
| H1 | **Claimed-but-open** | Issue is open but assigned, or has an open PR linked, or 5 people commented "I'll take this." Invisible on GitHub's issue list. | **Yes — highest value.** Requires per-issue enrichment. |
| H2 | **Dead repo** | Maintainer stopped merging. Your PR rots. | **Yes.** Repo-level activity + outsider-merge signals. |
| H3 | **Stale issue** | Still open, no longer relevant or already fixed. | **Partly.** Age + activity heuristics; can't read maintainer's mind. |
| H4 | **No context** | Body is one vague sentence. | **Yes.** Body-quality scoring. |
| H5 | **Label farming** | Repo mass-labels for Hacktoberfest/star-farming. | **Yes.** Repo-level label-ratio anomaly detection. |
| H6 | **Difficulty mismatch** | Labelled beginner, actually needs deep domain knowledge. | **Partly.** Proxy signals only; genuinely hard problem. |
| H7 | **No personal fit** | Issue is fine but you don't care about the project / don't know the language. | **Yes, trivially.** Filters. Everyone already does this. |

**Strategic read:** every existing tool competes on H7 (filters by language). H1 and H2
are almost entirely unaddressed and are where the user's actual wasted time goes. That's
where we build.

### Why H1 is invisible on GitHub

GitHub's issue search supports `no:assignee`, which catches the *formal* claim. It does
**not** surface:

- an open PR that references the issue (`Fixes #123`) — the most common real claim,
- comment-level soft claims ("can I work on this?"),
- a PR opened by someone who never linked the issue at all.

Detecting these requires fetching each issue's **timeline / cross-reference events**,
which is exactly what a build-time pipeline can afford to do and an interactive search
UI cannot.

## 4. Personas

### P1 — "First contribution" (largest volume, lowest patience)
Student or bootcamp grad. Goal is a merged PR, any merged PR. Blocked by: every issue
they open turns out to be taken; when they do submit, nobody reviews it.
**Needs from us:** guaranteed-unclaimed, guaranteed-responsive maintainer, tiny scope.
**Failure that loses them:** clicking three issues in a row that are already taken.

### P2 — "Weekend contributor" (best retention)
Employed dev, 3–10 yrs, wants to contribute in a language/domain they already know.
Doesn't need hand-holding; needs *scope certainty* and a maintainer who'll merge.
**Needs from us:** language + domain filter, "is this actually 2 hours or 2 weeks?",
maintainer responsiveness data.
**Failure that loses them:** issues too trivial (typo fixes) or in toy repos.

### P3 — "Job-signal seeker"
Wants contributions to *recognizable* projects for a résumé.
**Needs from us:** star/notability filter combined with genuine takeability.
**Failure that loses them:** only obscure repos on the board.

### P4 — "Maintainer" (secondary, matters for distribution)
Wants qualified contributors on their real issues.
**Needs from us:** to be *listed*, and to not be flooded with drive-by noise.
**Note:** this persona is the growth loop but is explicitly out of scope for v1 (no
backend ⇒ no submissions). Design the pipeline so a repo denylist/allowlist can be a PR
to our repo.

## 5. Jobs To Be Done

> **JTBD-1:** When I have a free evening, I want to find an issue I can *start
> immediately* without a 30-minute investigation, so I don't burn the evening on triage.

> **JTBD-2:** When I pick an issue, I want confidence that a human will review my PR
> within a reasonable window, so my effort isn't wasted.

> **JTBD-3:** When I browse, I want to filter to what I actually know, so I'm not
> reading Rust issues when I write TypeScript.

JTBD-1 and JTBD-2 are the differentiators. JTBD-3 is table stakes.

## 6. The core user-experience insight

The cost of a **false positive** (we list a claimed/dead issue) is far higher than the
cost of a **false negative** (we omit a good issue). A user who clicks two dead issues
concludes the site is the same as GitHub search and leaves permanently. A user who never
sees issue #4821 suffers nothing.

**Therefore the pipeline is tuned for precision, aggressively, at the expense of recall.**
This inverts the instinct of every "aggregator" product and is the single most important
design decision in this project. It is restated as a gate in
[04-issue-validity-model.md](04-issue-validity-model.md).

## 7. Sizing the opportunity (rough)

- GitHub issue search for `label:"good first issue" state:open` returns on the order of
  10⁵ results globally. (Exact count must be measured in the spike — see
  [11-roadmap.md](11-roadmap.md), M0.)
- Applying our hard gates should, by hypothesis, retain **2–8%**. That is the number to
  validate first, because it determines whether the board is viable at all.
- **If the retained set is < 500 issues,** the gates are too strict or the label pool is
  worse than believed — either way that finding reshapes the product, so measure it in M0
  before writing any UI.

## 8. Open research questions

- **RQ1:** What fraction of `good first issue`-labelled open issues have an open linked PR?
  (Hypothesis: 15–30%. This is the headline stat for marketing if true.)
- **RQ2:** What is the median time-to-first-maintainer-response across our candidate repos?
  Needed to calibrate the responsiveness score.
- **RQ3:** Do soft claims in comments predict abandonment? (i.e. does "I'll take this"
  with no PR after 14 days mean the issue is actually free again?) This determines whether
  we *exclude* soft-claimed issues or *re-release* them after a cooldown.
- **RQ4:** Is `good first issue` even the right seed label? Alternatives: `help wanted`,
  `E-easy`, `beginner-friendly`, `up-for-grabs`, `D-easy`, `low-hanging-fruit`.
  Full candidate list in [07-pipeline-spec.md](07-pipeline-spec.md).

---

## Sources

- [Why "good first issues" are usually not good first issues — Aman's blog](https://am17an.bearblog.dev/why-good-first-issues-are-usually-not-good-first-issues/)
- [Good first issues don't exist — OpenSauced](https://opensauced.pizza/blog/good-first-issues-dont-exist)
- [The "good first issue" myth — DEV](https://dev.to/dzhavat/the-good-first-issue-myth-204c)
- [Stop browsing "good first issues" — Quansight Labs](https://labs.quansight.org/blog/dont-start-with-good-first-issues)
- [Good First Issues: beginner beware — Quira](https://medium.com/quira/good-first-issues-beginner-beware-4dff2c9c8ea1)
- [How to Find Good First Issues On GitHub — freeCodeCamp](https://www.freecodecamp.org/news/how-to-find-good-first-issues-on-github/)
