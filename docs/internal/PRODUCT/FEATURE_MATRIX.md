---
title: 'FEATURE_MATRIX — Product Truth RTM'
doc_version: '1.1.1'
status: active
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/pm', 'kind/product', 'kind/governance']
related: ['AGENTS.md', 'src/kit/catalog.json', 'scripts/check-feature-matrix.mjs']
---

# FEATURE_MATRIX — arbiter Product Truth RTM

> **Canonical source of product completeness.** This file is the single authoritative record
> of what arbiter delivers, at what governance level, with what evidence.
>
> **Gate:** `scripts/check-feature-matrix.mjs --check` (L1, fail-closed). To regenerate the
> table block run `node scripts/check-feature-matrix.mjs --write`.
>
> **Export:** (planned) CSV/XLSX export for PM/stakeholder views — not yet shipped as a CLI command.

---

## Status vocabulary

| Status     | Meaning                              | Required fields                                               |
| ---------- | ------------------------------------ | ------------------------------------------------------------- |
| `Missing`  | No implementation — tracked by issue | `issue_ref` in `#NNN` format                                  |
| `Partial`  | Code exists; test/doc incomplete     | `code_ref` non-empty                                          |
| `Done`     | Code + test + doc all present        | `code_ref` + `test_ref` + `doc_ref` non-empty and files exist |
| `Verified` | Full evidence chain — gate-checked   | all four refs non-empty, `test_ref` title parsed              |

Promotion is fail-closed (cannot skip a step).

