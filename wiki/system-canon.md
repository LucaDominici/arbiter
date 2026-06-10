---
generated: true
source: 'docs/SYSTEM/CANON.md'
source_sha: 'c7cfcc78b447b12df6d24301eec0f3624e5f7d29'
last_updated: '2026-06-10'
---

# arbiter Canon — Lessons Learned

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/SYSTEM/CANON.md](../docs/SYSTEM/CANON.md)

# arbiter Canon — Lessons Learned

> Process rules derived from audit waves #151–#186. Sitting below INV-NN in the Authority Hierarchy but above individual implementation decisions. Every implementation of an open issue must cite the CANON-NN IDs that apply.
>
> **Violation protocol:** STOP → REFUSE → cite CANON-NN (same as INV-NN).

---

## How to read this file

Each entry has four fields:

- **Rule** — the binding constraint, one sentence
- **Why** — the failure mode that made this rule necessary
- **Enforcement** — where the check lives today (prose, hook, gate, or `→ INV-NN`)
- **Source issues** — audit findings that motivated the rule

When an entry graduates to a machine check it is promoted into `src/invariants/catalog.ts` as an INV-NN. The CANON-NN entry stays as historical record with a `Promoted to: INV-NN` footer.

---

## How to add a new entry

1. Append `## CANON-NN` at the end of this file (increment N).
2. Fill all four fields.
3. Add the CANON-NN ID to the PR checklist of the issue that prompted it.
4. Open a follow-up issue to promote to `INV-NN` once enforcement is automatable.

---

## CANON-01 — Dual-sided declination

**Rule:** Every governance mechanism that arbiter applies to itself must also exist as a generator template (`src/templates/**/*.ejs`) emitted for target projects. Conversely, every hook/gate that arbiter emits for targets must be dogfooded in arbiter's own `.claude/` configuration where arbiter's governance level qualifies.

**Why:** Arbiter's value proposition is that it generates governance for target projects. If arbiter applies a rule only to itself (self-config-only) or only emits it without applying it (template-only), the governance model is asymmetric and the "eat your own dog food" guarantee breaks.

**Enforcement:** Prose — checked at PR review. Machine-promotable once a generator-vs-settings diff script exists.

**Source issues:** #149, #151, #162, #164, #165, #167, #176, #183

---

## CANON-02 — Proven cell ⇒ gated step

**Rule:** Every tool cell marked `proven` in `src/compatibility/cross-language-matrix.json` must produce a concrete invocation step in `src/templates/check-all.mjs.ejs` at the correct gate level (L1, L2, or L3).

**Why:** "Proven" in the matrix is a public contract. If the generated gate never calls the tool, the matrix claim is a lie and users lose silent coverage.

**Enforcement:** Prose — checked at PR review when matrix cells change. Promotable to `check-matrix-proven-cells.mjs` gate script.

**Source issues:** #155, #160, #171

**Promoted to:** INV-47

---

## CANON-03 — Proven cell ⇒ fixture

**Rule:** Every `proven` language×archetype combination in `src/compatibility/cross-language-matrix.json` must have a fixture directory under `__tests__/fixtures/real-projects/` with a valid `manifest.json` containing `language`, `archetype`, and `levels`.

**Why:** Without a fixture the matrix's "proven" claim cannot be falsified by CI; real-project integration tests silently skip.

