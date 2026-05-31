---
title: 'arbiter Canon — Lessons Learned'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/canon']
related: []
---

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

**Rule:** Generator source code under `src/` must use the approved shell wrapper (`src/utils/run-cli.ts`), never `child_process` directly. INV-12 is not only for generated projects — it applies to arbiter itself.

**Why:** Arbiter claims to enforce INV-12 via `check-no-direct-spawn.mjs`. A generator that violates the same rule it enforces undermines the governance model's credibility.

**Enforcement:** `check-no-direct-spawn.mjs` hook (PostToolUse). Already wired in `.claude/settings.json`.

**Source issues:** #168

---

## CANON-13 — EJS conditionals preserved on every template edit

**Rule:** When editing or merging EJS templates, all `<% if (governanceLevel ...) %>` guards and `<%= testCommand %>` interpolations must be preserved. Every template change must be tested across 5 stacks × 4 governance levels (L1/L2/L3/L4).

**Why:** EJS conditionals are load-bearing: collapsing an L3-only verifier block into an L1 path silently breaks all L1/L2 generated projects. Merging templates is the highest-risk EJS operation.

**Enforcement:** `__tests__/matrix/cross-product.test.ts` — must stay green across all 5×3 cells on every template change.

**Source issues:** #149, #166

---

## CANON-14 — Self-config ⊇ template at equal governance level

**Rule:** Every hook arbiter emits for target projects at governance level L must also run in arbiter's own `.claude/settings.json` if arbiter's own declared governance level is ≥ L.

**Why:** Arbiter is a governance framework. If it generates advanced hook categories (`PostToolUseFailure`, `PreCompact`, `UserPromptSubmit`) for L2 projects but does not apply them to itself (also L2+), the dogfooding guarantee is broken.

**Enforcement:** Prose — diff `src/templates/claude/settings.json.ejs` against `.claude/settings.json` on every hook addition.

**Source issues:** #176, #183

---

## CANON-15 — Boundary/security templates require a wired gate step

**Rule:** Emitting a linter config, security scanner config, or architecture-boundary config file is not sufficient. The corresponding gate step (`./gradlew spotbugsMain`, `ruff check`, `cargo clippy`, etc.) must also appear in `check-all.mjs.ejs` at the appropriate level.

**Why:** A config file without a gate invocation is a paper rule. No CI runner will enforce it unless `check-all.mjs` calls it.

**Enforcement:** Prose — checked at PR review for any new template that emits a tool config file.

**Source issues:** #154, #175

---

## CANON-16 — Refactor-first before creating new source files

**Rule:** Before creating any new file under `src/`, a plan must include an "Existing Code Survey" section documenting: what was grepped for, what similar code was found, and whether a refactor was chosen or rejected (with reason).

**Why:** Unchecked file creation is the primary source of near-duplicate abstractions, bloated generator counts, and redundant templates. A senior developer asks "does this already exist?" before building. Without a documented survey, AI agents default to creation because it is lower-friction than refactoring.

**Enforcement:** `pre-edit-plan-anchor.mjs` hard-blocks (exit 2) `Write` to any new `src/` file if the active plan lacks a valid `## Existing Code Survey` block for that file (Target anchor, Decision keyword, ≥3 evidence rows, ≥200-char Rationale). L2: `jscpd` duplication detector. L1: bloat ratchet (`check-bloat-ratchet.mjs`). See [ADR-041 anti-bloat enforcement](../SYSTEM/DECISIONS.md) (legacy log, search "ADR-041: Anti-bloat"), INV-46.

**Promoted to:** INV-46

**Source issues:** audit 2026-05-12 (determinism + anti-bloat analysis)

---

## CANON-17 — FS errno translation

**Rule:** Every direct `fs.*` failure handler in `src/` must translate raw NodeJS.ErrnoException codes (ENOENT, EACCES, EPERM, EBUSY, EMFILE, ENOSPC) into an `ArbiterError` with a human-readable hint via `src/utils/errors.ts` / `error-catalog.ts`. Raw NodeJS stack traces or bare errno strings MUST NOT leak to user-facing stdout/stderr from CLI commands.