`source_ref` (optional, 11th column, #2163): upward anchor(s) toward the
requirement's origin (`INV-NN`, `ADR-NNN`, `PRD §N(.M)*`, comma-separated).
Validated whenever non-empty, regardless of status — a stale anchor is a
defect on a `Partial` row too, not just a promotion-gated one. Non-canonical
forms (an issue reference, free prose, a legacy-declared anchor) are
format-only and never resolved (no false red). `test_ref` glob patterns
(`*`/`**`) are additionally banned on `Done`/`Verified` rows unless
grandfathered in the committed ratchet baseline
(`scripts/data/feature-matrix-glob-baseline.json`, regenerated deliberately
via `--update-baseline`); a `Verified` row is never baseline-exemptible.

---

## Span-pinned refs (#2480)

A `code_ref` / `test_ref` / `doc_ref` may name a **line span** and, optionally, pin it:

```
src/generators/doc-set.ts#L120-L164
src/generators/doc-set.ts#L120-L164@50fe5b01c51d
```

Ref **existence** and ref **accuracy** are different claims, and until now only the first was
checked: `#L120-L164` was stripped before the file test, so a span could point past the end of the
file — or at lines that had since become something else entirely — while the row still read
`Verified`. That is the "the requirement changed, the test did not" failure a traceability matrix
exists to catch, and a whole-file ref cannot express it.

Two rules, both **additive** — a ref with no anchor behaves exactly as it always has, so adoption
is per-row and deliberate rather than a mass rewrite:

1. A line span must **exist**. A range past the end of the file, a reversed range, or a zero line
   number is a defect.
2. A pinned span must still **hash to its pin**. The pin is the first 12 hex characters of the
   sha256 of the span's exact text. A mismatch is reported as `OUTDATED` and names both the old and
   the current hash.

Rule 2 is what survives a refactor: the pin catches the span moving *even when its content is
unchanged*, because the citation then points at different lines than the ones that were reviewed.

Produce a pin — never hand-compute one:

```bash
node scripts/check-feature-matrix.mjs --pin 'src/generators/doc-set.ts#L120-L164'
# → src/generators/doc-set.ts#L120-L164@50fe5b01c51d
```

A syntax nobody can compute by hand is a syntax nobody adopts, so the producer ships with the rule.

---

## `Verified` requires a verification envelope (#2480)

`Verified` sits at the top of the status ladder, and until now it was a word someone typed. The
ladder already refuses to skip a step and every ref has to exist — but nothing checked that the
requirement had ever actually been **proven**, by running something, with a transcript. That is the
same fail-closed hole INV-146 closed for milestone `done`: **a status is not evidence.**

A `Verified` row therefore requires `.arbiter/evidence/rtm/<REQ-NNN>.json`, conforming to
`schemas/rtm-verdict.schema.json`:

| Field | Why it is required |
| --- | --- |
| `verdict` | One of `PROVEN`/`FAILING`/`STALE`/`UNRESOLVED`/`UNCOVERED`. Only `PROVEN` admits `Verified`; the other four are recordable states, not failures to hide — a requirement known to be `FAILING` is better governance than one silently parked at `Partial`. |
| `justification` | Why the cited evidence establishes the claim. A verdict with no argument is an opinion with a schema around it. |
| `command` | What was actually executed. `PROVEN` means something was **run**, not that someone read the code and was satisfied. |
| `transcript_digest` | sha256 of that command's output. Not re-verifiable offline by design: its job is to make the claim specific and attributable, not to re-run CI inside a lint gate. |
| `citations` | Where the proof lives, in the **pinned-span grammar above** — so a citation that drifts is reported `OUTDATED` by the same mechanism, not a second one. |

The envelope must also declare the `feature_id` of the row it stands under: evidence copied from
another requirement proves that other requirement.

### The ratchet, and what is not being claimed

Four rows were already `Verified` when this rule landed. One — **REQ-028**, the matrix requirement
itself — was **earned**: its suite was executed and the real transcript digest recorded. The other
three are grandfathered by a monotone ratchet in `scripts/data/rtm-verdict-baseline.json`, which
starts at **3**, may fall freely, and may never rise.

No evidence is reconstructed after the fact for a verdict nobody recorded — the same forward-only
posture the milestone migration takes, and for the same reason: inventing evidence to satisfy a
fail-closed gate is precisely the fake-green the gate exists to prevent. Each grandfathered row is
a candidate to be earned the way REQ-028 was.

**Self track only, for a concrete reason.** The Track-B gate would need
`schemas/rtm-verdict.schema.json` emitted alongside it, which is a generator change (CANON-11) and
a new template. Porting the rule without the schema would hand every governed project an error the
moment it marked a row `Verified` — worse than not porting. The span-pinning rule above ports
because it needs no new file; this one waits for its schema emission.

---

## Verification tier

`verification_tier` (optional, 12th column, #2242): the KIND of proof a requirement
needs to be fully qualified, mapped from GAMP's IQ/OQ/PQ onto arbiter's own real
3-tier V&V. **It is independent of `status`** — a `Partial` or `Missing` row can
correctly declare `E2E` when the qualifying test is a functional-tier run that does
not exist yet, exactly as it can declare `SCAFFOLD` or `GATE`. Read tier and status
together as the real triage signal: `Partial`+`E2E` is a materially more expensive
gap to close than `Partial`+`GATE`.

| Tier       | GAMP mapping     | Qualified when…                                                              | Evidence directory                                                                                    |
| ---------- | ---------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SCAFFOLD` | IQ (installation) | `arbiter init`/`update` demonstrably produces the expected artifact(s)       | a bake-tier structure snapshot (`__tests__/integration/e2e/bake/`) or a real-project fixture (`__tests__/fixtures/real-projects/`) |
| `GATE`     | OQ (operational)  | Arbiter's own logic is correct — verified directly, no target-project run needed | arbiter's own L1/L2 unit + integration suite (any `__tests__/**` test outside bake/functional)                       |
| `E2E`      | PQ (performance)  | The *generated* enforcement mechanism actually works when run for real (e.g. a seeded violation REDs the generated gate) | functional-tier run of the generated project's own gate (`__tests__/integration/e2e/functional/`, e.g. `greenfield-first-run.test.ts`) |

Assignment rule used to seed this column (#2242): a row whose `test_ref` names a
file in one of the evidence directories above takes that directory's tier
directly. As of 2026-08-26, 46 rows cite a test: 13 `SCAFFOLD`, 21 `GATE`, and
12 `E2E`; nine rows still have no `test_ref`. A row with no `test_ref` declares
the tier its capability *requires*: stack/language
support → `SCAFFOLD` (INV-32 anchors verification to a real-project fixture per
language); arbiter-internal mechanisms with no target-project dependency (CLI
surface, generator registry, invariant catalog, SSOT/parity gates, wizard,
worktree/task lifecycle, doctor, plugin system) → `GATE`; artifact/template-only
generators with no runtime enforcement claim → `SCAFFOLD`; governance/enforcement
mechanisms wired into a target's own `check-all.mjs` (whose correctness is only
provable by actually running that gate) → `E2E`. `check-feature-matrix.mjs`
validates the cell is one of `SCAFFOLD|GATE|E2E` whenever non-empty; it does not
(yet) enforce that every row carries a value, matching the optional-trailing-column
posture already established for `source_ref`.

---

## KIT Dimension Legend

| Category           | Dims         | Description                                 |
| ------------------ | ------------ | ------------------------------------------- |
| architecture       | N01–N07      | Hexagonal/layered architecture enforcement  |
| audit_trail        | N08, N73–N75 | 21CFR / tamper-evident audit log            |
| static_analysis    | N09–N16      | Linting, type-safety, complexity            |
| test_framework     | N17–N23      | Unit test runner & mocking                  |
| test_profiles      | N24–N26      | Coverage profiles & TDD evidence            |
| test_types         | N27–N33      | Integration, mutation, behavioral, contract |
| cicd               | N34–N40      | CI/CD pipeline & workflow runners           |
| e2e_perf           | N41–N44      | E2E browser testing & k6 performance        |
| scripts_validation | N45–N50      | Gate scripts validation                     |
| scripts_quality    | N51–N54      | Quality gate scripts                        |
| security           | N55–N58      | Secrets, vulnerability, SAST                |
| git_github         | N59–N62      | Branch protection, labels, Actions          |
| documentation      | N63–N68      | Doc generation & validation                 |
| configuration      | N69–N72      | arbiter.json config surface                 |
| a11y               | N76          | Accessibility enforcement                   |
| module_boundaries  | N77          | Module import boundary enforcement          |
| resilience         | N78          | Circuit-breaker/retry/rate-limiter/timeout  |

---

<!-- FEATURE_MATRIX_START -->

| feature_id | capability | kit_dims | level | status | code_ref | test_ref | doc_ref | issue_ref | note | source_ref | verification_tier |
| ---------- | ---------------------------------------------------------------- | ------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------ |
| REQ-001 | Architecture enforcement (hexagonal / layered) | N01,N02,N03,N04,N05,N06,N07 | L2 | Partial | src/generators/boundaries.ts | __tests__/integration/e2e/functional/greenfield-first-run.test.ts |  | #2244 | ArchUnit (Java) + ESLint boundaries (TS); cross-stack coverage partial. RTM #2244 E2E evidence (TS hexagonal half): greenfield-first-run.test.ts's architectureStyle cell inits, runs `configure --set architectureStyle=hexagonal` + `update`, proves scripts/check-boundaries.mjs and the ts-boundaries gate are emitted, and asserts the NAMED `boundaries` gate PASSes on a clean tree and REDs a seeded domain→adapters import. STILL OPEN: the Java `architecture tests` gate (ArchUnit) additionally needs architectureStyle!=='none' AND basePackage AND a JVM toolchain that no functional cell provides, so the Java half stays unproven; same for the go/python/rust boundaries variants. Unit-tier coverage at __tests__/generators/archunit.test.ts + __tests__/generators/boundaries.test.ts |  | E2E |
| REQ-002 | Audit trail / 21CFR scaffold | N08,N73,N74,N75 | L4 | Partial | src/generators/pharma.ts |  |  | #1156 | pharma overlay = Java JPA/ArchUnit (KIT N73-75); sox/gdpr/generic overlays = language-neutral L4 audit-trail policy + gate rules under docs/compliance/, decoupled from the pharma Java scaffolding (#1156, src/templates/audit/generic/) |  | E2E |
| REQ-003 | Static analysis & linting | N09,N10,N11,N12,N13,N14,N15,N16 | L2 | Partial | src/generators/quality.ts | __tests__/integration/e2e/functional/fixture-functional.test.ts |  | #2244 | ESLint + tsc; complexity + coverage gates wired. RTM #2244 E2E evidence: fixture-functional.test.ts runs the generated L1 gate over 8 real-project fixtures and seeds a type violation that REDs it (`[CHECK] typecheck ... FAIL`); lint/format/static-analysis run green in the same lane. Caveat: code_ref quality.ts emits only sonar-project.properties, which no generated gate executes — the tsc/ESLint wiring comes from debt-gates.ts (provenance defect, noted). Complexity + coverage gates are NOT covered: coverageEnabled needs LOC>=1000, false for every fixture |  | E2E |
| REQ-004 | Test framework wiring | N17,N18,N19,N20,N21,N22,N23 | L2 | Partial | src/generators/quality.ts | __tests__/integration/e2e/functional/fixture-functional.test.ts |  | #2244 | Vitest (TS), JUnit 5 (Java), pytest (Python), go test, cargo test. RTM #2244 E2E evidence: fixture-functional.test.ts executes the generated `unit tests` gate on all 5 stacks, binary-guarded per cell (a missing toolchain SKIPs the cell rather than passing vacuously), so the runner demonstrably ran. Caveat: the test:unit wiring is emitted by debt-gates.ts, not by the row's code_ref quality.ts (provenance defect, noted) |  | E2E |
| REQ-005 | Test profiles & TDD evidence | N24,N25,N26 | L2 | Partial | src/generators/evidence-retention.ts | __tests__/integration/e2e/functional/greenfield-first-run.test.ts |  | #2244 | Coverage thresholds + TDD evidence gate wired at L2+. RTM #2244 E2E evidence (coverage half): greenfield-first-run.test.ts's coverage cell proves `coverage-threshold` IS emitted at default L2 — the long-standing 'coverageEnabled requires LOC>=1000' claim describes the `scaled` profile only, while the default `fixed` profile enables coverage unconditionally — and asserts the NAMED `coverage threshold` gate PASSes on a greenfield tree and REDs seeded untested executable code against the 80% L2 floor. STILL OPEN: the `tdd-evidence (INV-131)` half is emitted by check-all.ts rather than this row's code_ref and is seeded at no tier; evidence-WRITING is proven at the functional tier by packaged-artifact.test.ts (task-command code). Unit-tier coverage at __tests__/generators/evidence-retention.test.ts + __tests__/generators/coverage.test.ts |  | E2E |
| REQ-006 | Integration / mutation / behavioral / contract testing | N27,N28,N29,N30,N31,N32,N33 | L2 | Partial | src/generators/integration-testing.ts | __tests__/integration/e2e/functional/greenfield-first-run.test.ts |  | #2244 | Mutation (Java L2+), BDD, contract testing all behind L2+ gates. RTM #2244 E2E evidence (behavioral quarter only): greenfield-first-run.test.ts seeds an @ignore-tagged .feature and asserts the NAMED `BDD @ignore check` gate REDs (the INV-40 hard-fail) while PASSing on a clean tree. STILL OPEN: `integration tests`/`contract tests` execute for real in the L2 lane but with no seeded violation, so their blocking behaviour is unproven; `mutation (stryker)` is asserted EMITTED by the new L3 cell (enableMutationTesting is L3+, mutationEnabled true under the fixed profile) but never EXECUTED — `npx stryker run` needs a network install — so the mutation quarter is emission-proven only, not blocking-proven. Unit-tier coverage at __tests__/generators/integration-testing.test.ts + __tests__/generators/mutation.test.ts |  | E2E |
| REQ-007 | CI/CD pipeline & workflow runners | N34,N35,N36,N37,N38,N39,N40 | L2 | Partial | src/generators/github.ts | __tests__/integration/e2e/functional/greenfield-first-run.test.ts |  | #2244 | GH Actions workflows generated; workflow-runner gate wired. RTM #2244 E2E evidence: greenfield-first-run.test.ts's useGitHub cell runs `init --github`, asserts all 12 workflow gates (ci-tiers, action-pins, workflow-perms, workflow-runners, sha-pinning, job-naming, pr-size, merge-method) are emitted, that a plain `arbiter update` does NOT strip them, that the project's own `unwired guards` gate stays PASS, that four of them execute PASS against the emitted workflows, and that a seeded tag-pinned action REDs both `action pins (INV-76)` and `workflow sha pinning`. The cell landed RED-first: on main @14cebd17 `arbiter update` stripped all 12 because the registry keyed them on `useGitHub` (the live-API-call flag) instead of `permitGitHub`; root-caused and fixed in the emission, never by relaxing the cell. #2315: `init --github` and `update --github`/`ARBITER_GITHUB=1` now fail loudly (exit 1, `E_INIT_GITHUB_UNAUTHENTICATED` / `E_UPDATE_GITHUB_UNAUTHENTICATED`) when `gh` is not authenticated, instead of silently resolving `useGitHub`/`permitGitHub` to `false` and dropping all 12 workflow gates with zero output — the same dogfood-blind class as this row's own RED-first history. Unit-tier coverage at __tests__/generators/github.test.ts + __tests__/scripts/check-ci-tiers.test.ts |  | E2E |
| REQ-008 | E2E & performance testing | N41,N42,N43,N44 | L2 | Partial | src/generators/playwright-ts.ts |  |  | #2244 | Playwright (TS/Python) + k6 perf; archetype-gated. STILL OPEN (#2244) — re-observed under #2257's FE-at-L2 cell: `playwright e2e` IS now emitted (frontend-spa at L2), but its runtime condition prints `SKIP (E2E_START_CMD unset and package.json has no start:test script)`, so a cell could prove emission only, never PASS/FAIL — the SKIP-compatible exit 0 this row must not cite. k6 has no gate in the registry at all, so the perf half is ungated everywhere and no fixture can honestly cite it. Closing the Playwright half needs a fixture shipping a runnable start:test app, not another archetype cell. Unit-tier coverage at __tests__/generators/playwright-ts.test.ts + __tests__/generators/perf-k6.test.ts |  | E2E |
| REQ-009 | Gate script validation | N45,N46,N47,N48,N49,N50 | L2 | Partial | src/generators/check-all.ts | __tests__/integration/e2e/functional/fixture-functional.test.ts |  | #2244 | check-all.mjs generated + wired. RTM #2244 E2E evidence: fixture-functional.test.ts spawns the generated `scripts/check-all.mjs L1` in 8 real-project fixtures and asserts it actually executes (status != 127, no `Cannot find module`, no unresolved godog/cucumber import) and exits 0 — the strongest functional-tier row in the matrix |  | E2E |
| REQ-010 | Quality gate scripts | N51,N52,N53,N54 | L2 | Partial | src/generators/debt-gates.ts | __tests__/integration/e2e/functional/greenfield-first-run.test.ts |  | #2244 | Debt ratchet, duplication, bloat, dead-code gates generated. RTM #2244 E2E evidence: greenfield-first-run.test.ts's default-level (L2) cell seeds an unused devDependency, runs the FULL generated `check-all.mjs gate` lane (not a --gate isolate) and asserts the NAMED `dead code` (knip) gate REDs — the assertion reads the gate's own status line rather than the process exit code, because `dead code` is soft:true and a grace window would otherwise downgrade it to WARN unnoticed. The file is green on main and wired into the nightly `generated-gate-e2e-greenfield` job (#2257 AC-2), so it can no longer rot invisibly. STILL OPEN: `duplication`/`circular deps`/`debt ratchet` execute in the L2 lane with no seeded violation; `bloat` has no gate in the registry at all. Unit-tier coverage at __tests__/generators/debt-gates.test.ts |  | E2E |
| REQ-011 | Security toolchain | N55,N56,N57,N58 | L2 | Partial | src/generators/security.ts |  |  | #2244 | Gitleaks, npm audit, STRIDE enforcement; SAST level-gated. STILL OPEN (#2244). The prior 'greenfield-first-run / virgin-init-matrix are RED on this tree and CI-unwired' rationale is obsolete — both are green and both run in nightly since #2269/#2257 — but the substance stands: the `gitleaks` gate is binary-guarded, so a cell asserting it would silently no-op wherever gitleaks is absent (the class of self-skipping test #2282 exists to stop); `PII scan` runs in every L1 cell but is SKIP-compatible with exit 0; and the one A-grade seeded secret-scan RED belongs to anti-drift-validators.ts, NOT this row's code_ref, so it must not be borrowed. Closing needs a gitleaks-present cell asserting the named gate's own status line. Unit-tier coverage at __tests__/generators/security.test.ts |  | E2E |
| REQ-012 | Git/GitHub governance | N59,N60,N61,N62 | L2 | Partial | src/generators/github-setup.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/github-setup.test.ts |  | #2247 | Branch protection, label defs, Actions pins; all L2+. Evidence caveat (#2247): github-setup.test.ts asserts emission/placement/counts only — no assertion on the rules INSIDE the emitted scripts; bake snapshots pin check-action-pins.mjs but not apply-branch-protection.mjs / labels.json |  | SCAFFOLD |
| REQ-013 | Documentation generation | N63,N64,N65,N66,N67,N68 | L2 | Partial | src/generators/docs.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/docs.test.ts |  | #2247 | MASTER_TEST_PLAN, CODING_STANDARDS, ADR template, COMMANDS.md |  | SCAFFOLD |
| REQ-014 | Project configuration surface | N69,N70,N71,N72 | L1 | Partial | src/wizard/types.ts |  |  | #1145 | arbiter.json schema; strictnessTier live (noUncheckedIndexedAccess TS + pedantic Rust); deprecated enableDeployWorkflows/enableAzureContainerApp removed (#1145/#1146) → deployTarget is the single deploy gate; databaseEngine still consumed by KIT applicability (N08/N73/N74/N75), @deprecated pending auto-detection (#1058); StackAdapter registry test-only (#1157) |  | GATE |
| REQ-015 | Accessibility (a11y) enforcement | N76 | L2 | Done | src/generators/playwright-ts.ts,src/generators/playwright-python.ts | __tests__/generators/playwright-ts.test.ts,__tests__/generators/playwright-python.test.ts | docs/REFERENCE/coverage/dim-76-accessibility-a11y-audit-axe-lighthouse-pa11y.md |  | axe-playwright-python (Python, beta) + @axe-core/playwright (TS, proven); archetype-gated (frontend-spa, backend-web-db) |  | GATE |
| REQ-016 | Module boundary enforcement | N77 | L2 | Partial | src/generators/boundaries.ts | __tests__/integration/e2e/functional/greenfield-first-run.test.ts |  | #2244 | ESLint-import-boundaries (TS); cross-stack not fully covered. RTM #2244 E2E evidence (TS hexagonal half): greenfield-first-run.test.ts's architectureStyle cell emits scripts/check-boundaries.mjs and asserts the NAMED `boundaries` gate PASSes on a clean tree and REDs a seeded domain→adapters import (the emitted eslint.config.boundaries.mjs declares from:'domain' allow:[]). STILL OPEN: the `fsd boundaries` gate is gateFilePresent-conditional and unseeded, and the go/python/rust boundaries variants each need their own architectureStyle cell. Unit-tier coverage at __tests__/generators/boundaries.test.ts + the per-stack go/python/rust boundaries tests |  | E2E |
| REQ-017 | CLI command surface (count: see src/cli.ts `.command(...)` registrations) |  | L1 | Partial | src/cli.ts | __tests__/behavioral/help-surface.test.ts |  | #2246 | Count is SSOT at src/cli.ts (do not hand-copy); public vs hidden (`{ hidden: true }`) split enumerable via `arbiter help --all`; CLI ref at website/reference/cli.md |  | GATE |
| REQ-018 | Generator scaffold (count: see .bloat-baseline.json → buckets.generators / src/generators/registry.ts) |  | L1 | Partial | src/generators/registry.ts | __tests__/generators/registry.test.ts |  | #2246 | Count is SSOT at .bloat-baseline.json (regenerated via scripts/capture-debt-baseline.mjs), registration at src/generators/registry.ts; anti-drift-validators no longer orphan — see REQ-027 (#1152, wired + emission↔wiring locked by test) |  | GATE |
| REQ-019 | Invariant catalog & AGENTS.md parity (count: see src/invariants/catalog.ts) |  | L1 | Partial | src/invariants/catalog.ts | __tests__/governance/agents-md-parity.test.ts |  | #2246 | Count is SSOT at src/invariants/catalog.ts (do not hand-copy); catalog↔AGENTS parity gate wired (INV-110) |  | GATE |
| REQ-020 | Governance level dial (L1–L4) |  | L1 | Partial | src/wizard/types.ts | __tests__/invariants/catalog.test.ts |  | #2246 | L1–L4 graduated enforcement; minGovernanceLevel filter wired |  | GATE |
| REQ-021 | TypeScript stack support |  | L1 | Partial | src/generators/boundaries.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/boundaries.test.ts |  | #2245 | Architecture + quality + security + testing fully generated |  | SCAFFOLD |
| REQ-022 | Java stack support |  | L1 | Partial | src/generators/archunit.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/archunit.test.ts |  | #2245 | ArchUnit, JUnit 5, mutation (PIT), pharma overlay |  | SCAFFOLD |
| REQ-023 | Python stack support |  | L2 | Partial | src/generators/playwright-python.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/playwright-python.test.ts |  | #2245 | L3+ loud per matrix; core generators beta |  | SCAFFOLD |
| REQ-024 | Go stack support |  | L2 | Partial | src/generators/go-boundaries.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/go-boundaries.test.ts |  | #2245 | L3+ loud; go-boundaries + go test wired |  | SCAFFOLD |
| REQ-025 | Rust stack support |  | L2 | Partial | src/generators/rust-boundaries.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/rust-boundaries.test.ts |  | #2245 | L3+ loud; cargo test + clippy wired |  | SCAFFOLD |
| REQ-026 | Kotlin stack support |  | L2 | Verified | src/generators/quality.ts, src/generators/modulith.ts, src/generators/debt-gates.ts, src/generators/coverage.ts, src/generators/archunit.ts | __tests__/generators/kotlin-beta.test.ts | docs/internal/DEVELOPMENT/REAL-PROJECT-TESTING.md | #1177 | #1177: Real kotlin generation — detekt (config/detekt/detekt.yml), kover (kover.gradle, 0.9.x API), sonar kotlin branch (src/main/kotlin + build/reports/kover/report.xml), ArchUnit extended to kotlin. Content-asserting tests (not smoke) at the generator-unit layer. INV-32 fixture at __tests__/fixtures/real-projects/kotlin-backend-web-db-gradle/ is `tier: snapshot` (manifest validation only — no `arbiter init`, no generated-gate exec; #1840 F4 tranche-2 decision, 2026-07-09: declassified to snapshot-only pre-publish, excluded from the Generator Matrix workflow). Matrix cells stay beta (not promoted to proven). Re-promotion blocker #1803 (3/8 workflow dims — fuzz/license_scan/sbom — relied on unverified JVM-shared EJS branches) CLOSED — all 3 dims now share the java/JVM branch with an explicit kotlin arm + render tests (fuzz landed first; license_scan + sbom landed together). Remaining follow-up: #1194 (kotlin gate wiring in check-all.mjs.ejs). |  | GATE |
| REQ-027 | Anti-drift validator suite |  | L2 | Partial | src/generators/anti-drift-validators.ts | __tests__/generators/anti-drift-validators.test.ts |  | #1152 | #1152: dropped check-pii-scan (dup of native pii-scan) + check-tier-coverage (arbiter-self meta-gate); validator count is SSOT at __tests__/generators/anti-drift-validators.test.ts (do not hand-copy — the count has moved before, see the file's own inline #14xx/#2159 changelog); all emitted validators are wired into the generated target check-all under correct conditionals (matrix-verified TS/py/java); emission↔wiring locked by test |  | GATE |
| REQ-028 | Feature/RTM matrix (this document) |  | L2 | Verified | src/generators/feature-matrix.ts | __tests__/generators/feature-matrix.test.ts | docs/internal/PRODUCT/FEATURE_MATRIX.md | #1159 | Track A + Track B generator; gate wired at L1. Originating PR #1159 (INV-112, CANON-23); stale #1112 ref in prior note was an unrelated docs fix. |  | GATE |
| REQ-029 | AGENTS.md / GLOBAL_INVARIANTS parity gates |  | L1 | Partial | scripts/check-catalog-agents-parity.mjs |  |  | #1158 | Bidirectional parity; CANON-01..22 absent from AGENTS.md — see #1158 |  | GATE |
| REQ-030 | ADR SSOT gate |  | L2 | Partial | scripts/check-adr-index.mjs | __tests__/scripts/check-adr-index.test.ts |  | #2246 | INV-107; ADR extraction count is SSOT at docs/internal/ADR/README.md (do not hand-copy a frozen count here) |  | GATE |
| REQ-031 | Pharma/21CFR overlay (industryOverlay) |  | L4 | Partial | src/generators/pharma.ts |  |  | #1156 | Java+industryOverlay=pharma only; generic L4 needed — see #1156 |  | E2E |
| REQ-032 | Frontend governance (FE constitution) |  | L2 | Partial | src/generators/frontend-governance.ts | __tests__/integration/e2e/functional/greenfield-first-run.test.ts |  | #2244 | INV-102–106; DTCG tokens, Vitest browser, WCAG 2.2. RTM #2244 E2E evidence: greenfield-first-run.test.ts's FE-at-L2 cell inits frontend-spa at L2 — the tier's only prior FE cell inits at L1, which emits none of INV-102..106 — asserts fe-boundaries, token-discipline, i18n-literals, i18n-parity and bundle-size-budget are all emitted, that three of them PASS on a clean tree, and that a raw hex colour REDs the NAMED `token discipline (INV-105)` gate while a browser global under src/domain REDs `fe boundaries (INV-102/103/104)`. STILL OPEN: `fe coverage ratchet` needs a fe-coverage-baseline.json no fixture ships; no DTCG / Vitest-browser / WCAG assertion exists at this tier. Unit-tier coverage at __tests__/generators/frontend-governance.test.ts |  | E2E |
| REQ-033 | Kit experimental gate |  | L2 | Missing |  |  |  | #1151 | Gate is fiction — not enforced against real kit state |  | E2E |
| REQ-034 | Observability / structured logging |  | L2 | Partial | src/generators/observability.ts | __tests__/generators/observability.test.ts |  | #2247 | OpenTelemetry + structured logging scaffolding. Evidence caveat (#2247): the generator emits docs/OBSERVABILITY.md only; the cited test asserts emission + project-name interpolation, and neither generator nor test mentions OpenTelemetry — no bake-snapshot backstop (the artifact appears in no snapshot) |  | SCAFFOLD |
| REQ-035 | Auth scaffold (JWT/session) |  | L2 | Partial | src/generators/auth.ts | __tests__/generators/auth.test.ts |  | #2247 | Auth middleware templates; L2+. Evidence caveat (#2247): the generator emits docs/AUTH_SETUP.md only — no middleware template exists; the cited test asserts emission + project-name interpolation, no bake-snapshot backstop |  | SCAFFOLD |
| REQ-036 | Behavioral testing (BDD / Cucumber) |  | L3 | Partial | src/generators/behavioral-tests.ts | __tests__/integration/e2e/functional/greenfield-first-run.test.ts |  | #2244 | BDD scenario generation; @ignore tag hard-fail (INV-40). RTM #2244 E2E evidence: greenfield-first-run.test.ts's coverage cell asserts the NAMED `BDD @ignore check` gate PASSes on a clean tree and REDs on a seeded @ignore-tagged .feature — the INV-40 hard-fail this row claims, now proven at the functional tier rather than asserted from the template. fixture-functional.test.ts additionally proves the generated BDD suites do not break the build (no unresolved godog/cucumber import). Unit-tier coverage at __tests__/templates/behavioral-tests-render.test.ts |  | E2E |
| REQ-037 | Contract testing (Pact) |  | L3 | Partial | src/generators/contract-testing.ts |  |  | #2244 | Pact broker + schema registry gates (INV-41/42). STILL OPEN (#2244) — structurally uncitable at this tier, not merely unfixtured: every contract-pact gate's RUNTIME condition is `process.env.PACT_BROKER_BASE_URL`, so with no broker it prints SKIP, and satisfying it makes the gate spawn `pact-broker can-i-deploy` against a live network service. A functional cell could therefore prove emission only, never PASS/FAIL, which is exactly the SKIP-compatible exit 0 CANON-23 forbids citing. Closing needs a broker (or a stub honouring the CLI contract) in the harness, not a new fixture cell. The generic `contract tests` that does run at L2 is not Pact and not INV-41/42. Unit-tier coverage at __tests__/generators/contract-testing-render.test.ts |  | E2E |
| REQ-038 | Evidence retention & audit bundle |  | L4 | Partial | src/generators/evidence-retention.ts | __tests__/integration/e2e/functional/greenfield-first-run.test.ts |  | #2244 | INV-90; evidence-bundle gate + retention policy. RTM #2244 E2E evidence: greenfield-first-run.test.ts's L3 cell is the first functional fixture above L2 — it asserts `evidence-gate` is emitted, that the NAMED `evidence gate (INV-33)` PASSes on a .evidence/SUMMARY.json carrying obs_gate=PASS, and REDs on obs_gate=FAIL. STILL OPEN: enableEvidenceHarness is L4-only, so evidence-rotate.mjs, evidence-prune.mjs, done-evidence.mjs and evidence-files.json are still emitted by no functional cell. Unit-tier coverage at __tests__/scripts/check-evidence-bundle.test.ts + __tests__/generators/evidence-retention.test.ts |  | E2E |
| REQ-039 | SSOT core set / knowledge map |  | L2 | Partial | scripts/gen-ssot-core.mjs | __tests__/scripts/gen-ssot-core.test.ts |  | #2246 | INV-108; ssot-core index generation + gate |  | GATE |
| REQ-040 | Worktree / task lifecycle |  | L1 | Partial | src/commands/worktree.ts | __tests__/commands/worktree.test.ts |  | #2246 | Git worktree management + task evidence lifecycle |  | GATE |
| REQ-041 | Interactive wizard (arbiter init) |  | L1 | Verified | src/wizard/prompts.ts | __tests__/wizard/prompts.test.ts | website/reference/cli.md | #1168 | Multi-step wizard; governance level UX gaps. clack prompts mocked in tests: answer→config logic and abort semantics verified, not TUI rendering (accepted Verified bar). |  | GATE |
| REQ-042 | Doctor health check |  | L1 | Partial | src/commands/doctor.ts | __tests__/commands/doctor.test.ts |  | #2246 | File-lock health + stale-lock detection (INV-72) |  | GATE |
| REQ-043 | Changeset / release tooling |  | L1 | Partial | src/commands/task.ts | __tests__/commands/task.test.ts,__tests__/scripts/changeset-version.test.ts |  | #2246 | arbiter task lifecycle + changeset integration |  | GATE |
| REQ-044 | Plugin system |  | L2 | Partial | src/utils/plugin-loader.ts | __tests__/scripts/check-plugin-api-stability.test.ts |  | #2246 | Plugin API stability gate (INV-55). #2413: code_ref repointed from the never-existed src/commands/plugin.ts to the real loader module (see also src/integrations/plugin-schema.ts, src/utils/plugin-worker.ts) |  | GATE |
| REQ-045 | Self-validation / dogfood gate |  | L1 | Partial | scripts/check-self-dogfood.mjs | __tests__/scripts/check-self-dogfood.test.ts,__tests__/scripts/check-self-dogfood-external.test.ts,__tests__/gates/dogfood-gate-level.test.ts |  | #2244 | INV-45; template↔self byte-parity for .claude/ files. TIER CORRECTED E2E→GATE (#2244): check-self-dogfood.mjs is arbiter's OWN repo script — it is never generated into a target project, so no generated-gate harness can ever reach it. Per this matrix's own assignment rule (arbiter-internal mechanism with no target-project dependency → GATE), the #2242 seeding assigned E2E in error. Do not borrow the generated L1 `self-validation drill` gate as proxy: different script (scripts/self-validation.mjs), different generator, different invariant |  | GATE |
| REQ-046 | Local CI wrapper |  | L2 | Partial | src/generators/local-wrapper.ts |  |  | #2244 | act-based local CI; parity gate. STILL OPEN (#2244) — re-observed under #2257's useGitHub cell, which supersedes the old rationale: with .github/workflows now present the `local-ci-parity (INV-59)` gate no longer short-circuits on 'workflows absent', but it prints `SKIP (no local gate result — run node scripts/check-all.mjs L2 first)` because its static half needs a prior full-lane result artifact and its runtime half needs `gh` plus a CI artifact. It is also emitIf collaborationMode==='trunk-solo'. Exit 0 still proves nothing, and the emitted Makefile/run.sh are executed by no test. Closing needs a trunk-solo + --github cell that runs a full L2 lane first and then re-runs the gate. Unit-tier coverage at __tests__/generators/local-wrapper.test.ts + __tests__/scripts/check-local-ci-parity.test.ts |  | E2E |
| REQ-047 | Infra / cloud templates |  | L2 | Partial | src/generators/infra.ts | __tests__/generators/infra.test.ts |  | #2247 | Azure Container App; enableAzureContainerApp @deprecated. Evidence caveat (#2247): the cited test asserts emission gating + project-name interpolation only (no Container App schema assertions), and no bake fixture sets deployTarget=azure-container-app, so there is no snapshot backstop |  | SCAFFOLD |
| REQ-048 | STRIDE / RACI governance |  | L2 | Partial | src/generators/stride-enforcement.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/stride-enforcement.test.ts |  | #2247 | STRIDE threat model + RACI matrix generated at L2+ |  | SCAFFOLD |
| REQ-049 | Risk register |  | L3 | Partial | src/generators/risk-register.ts | __tests__/generators/risk-register.test.ts |  | #2247 | Risk register template generated at L3+ |  | SCAFFOLD |
| REQ-050 | Compliance mapping (ISO 27001 / GDPR) |  | L3 | Partial | src/generators/compliance.ts | __tests__/generators/compliance.test.ts |  | #2247 | ISO 27001 Annex A + GDPR/NIS2 mapping templates |  | SCAFFOLD |
| REQ-051 | Resilience patterns (circuit-breaker/retry/rate-limiter/timeout) | N78 | L2 | Done | src/generators/resilience.ts,src/templates/resilience/RESILIENCE.md.ejs | __tests__/generators/resilience.test.ts,__tests__/templates/resilience-md-ejs.test.ts,__tests__/brownfield/resilience-brownfield.test.ts | docs/REFERENCE/RESILIENCE.md | #1176 | Advisory guide: CB+retry+rate-limiter+timeout defaults + external-call checklist; ts (cockatiel) + java (Resilience4j) concrete blocks; multi emits both; L3/L4 enforcement addendum |  | GATE |
| REQ-052 | Living STATUS dashboard (generated, drift-proof) |  | L1 | Done | scripts/gen-status.mjs | __tests__/scripts/gen-status.test.ts | docs/internal/PRODUCT/STATUS.md |  | Drift-proof STATUS.md generated from FEATURE_MATRIX + MILESTONES + PRD; --check gate wired in check-all L1; mirrors gen-doc-index harness |  | GATE |
| REQ-053 | /ship orchestration synthesis (single narrative, #1216) |  | L1 | Verified | src/commands/task-ship.ts | __tests__/templates/commands-claude.test.ts | .claude/commands/ship.md | #1216 | /ship is the sole orchestration entrypoint; /task = low-level engine/CLI reference; dual-sided dogfood parity; FEATURE_MATRIX + ADR-088 |  | GATE |
| REQ-054 | LLM-Wiki generator + lint gate (Karpathy pattern, #1241) |  | L2 | Partial | scripts/gen-wiki.mjs,scripts/check-wiki-lint.mjs,src/generators/wiki.ts | __tests__/gates/wiki-lint-fixture.test.ts,__tests__/generators/wiki.test.ts,__tests__/templates/wiki-gen-render.test.ts | docs/internal/ADR/089-collapse-hand-docs-to-ssot-core-plus-generated-wiki.md | #1241 | Static compiler: docs/ → wiki/ (Obsidian md + wikilinks + citations); 4-dimension lint gate (broken-link, orphan, stale, citation); on-commit incremental hook; dual-sided; INV-116 |  | GATE |
| REQ-055 | Companion-plugin awareness in /ship (ponytail, #1730) |  | L2 | Done | src/integrations/companions.ts,src/commands/ship-profile.ts | __tests__/integrations/companions.test.ts,__tests__/commands/task-ship.test.ts | docs/internal/ADR/100-companion-plugin-awareness.md | #1730 | HOME-only detection; composes green phase on product repos; never arbiter-self; lite\|full only; absent ⇒ byte-identical |  | GATE |

<!-- FEATURE_MATRIX_END -->

---

## Summary

| Status | Count |
|---|---|
| Verified | 4 |
| Done | 4 |
| Partial | 46 |
| Missing | 1 |
| **Total** | **55** |

---

## Verification Tier Distribution

> Hand-maintained (not regenerated by `--write`, unlike `## Summary` above) — refresh
> alongside the table whenever a row's `verification_tier` changes.

| Tier       | Count | Rows                                                                                            |
| ---------- | ----- | ------------------------------------------------------------------------------------------------- |
| `SCAFFOLD` | 13    | REQ-012, REQ-013, REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-034, REQ-035, REQ-047, REQ-048, REQ-049, REQ-050 |
| `GATE`     | 23    | REQ-014, REQ-015, REQ-017, REQ-018, REQ-019, REQ-020, REQ-026, REQ-027, REQ-028, REQ-029, REQ-030, REQ-039, REQ-040, REQ-041, REQ-042, REQ-043, REQ-044, REQ-045, REQ-051, REQ-052, REQ-053, REQ-054, REQ-055 |
| `E2E`      | 19    | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-016, REQ-031, REQ-032, REQ-033, REQ-036, REQ-037, REQ-038, REQ-046 |
| **Total**  | **55**| |

Counts updated by the #2244–#2247 evidence backfill. One tier moved: REQ-045
(self-validation / dogfood gate) `E2E` → `GATE` — `check-self-dogfood.mjs` is
arbiter's own repo script and is never generated into a target project, so no
generated-gate harness can reach it; #2242 assigned `E2E` in error.

The #2244 backfill now leaves **46 rows** with a `test_ref`, including **12 `E2E`
rows** backed by functional-tier tests. The cited functional evidence is limited to
the named behaviours described in each row's `note`; it does not promote an
unseeded sub-capability by association.

The remaining **7 `E2E` rows still have no functional-tier evidence**:
REQ-002, REQ-008, REQ-011, REQ-031, REQ-033, REQ-037, and REQ-046. Their blockers
are specific and material: L4 pharma/audit-trail needs a Java overlay cell
(REQ-002/031); Playwright lacks a runnable start command and k6 has no gate
(REQ-008); gitleaks is binary-guarded and PII scanning is SKIP-compatible
(REQ-011); the kit gate is explicitly missing (REQ-033); Pact requires a live
broker or a contract-faithful stub (REQ-037); and the local wrapper requires both
an L2 result artifact and CI-artifact access (REQ-046). No existing functional
test exercises those behaviours, so their `test_ref` cells remain blank.

---

## Coverage

All 78 KIT dimensions (N01–N78) are tracked. Coverage breakdown by category:

| Category           | Dims         | Covered by       |
| ------------------ | ------------ | ---------------- |
| architecture       | N01–N07      | REQ-001, REQ-016 |
| audit_trail        | N08, N73–N75 | REQ-002          |
| static_analysis    | N09–N16      | REQ-003          |
| test_framework     | N17–N23      | REQ-004          |
| test_profiles      | N24–N26      | REQ-005          |
| test_types         | N27–N33      | REQ-006          |
| cicd               | N34–N40      | REQ-007          |
| e2e_perf           | N41–N44      | REQ-008          |
| scripts_validation | N45–N50      | REQ-009          |
| scripts_quality    | N51–N54      | REQ-010          |
| security           | N55–N58      | REQ-011          |
| git_github         | N59–N62      | REQ-012          |
| documentation      | N63–N68      | REQ-013          |
| configuration      | N69–N72      | REQ-014          |
| a11y               | N76          | REQ-015          |
| module_boundaries  | N77          | REQ-016          |
| resilience         | N78          | REQ-051          |

---

## Gap Triage (#2242)

Every `Partial` (46) and `Missing` (1) row classified `true-gap` vs
`accepted-partial`, clustered by theme. Classifier (applied at triage time,
before this change landed): a row already carrying a pre-existing `issue_ref`
had its gap tracked — `accepted-partial`. A row with no `issue_ref` was an
untracked gap — the `40/46` set `check-feature-matrix.mjs`'s
governance-visibility WARN (rule 6) flagged at that moment. This triage
clustered that machine-derived list by theme and filed one follow-up per
cluster rather than 40 individual ones; writing those cluster refs into the
table closed the WARN, so rule 6 now reports `0/46` and the classifier is no
longer re-derivable from the table alone.

### Accepted-partial (7 rows) — already tracked

| feature_id | capability                                  | issue_ref | why accepted                                                             |
| ---------- | -------------------------------------------- | --------- | ------------------------------------------------------------------------- |
| REQ-002    | Audit trail / 21CFR scaffold                 | #1156     | generic L4 audit-trail overlay is the open half of this gap, already scoped |
| REQ-014    | Project configuration surface                | #1145     | `databaseEngine` auto-detection is the open half, already scoped          |
| REQ-027    | Anti-drift validator suite                   | #1152     | tracked; validator set + wiring already reconciled in the linked issue    |
| REQ-029    | AGENTS.md / GLOBAL_INVARIANTS parity gates   | #1158     | CANON-01..22 AGENTS.md sync is the open half, already scoped              |
| REQ-031    | Pharma/21CFR overlay (industryOverlay)       | #1156     | same overlay-generalization gap as REQ-002, one tracking issue            |
| REQ-033    | Kit experimental gate (`Missing`)            | #1151     | already tracked; "gate is fiction" is the issue's own stated scope        |
| REQ-054    | LLM-Wiki generator + lint gate               | #1241     | tracked; this row's evidence chain is mid-build under the linked issue    |

### True-gap clusters (40 rows, 4 clusters) — new follow-up filed per cluster

**Cluster 1 — Core governance/enforcement generators lacked cited E2E test_ref**
(17 rows at triage, `E2E` tier, CANON-23-critical) → **#2244**
REQ-001, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009,
REQ-010, REQ-011, REQ-016, REQ-032, REQ-036, REQ-037, REQ-038, REQ-045,
REQ-046. Twelve now cite functional evidence; REQ-045 was correctly reclassified
to `GATE`; REQ-008, REQ-011, REQ-037, and REQ-046 remain unbacked. The separate
accepted-partial E2E rows REQ-002, REQ-031, and REQ-033 are also unbacked for the
reasons recorded above.

**Cluster 2 — Stack-support rows lack a dedicated real-project fixture
test_ref** (5 rows, `SCAFFOLD` tier, asymmetric with Kotlin/REQ-026) →
**#2245**
REQ-021, REQ-022, REQ-023, REQ-024, REQ-025

**Cluster 3 — Arbiter-internal meta-capability rows lack cited test_ref**
(10 rows, `GATE` tier) → **#2246**
REQ-017, REQ-018, REQ-019, REQ-020, REQ-030, REQ-039, REQ-040, REQ-042,
REQ-043, REQ-044

**Cluster 4 — Artifact/template-only scaffold rows lack cited test_ref**
(8 rows, `SCAFFOLD` tier, low enforcement risk) → **#2247**
REQ-012, REQ-013, REQ-034, REQ-035, REQ-047, REQ-048, REQ-049, REQ-050

---

## Version history

| Version | Date       | Changes                                                              |
| ------- | ---------- | -------------------------------------------------------------------- |
| 1.0.0   | 2026-06-02 | Initial seeding from reconciliation audit; 51 rows, all dims covered |
| 1.1.0   | 2026-08-08 | #2242: GAMP-style enhancement — `verification_tier` column (SCAFFOLD\|GATE\|E2E) added to all 55 rows; REQ-017/018/019 stale hand-copied counts refreshed as SSOT pointers; gap triage of 46 Partial + 1 Missing rows (7 accepted-partial, 40 true-gap across 4 filed clusters: #2244–#2247) |
| 1.1.1   | 2026-08-26 | #2244 evidence audit: corrected the stale 34/13 totals to 46 cited rows and seven remaining E2E gaps; blank cells retained where no functional test exists |