**Enforcement:** `scripts/check-matrix-fixtures.mjs` — must be wired into `check-all.mjs` L1 block (see #179).

**Source issues:** #153, #178

---

## CANON-04 — Every .ejs has a render test

**Rule:** Every template file under `src/templates/` must be asserted by at least one test in `__tests__/templates/` that renders the template and checks concrete output strings.

**Why:** EJS syntax errors and missing interpolation variables are invisible until render time. String-presence assertions in template tests catch these before PR merge.

**Enforcement:** Prose — the template test coverage gap is tracked by `scripts/check-all.mjs` coverage threshold.

**Source issues:** #166, #175

**Promoted to:** INV-48

---

## CANON-05 — Every generator has a unit test

**Rule:** Every file under `src/generators/` requires a corresponding `__tests__/generators/*.test.ts` that covers the happy path, idempotency, and at least one negative case.

**Why:** Generator logic is the most critical path in arbiter (it writes governance into target projects). Untested generators can silently emit wrong content.

**Enforcement:** Prose — checked at PR review when generators are added/changed.

**Source issues:** #118, #181, #175

**Promoted to:** INV-49

---

## CANON-06 — Every CLI command has a test

**Rule:** Every file under `src/commands/` requires a corresponding `__tests__/commands/*.test.ts`.

**Why:** CLI commands orchestrate all generators and are the user's entry point. Untested commands cannot be refactored safely.

**Enforcement:** Prose — checked at PR review.

**Source issues:** #174, #186

**Promoted to:** INV-50

---

## CANON-07 — Generated scripts must be executed in tests

**Rule:** Integration tests must execute the generated `check-all.mjs` (or other generated shell scripts) in a real directory and assert exit code 0 — not merely assert that the generated file contains certain strings.

**Why:** Template-string assertions cannot catch missing `await`, wrong exit-code propagation, or steps that reference undefined env vars. The gate is the primary governance artifact; it must have execution-level test coverage.

**Enforcement:** Prose — tracked by `__tests__/integration/` test count. Future: required at L2.

**Source issues:** #172

---

## CANON-08 — Catalog ↔ AGENTS.md parity

**Rule:** Every invariant in `src/invariants/catalog.ts` must have a matching entry in `AGENTS.md` §Invariants, with the **exact same title**. No undocumented or title-drifted invariants.

**Why:** AGENTS.md is the canonical governance document read by all AI agents and new contributors. Invariants that exist only in code are invisible to the governance layer. Title drift causes the governance doc to describe a different rule than the catalog enforces.

**Enforcement:** `scripts/check-catalog-agents-parity.mjs` (L1 gate, catalogParity check) — validates both presence and title match. Run on every commit.

**Source issues:** #180, #346

**Promoted to:** INV-51

---

## CANON-09 — Invariant enforcement claim = wired gate step

**Rule:** If `AGENTS.md` states an invariant is "enforced by `scripts/X.mjs` (L1 gate)", then `scripts/check-all.mjs` must actually call `X.mjs` in its L1 block. Claimed enforcement that is not wired is a lie.

**Why:** The INV-32 gate was claimed but never called, meaning language promotions silently bypassed the fixture requirement.

**Enforcement:** Prose — verify by grepping `check-all.mjs` for the script name whenever AGENTS.md enforcement claims change.

**Source issues:** #179

**Promoted to:** INV-52

**Extended to:** INV-115 (#1214) — the claimed-enforcement = wired-gate rule is generalised from invariant catalog citations to free-text governance prohibitions (NEVER / MUST NOT / DO NOT / 🛑) via `scripts/check-constraint-scan.mjs`.

---

## CANON-10 — Every active hook is documented in .claude/CLAUDE.md

**Rule:** Every hook registered in `.claude/settings.json` must appear as a row in the hooks table of `.claude/CLAUDE.md` with its event, filename, and purpose.

**Why:** CLAUDE.md is the first file AI agents load. An undocumented hook is invisible governance — agents cannot reason about constraints they cannot see.

**Enforcement:** Prose — checked at PR review when `settings.json` changes.

**Source issues:** #177

---

## CANON-11 — Every file-emitting generator has a brownfield test

**Rule:** Every generator in `src/generators/` that writes files (using `writeFile`, `copyStaticFile`, or similar) must have a corresponding brownfield test in `__tests__/brownfield/` verifying that re-running init on an existing project respects `skipIfExists` / `backup: true` semantics.

**Why:** The brownfield contract (preserve user files) is the most user-visible guarantee arbiter makes. Untested brownfield behaviour can silently destroy user work on re-init.

**Enforcement:** Prose — checked at PR review for new generators.

**Source issues:** #182, #185

---

## CANON-12 — INV-12 applies to arbiter's own source

\*_Rule:_

_[content truncated — see source for full text]_