**Why:** NodeJS errno strings are opaque to users; "ENOENT" tells the user nothing about what is missing or how to fix it. Untranslated errors create support load and erode trust in the tool. Translation gates the failure mode into the catalog where it gains a stable error code, hint, and i18n key.

**Enforcement:** Prose — checked at PR review for any code path that invokes `fs.*` or `node:fs`/`node:fs/promises` symbols directly. The audit baseline is `docs/audits/fs-callers-2026-05-17.md` (#824). Promotable to a lint rule once `src/utils/fs.ts` becomes the sole approved fs façade.

**Source issues:** #618, #824

---

## CANON-18 — Every workflow EJS template edit must be tested across all stacks × governance

**Rule:** When adding or modifying any `src/templates/github/workflows/*.ejs` file, render the template for all 5 stacks × 4 governance levels (L1/L2/L3/L4) in the test suite and assert `actionlint` passes on every rendered output.

**Why:** Workflow templates are the primary CI governance artifact emitted by arbiter. An EJS syntax error or missing interpolation variable in a workflow template silently breaks generated CI for any project that uses that stack or governance level. Cross-product rendering catches these before merge.

**Enforcement:** `__tests__/matrix/cross-product.test.ts` extended with workflow rendering assertions. Run on every workflow template change.

**Source issues:** CI-TIER-MODEL spec (2026-05-17)

---

## CANON-19 — sign-and-attest composite action edits require release workflow re-validation

**Rule:** When adding or modifying `.github/actions/sign-and-attest/action.yml.ejs` or any file under `src/templates/github/actions/`, the release workflow template (`05-release.yml.ejs`) must be re-rendered and its `actionlint` / cosign / SLSA output validated for all 4 archetype buckets (lib, service, cli, batch).

**Why:** The sign-and-attest composite action is called from four distinct publish job paths. A breaking input rename or missing output silently breaks release signing for every archetype that references the action.

**Enforcement:** Prose — checked at PR review for any composite action template edit.

**Source issues:** CI-TIER-MODEL spec (2026-05-17)

---

## CANON-20 — Governance threshold table changes require cross-product fixture update

**Rule:** When editing `src/config/thresholds-by-level.ts` (the CI tier threshold matrix), the affected workflow templates must be re-rendered and their output verified to contain updated threshold values. Fixture snapshots under `__tests__/fixtures/` must be regenerated.

**Why:** Threshold values flow from `thresholds-by-level.ts` through EJS interpolation into generated workflow YAML. A threshold change that does not propagate through fixtures creates a silent divergence between what the spec promises and what generated projects receive.

**Enforcement:** Prose — checked at PR review when threshold matrix changes. Promotable to a gate check once snapshot tooling is wired.

**Source issues:** CI-TIER-MODEL spec (2026-05-17)

---

## CANON-21 — Aggregate, don't proliferate

**Rule:** Before creating any new `scripts/check-*.mjs` gate, the plan must include a written justification that explains why the new logic cannot fold into an existing sibling script as a `--mode` flag or additional rule. The justification must cite concrete grep evidence of which sibling scripts were considered and why each was rejected. New scripts added without this justification must carry a `// CATALOG:` marker (≥3 lines of header comment) declaring what the script aggregates and why a new file is preferable to extending an existing one.

**Why:** The `scripts/check-*.mjs` namespace is the operational surface arbiter presents to its own developers and to CI. Unchecked growth produces a long undifferentiated list of single-purpose scripts that nobody can hold in their head, each with its own argument parsing, baseline format, and exit-code conventions. Aggregating related checks into a small number of multi-mode scripts keeps the catalog learnable, reduces near-duplicate code, and forces explicit thinking about cohesion before file creation. The marker is a paper rule made operational: a gate verifies its presence.

**Enforcement:** `scripts/check-script-cohesion.mjs` (L2 gate) — reads `scripts/data/script-catalog-baseline.json`, hard-fails when a `scripts/check-*.mjs` script outside the baseline lacks a `// CATALOG:` header block; warns when the total script count exceeds the baseline by more than 5 (encourages a refactor pass before another addition). Promoted to INV-94.

**Promoted to:** INV-94

**Source issues:** #989
