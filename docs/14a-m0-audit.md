# 14a — M0 Hand Audit

> 4 survivors sampled deterministically (max 2 per repo) from
> `.cache/survivors.jsonl`. Re-running `npm run m0:audit` reproduces the same sample,
> so a partially-completed audit is never invalidated.

**The M0 gate (docs/11): ≥ 80% PASS.** Below that, a signal is lying — find which gate is
wrong before writing pipeline code. Pass *rate* gates nothing; pass *quality* gates everything.

Open each issue, spend ~60 seconds, tick the boxes. Be harsh — the whole product is the
promise that these are real.

**Tally:** ___ / 4 passed

---

### 1. [orhun/git-cliff#1182](https://github.com/orhun/git-cliff/issues/1182)

`Rust` · ★12,122 · Apache-2.0 · 8 comments · updated 32d ago
· has CONTRIBUTING · 14 committers/90d

**Support searching in .config folder**

> Is there an existing issue or pull request for this? I have searched the existing issues and pull requests Feature description https://dot-config.github.io/ extends the XDG standard to have a .config folder inside your p…

- [ ] **Actually unclaimed?** (no PR, no one working on it in comments)
- [ ] **Enough context to start?** (you could open the file and begin)
- [ ] **Repo alive?** (recent merged PRs from outsiders)
- [ ] **Scope sane?** (hours-to-days, not weeks)

Verdict: `PASS` / `FAIL — reason`

---

### 2. [zizmorcore/zizmor#963](https://github.com/zizmorcore/zizmor/issues/963)

`Rust` · ★6,028 · MIT · 4 comments · updated 91d ago
· has CONTRIBUTING · 7 committers/90d

**[META] Adding subfeatures to audits**

> I'm adding subfeatures to bot-conditions and template-injection for proofs-of-concept, but there are several other audits that probably make sense to include subspans for: unsound-contains (for the offending contains(...…

- [ ] **Actually unclaimed?** (no PR, no one working on it in comments)
- [ ] **Enough context to start?** (you could open the file and begin)
- [ ] **Repo alive?** (recent merged PRs from outsiders)
- [ ] **Scope sane?** (hours-to-days, not weeks)

Verdict: `PASS` / `FAIL — reason`

---

### 3. [Rust-GPU/rust-gpu#315](https://github.com/Rust-GPU/rust-gpu/issues/315)

`Rust` · ★3,285 · Apache-2.0 · 3 comments · updated 38d ago
· has CONTRIBUTING · 5 committers/90d

**Use VulkanShaderExamples rust-gpu port as benchmarks**

> We don't have a benchmark suite. In https://github.com/Rust-GPU/VulkanShaderExamples, we have a bunch of shaders with the same logic written in multiple languages. Also, they have a way to benchmark built in. So all we n…

- [ ] **Actually unclaimed?** (no PR, no one working on it in comments)
- [ ] **Enough context to start?** (you could open the file and begin)
- [ ] **Repo alive?** (recent merged PRs from outsiders)
- [ ] **Scope sane?** (hours-to-days, not weeks)

Verdict: `PASS` / `FAIL — reason`

---

### 4. [Oxen-AI/Oxen#104](https://github.com/Oxen-AI/Oxen/issues/104)

`Rust` · ★1,177 · Apache-2.0 · 3 comments · updated 90d ago
· has CONTRIBUTING · 4 committers/90d

**Feature Requests: HTTP API for changing the `namespace` and `reponame`**

> It would be highly beneficial to have HTTP API endpoints that allow changing the namespace and the reponame for existing repositories via a RESTful interface. While an HTTP API for transferring repositories between names…

- [ ] **Actually unclaimed?** (no PR, no one working on it in comments)
- [ ] **Enough context to start?** (you could open the file and begin)
- [ ] **Repo alive?** (recent merged PRs from outsiders)
- [ ] **Scope sane?** (hours-to-days, not weeks)

Verdict: `PASS` / `FAIL — reason`

---


## Notes

Record any pattern in the failures here. A failure mode that appears 3+ times is a missing
gate, not bad luck — write it up and add it to docs/04 §1 before M1.
