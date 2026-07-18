---
title: 'Arbiter — Milestones'
doc_version: '1.0.0'
status: active
last_review: '2026-07-18'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Arbiter — Milestones

**Status:** Active
**Last updated:** 2026-07-18

Each milestone has a scope, exit criteria, and dependency chain. Milestones are tracked as GitHub issues.

---

## M1 — Documentation Foundation ✅ DONE

**Issue:** #10
**Scope:** Create docs/ hierarchy, split ADR monolith, migrate existing docs, update links.

**Deliverables:**

- `docs/ADR/001-008.md` (split from `docs/ADR.md`)
- `docs/architecture/OVERVIEW.md` (migrated from `docs/ARCHITECTURE.md`)
- `docs/architecture/CONFLICT-RESOLUTION.md` (split)
- `docs/REFERENCE/CLI.md` (migrated from `docs/CLI.md`)
- `docs/ADR/README.md` (index + format template)
- `README.md` links updated

**Exit criteria:** 8+ ADR files exist, docs/ hierarchy established, no broken links, old flat files deleted.

**Dependencies:** None.

---

## M2 — PRD & Product Docs ✅ DONE

**Issue:** #11
**Scope:** Write `docs/PRODUCT/PRD.md`, `docs/PRODUCT/MILESTONES.md`, `docs/PRODUCT/COMPETITION.md`.

**Deliverables:**

- `docs/PRODUCT/PRD.md` — Vision, problem, users, features by phase, supported stacks, governance levels, success metrics
- `docs/PRODUCT/MILESTONES.md` — This file
- `docs/PRODUCT/COMPETITION.md` — Competitor analysis (ai-rulez, ruler, manual setup)

**Exit criteria:** PRD covers all phases + non-goals + metrics. Competition analysis covers key alternatives. `README.md` links to PRODUCT docs.

**Dependencies:** M1.

---

## M3 — Architecture & Development Docs ✅ DONE

**Issue:** #12
**Scope:** Architecture deep-dives, development guides, and retroactive ADRs 009-011.

**Deliverables:**

- `docs/architecture/CANONICAL-SOURCE-MODEL.md` — Why AGENTS.md, thin pointer pattern, drift prevention
- `docs/architecture/TEMPLATE-SYSTEM.md` — EJS architecture, variable reference, conditional branches
- `docs/DEVELOPMENT/GETTING-STARTED.md` — Clone → install → test → contribute in 5 min
- `docs/DEVELOPMENT/TESTING-STRATEGY.md` — 8 test categories, fixture design, naming, 85% coverage target
- `docs/DEVELOPMENT/CONVENTIONS.md` — Naming, exports, error handling, commit format, PR checklist
- `docs/ADR/009-ejs-over-handlebars.md` — Retroactive: why EJS (evidence: 30+ .ejs templates)
- `docs/ADR/010-ai-rulez-coexistence.md` — Retroactive: delegation pattern (evidence: init.ts:95-99)
- `docs/ADR/011-brownfield-first-design.md` — Retroactive: writeFile options, mergeSettingsJson

**Exit criteria:** Someone reading only docs/ understands the entire system. GETTING-STARTED works end-to-end.

**Dependencies:** M1, M2.

**Can run in parallel with:** M4.

---

## M4 — Reference Docs ✅ DONE

**Issue:** #13
**Scope:** User-facing reference documentation.

**Deliverables:**

- `docs/REFERENCE/CLI.md` — Expand existing: all commands, all flags, all examples, exit codes, env vars
- `docs/REFERENCE/TEMPLATES.md` — Each template file, variables it uses, conditional branches
- `docs/REFERENCE/HOOKS.md` — Each hook script, what invariant it enforces, per-language hooks
- `docs/REFERENCE/STACK-SUPPORT.md` — Per-language: detection signals, build commands, CI workflow, hooks, invariants

**Exit criteria:** Every template, hook, and language is documented with variables/detection/commands.

**Dependencies:** M1, M2.

**Can run in parallel with:** M3, M5.

---

## M5 — Test Infrastructure ✅ DONE

**Issue:** #14
**Scope:** Shared helpers, fixtures, detector unit tests, utility tests. 42 → ~80 tests.

**Deliverables:**

- `__tests__/helpers.ts` — `createTestProject(language)`, `initGit(dir)`, `cleanupTestProject(dir)`
- `__tests__/fixtures/` — Static marker files per language (package.json, Cargo.toml, build.gradle, go.mod, pyproject.toml)
- `__tests__/detectors/build.test.ts` — Build tool detector
- `__tests__/detectors/framework.test.ts` — Framework detector
- `__tests__/detectors/git.test.ts` — Git detector
- `__tests__/detectors/language-hooks.test.ts` — Language hooks detector
- Utility tests expanded: `render.ts`, `fs.ts` (writeFile, copyStaticFile, resolvedPath)

**Exit criteria:** All 7 detectors tested. All utils tested. 42 → ~80 tests. CI green.

**Dependencies:** M3 (TESTING-STRATEGY.md defines conventions to follow).

**Can run in parallel with:** M4.

---

## M6 — Generator & Template Tests ✅ DONE

**Issue:** #15
**Scope:** Generator unit tests, template rendering tests, governance level tests. ~80 → ~145 tests.

**Deliverables:**

- `__tests__/generators/` — Each of 8 generators tested with `ProjectConfig` fixtures
- `__tests__/templates/` — EJS conditional branches per language via `renderTemplate()`
- `__tests__/governance/` — L1/L2/L3 output differences (coverage thresholds, invariants)
- `__tests__/tools/` — Claude/Codex/Cursor/Copilot content correctness

**Exit criteria:** All 8 generators tested. Template conditional branches for all 5 languages tested. L1/L2/L3 differences validated. ~80 → ~145 tests. CI green.

**Dependencies:** M5.

---

## M7 — Matrix, Tool & Brownfield Tests ✅ DONE

**Issue:** #16
**Scope:** Language matrix integration, brownfield scenarios, integration expansion. ~145 → 200+ tests.

**Deliverables:**

- `__tests__/matrix/` — Full `arbiter init` → output per language (TS, Java, Rust, Go, Python)
- `__tests__/brownfield/` — Scenarios: existing AGENTS.md, existing .claude/, existing ai-rulez, settings merge
- Integration tests expanded: multi-tool, multi-level init variants

**Exit criteria:** Full init→output validated for all 5 languages and all 4 tools. Brownfield scenarios for AGENTS.md, .claude/, ai-rulez, settings.json. 200+ total tests. 85%+ coverage. CI green.

**Dependencies:** M6.

---

## M8 — Documentation Enforcement ✅ DONE

**Issue:** #17
**Scope:** CI job that blocks PRs changing `src/` without updating `docs/`. Write ADR-012 and ADR-013. Propagate to generated CI template for L2+ projects.

**Deliverables:**

- `.github/workflows/ci.yml` — New `docs-check` job (blocks merge if code changes with no docs changes)
- `docs/ADR/012-doc-enforcement.md` — Decision: 3-layer docs enforcement
- `docs/ADR/013-testing-matrix.md` — Decision: fixture-based per-claim testing
- `src/templates/github/ci.yml.ejs` — Updated: include docs-check for L2+ governed projects

**Exit criteria:** PRs changing `src/` without `docs/` fail CI on arbiter itself. Arbiter generates the same enforcement for L2+ target projects.

**Dependencies:** M7 (tests must be solid before changing CI).

---

## M9 — Real Repo Validation ✅ DONE

**Issue:** #18
**Scope:** Run `arbiter update` on two prior internal reference projects. Verify output. Fix any regressions.

**Deliverables:**

- Verified: `arbiter update --dir <path>` succeeds on both repos with no errors
- Verified: existing customizations in the first reference project preserved
- Verified: settings.json merged correctly in the second reference project
- Any regressions found → fixed with tests added

**Exit criteria:** Both repos updated without errors. Existing customizations preserved. No regressions.

**Dependencies:** M7, M8.

---

## M10 — Smart Init Wizard Redesign ✅ DONE

**Issue:** #19
**Scope:** Rewrite `src/wizard/prompts.ts` to implement state-reactive flows. Brownfield mapping, migration plan display, confirm step, `--dry-run` flag for init.

**Deliverables:**

- `src/wizard/prompts.ts` — State-reactive: detect → show findings → confirm → execute
- Brownfield flow: scan existing governance, display what will change, preserve customizations
- Greenfield flow: show generation preview before any writes
- `arbiter init --dry-run` — Preview without writing (currently only `arbiter diff` does this)
- Tests for both flows in `__tests__/integration/`

**Exit criteria:**

- Brownfield init shows migration plan before any writes
- Greenfield init shows generation preview
- `arbiter init --dry-run` previews without writing
- Existing test suite still passes
- New tests cover both flows

**Dependencies:** M7 (test infrastructure must be solid before wizard redesign).

---

---

## M11 — Workflow Commands + Hook Migration ✅ DONE

**Issues:** #28, #34, #40
**Scope:** Generate a single `/task` slash command for target projects covering the full task lifecycle. Migrate all bash hooks to portable Node.js `.mjs` files. Retroactive matrix test expansion for INV-11.

**Deliverables:**

- `.claude/commands/task.md` template (governance-level-parameterized, single file covering init → plan → implement → gate → PR)
- All `.sh` hooks rewritten as `.mjs` (Node.js, cross-platform)
- Settings merge logic upgraded to handle `.sh` → `.mjs` migration
- Cross-product matrix tests: 5 stacks x 3 levels for AGENTS.md, ci.yml, check-all.mjs, commands

**Exit criteria:** Commands generated for all governance levels. All hooks are `.mjs`. Matrix tests pass for all 60 cells. CI green.

**Dependencies:** M10.

---

## M12 — Go/Python Stack Parity (foundation repair) ✅ DONE

**Issue:** #44
**Scope:** Fix the 5 CRITICAL findings from the retroactive analysis. Go and Python currently produce non-functional governance (empty CI, empty gates, no coding standards, no invariants). Also fix Java Maven template gap. See ADR-014.

**Deliverables:**

- `src/templates/github/workflows/ci.yml.ejs` — Go and Python CI job branches
- `src/templates/scripts/check-all.mjs.ejs` — Go and Python gate checks
- `src/templates/agents-md/AGENTS.md.ejs` — Go and Python coding standards + invariants
- `src/detectors/language-hooks.ts` — Go hooks (error handling), Python hooks (type hints)
- `src/templates/claude/settings.json.ejs` — Go and Python tool permissions
- `src/templates/github/dependabot.yml.ejs` — `gomod` and `pip` ecosystems
- `src/templates/copilot/copilot-instructions.md.ejs` — Remove TS-specific lines for non-TS stacks
- Java Maven support in ci.yml.ejs and check-all.mjs.ejs (detect Maven vs Gradle)
- Updated cross-product tests that REQUIRE Go/Python content (not accept empty)

**Testing protocol:**

| Stack         | Real project (cloned from GH) | Verified |
| ------------- | ----------------------------- | -------- |
| TypeScript    | TBD                           | [ ]      |
| Rust          | TBD                           | [ ]      |
| Java (Gradle) | TBD                           | [ ]      |
| Java (Maven)  | TBD                           | [ ]      |
| Go            | TBD                           | [ ]      |
| Python        | TBD                           | [ ]      |

Report attached to issue as comment.

**Exit criteria:** All 5 stacks produce functional CI, gates, coding standards, and invariants. Gate script runs real checks for all stacks. Real-project validation passes for all 6 rows above.

**Dependencies:** M11.

---

## M13 — Documentation Alignment + Retroactive Fixes ✅ DONE

**Issue:** #45
**Scope:** Fix all documentation drift (.sh → .mjs references), remove dead files, align AGENTS.md claims with reality. See ADR-014 retroactive analysis findings.

**Deliverables:**

- Fix `README.md`: `check-all.sh` → `check-all.mjs`, `.bak` → `.arbiter-backup`
- Fix `docs/REFERENCE/STACK-SUPPORT.md`: all `.sh` → `.mjs` hook filenames
- Fix `docs/REFERENCE/CLI.md`: all `.sh` → `.mjs` references, backup suffix
- Fix `docs/REFERENCE/HOOKS.md`: align with actual hook implementations
- Fix `AGENTS.md`: remove "enforced by CI" from INV-05 (until M14 makes it true)
- Fix `AGENTS.md`: coverage 80% → 85% to match ADR-013
- Remove dead `.sh` hook files from `.claude/hooks/`
- Update `.claude/hooks/` dog-food versions to match template improvements (repo-root guard)
- Update `docs/PRODUCT/MILESTONES.md` (this file — already done)

**Testing protocol:** Same 6-repo validation as M12 (regression: all M12 functionality still works).

**Exit criteria:** Zero references to `.sh` hooks in docs. Dead `.sh` files removed. AGENTS.md claims match actual enforcement. Docs pass a manual review for consistency.

**Dependencies:** M12.

---

## M14 — Arbiter Self-Enforcement (dog-food) ✅ DONE

**Issue:** #46
**Scope:** Apply tech debt prevention to Arbiter's own codebase. Dog-food before generating for users.

**Deliverables:**

- `vitest.config.ts` — Coverage thresholds: lines 85%, branches 75%, functions 90%, statements 85%
- `eslint.config.js` — Complexity rules for `src/**/*.ts`: complexity 15, max-params 5, max-depth 4, max-lines-per-function 100, max-nested-callbacks 3
- `package.json` — Add devDependencies: `madge`, `knip`, `@commitlint/cli`, `@commitlint/config-conventional`
- `knip.json` — Dead code detection config (entry: `src/cli.ts`)
- `scripts/check-all.mjs` — Add L1 checks: circular deps (madge), placeholders. Add L2 check: dead code (knip)
- `.github/workflows/ci.yml` — Add steps: orphan-TODO, circular-deps, dead-code, placeholders
- `.githooks/pre-commit` — Runs L1 gate
- `.githooks/commit-msg` — Runs commitlint
- `.githooks/pre-push` — Clean tree + L2 gate
- `commitlint.config.js` — Conventional commits
- `scripts/check-no-placeholders.mjs` — Placeholder/WIP/disabled-test scanner
- `.claude/hooks/check-no-placeholders.mjs` — Claude Code write-time enforcement
- `.claude/settings.json` — Wire placeholder hook

**Testing protocol:** Same 6-repo regression + Arbiter's own gate must pass with all new checks.

**Exit criteria:** Arbiter's own gate includes 8+ checks at L1 (typecheck, format, lint, unit tests, circular deps, placeholders) and 10+ at L2 (+ coverage, audit, dead code). All pass. Git hooks block bad commits locally. Commitlint enforces conventional format.

**Dependencies:** M13.

---

## M15 — Generated Per-Stack Tech Debt Gates ✅ DONE

**Issue:** #47
**Scope:** Generate tech debt prevention tooling for target projects. Each stack gets the appropriate tools for coverage thresholds, complexity limits, dead code detection, and circular dependency checks.

**Deliverables:**

Per-stack generated enforcement:

| Stack      | Coverage                                      | Complexity                                 | Dead Code                         | Circular Deps               |
| ---------- | --------------------------------------------- | ------------------------------------------ | --------------------------------- | --------------------------- |
| TypeScript | vitest/jest thresholds in config              | ESLint complexity rules                    | Knip config                       | madge in gate               |
| Rust       | cargo-tarpaulin config or llvm-cov thresholds | clippy pedantic lints                      | `#[warn(dead_code)]` verification | N/A (Rust compiler handles) |
| Java       | JaCoCo thresholds in build.gradle/pom.xml     | PMD complexity rules                       | PMD unused code rules             | jdeps or ArchUnit           |
| Go         | go test -coverprofile threshold check in gate | golangci-lint complexity linters           | golangci-lint deadcode/unused     | N/A (Go compiler handles)   |
| Python     | pytest-cov thresholds in config               | ruff complexity rules (C901, PLR0911-0913) | ruff unused imports/variables     | N/A (ruff handles)          |

- New templates for generated config files (e.g., `knip.json.ejs`, `ruff.toml.ejs` etc.)
- Updated `check-all.mjs.ejs` with per-stack debt gate checks
- Updated `ci.yml.ejs` with per-stack debt checks
- Updated `AGENTS.md.ejs` with per-stack debt enforcement documentation

**Testing protocol:** 6-repo real-project validation. For each: run `arbiter init`, then run the generated gate. The gate must execute real checks and pass (or fail with actionable messages on real violations).

**Exit criteria:** All 5 stacks generate functional tech debt gates. Real-project gates run and produce meaningful output (not empty passes). Coverage thresholds are enforced. Complexity limits are enforced.

**Dependencies:** M14 (dog-food validates the patterns before generating).

---

## M16 — Novel Anti-Tech-Debt Mechanism ✅ DONE

**Issue:** #43
**Status:** ✅ DONE
**Scope:** Proactive tech debt regression prevention via a generated debt ratchet system. See ADR-015.

**Deliverables:**

- `src/generators/debt-ratchet.ts` — generator producing 2 scripts when `enableDebtGates` is true
- `src/templates/scripts/capture-debt-baseline.mjs.ejs` — captures debt metrics into `debt-baseline.json`
- `src/templates/scripts/debt-report.mjs.ejs` — compares current vs baseline, gates on regression
- `src/detectors/language-hooks.ts` — added Java `check-no-raw-types.mjs` hook (Layer A cleanup)
- CI: `debt-ratchet` job in `ci.yml.ejs`, wired into `ci-required`
- Gate: `debt-report.mjs --gate` (L2) / `--require-improvement` (L3) in `check-all.mjs.ejs`
- AGENTS.md: Debt Ratchet section documenting commands and ratchet rule
- 45 new matrix tests (5 stacks × 3 levels × 3 templates)

**Testing protocol:** All 5 stacks × L2/L3/L1 verified via cross-product matrix tests (INV-11 satisfied).

**Exit criteria met:**

- ✅ Coverage decay detection (via vitest/tarpaulin/JaCoCo/go-cover/pytest-cov)
- ✅ Complexity creep detection (via eslint/clippy/PMD/gocyclo/ruff C901)
- ✅ Dead code accumulation detection (via knip/clippy/PMD/deadcode/ruff F401)
- ✅ Placeholder accumulation detection (TODO count, stack-agnostic grep)
- ✅ Baseline comparison prevents regressions (`--gate` flag)
- ✅ Works across all 5 stacks

**Dependencies:** M15.

---

## M17 — Advanced Hooks (previously M12) ✅ DONE

**Issue:** #35
**Scope:** Generate advanced Claude Code hooks for target projects: plan-anchor, debug-state, pre-compact, dispatch.

**Dependencies:** M16.

---

## M18 — Rich Invariant Catalog (previously M14) ✅ DONE

**Issue:** #37
**Scope:** Expand from 10 to 25+ invariants across 5 tiers. Now includes Go and Python invariants (made possible by M12).

**Dependencies:** M12, M15.

---

## M19 — Skills & Sub-Agents Generation (previously M13) ✅ DONE

**Issue:** #36
**Scope:** Skeleton skills and agent definitions for target projects.

**Dependencies:** M17.

---

## M20 — SSOT Framework Generation (previously M15) ✅ DONE

**Issue:** #38
**Scope:** Knowledge map, track router, engineering defaults.

**Dependencies:** M18.

---

## M21 — Richer GitHub Integration (previously M16) ✅ DONE

**Issue:** #39
**Scope:** Task-brief templates, epic template, project board.

**Dependencies:** M20.

---

---

## Phase 9.5 — Foundation Prerequisites (MA-ML)

**Epic:** #81
**Purpose:** Resolve the 7 CRITICAL (C1-C7) and 10 HIGH (H1-H10) issues identified in the antagonist review of the prior-art baseline + Archivio synthesis. These prerequisites must ship before M22-M32 can execute on a reliable foundation.

**Why this phase exists.** Both evidence sources for Phase 10 (the prior-art baseline and an enterprise reference backend) are Java-Spring backends (N=2). Extrapolating to 5 languages × multiple archetypes has no empirical basis. The M22-M32 roadmap as originally written would:

- Pick hexagonal (prior-art baseline) OR layered (planning) architecture, breaking the other
- Generate fail-closed gates with no brownfield migration path (50k LoC projects couldn't even commit the init PR)
- Emit build tool config without ever invoking the target toolchain (version skew breaks at first user run)
- Lack escape hatches for CVE false positives, causing merge deadlocks
- Use hardcoded thresholds (80/70/85) that are nonsense for small or very large codebases
- Dog-food only TypeScript while claiming cross-language support

Phase 9.5 fixes these before M22 starts. After Phase 9.5, M22-M32 re-scope to consume the new foundation (archetype axis, suppression patterns, scaled thresholds, etc.).

---

### MA — Archetype Axis + Architecture Style Knob

**Issue:** #82 · **Resolves:** C1, C2 · **Size:** L · **Deps:** —

Add `archetype: backend-web-db | cli | library | data-pipeline | frontend-spa | embedded` and `architectureStyle: hexagonal | layered | modular-monolith | none` to `ProjectConfig`. Wizard asks both; generators gate on them. **Blocker for MB, MG, MH, MJ, ML.**

---

### MB — Debt Ratchet: Universal Baseline-Freeze

**Issue:** #83 · **Resolves:** C6 · **Size:** L · **Deps:** MA

Extend `capture-debt-baseline.mjs` + `debt-report.mjs` to capture PMD/Checkstyle/ArchUnit/SpotBugs violations per stack. New flag `arbiter init --brownfield` auto-captures baseline on day 0. Gates fail only on regression, not against absolute thresholds. **Blocker for MK, M22-M30.**

---

### MC — Suppression Pattern with Mandatory Expiry

**Issue:** #84 · **Resolves:** C5 · **Size:** M · **Deps:** —

Generate `suppressions/` dir with OWASP DC, Gitleaks, PII allowlist, ArchUnit baseline templates. Every suppression entry requires `reason`, `owner`, `expiresAt`, `scope`. Expired entries re-fail the gate. Preserves fail-closed with principled escape.

---

### MD — `arbiter verify` Post-Init Toolchain Probe

**Issue:** #85 · **Resolves:** C4 · **Size:** M · **Deps:** —

New `arbiter verify` command invokes minimal probes per stack (`./gradlew help --offline`, `cargo check`, `ruff --version`, etc.) and compares against a pinned compatibility matrix. Auto-runs at end of `arbiter init`. **First implementation target — smallest blast radius.**

---

### ME — Cross-Language Matrix Maturity Marking

**Issue:** #86 · **Resolves:** C3 · **Size:** S · **Deps:** —

Add `maturity: proven | beta | unsafe | unavailable` column to `CROSS-LANGUAGE-MATRIX.md`. Generators refuse to emit L3 features for cells that aren't `proven` (override via `--accept-beta-tools`). Documents known failure modes for cargo-mutants, go-mutesting, mutmut, pact-python.

---

### MF — Real-Project Nightly Matrix

**Issue:** #87 · **Resolves:** H10 · **Size:** L · **Deps:** MA, MD

New nightly CI workflow that runs `arbiter init` + generated gate execution on minimal real fixtures per `(language, archetype)` cell. Adds INV-31: every `proven` cell must have a nightly test. Closes the dog-food gap.

Final hardening note (2026-04-19): the finishing pass for PR #228 stabilized the nightly around the generated L2 contract rather than around ad-hoc runner state. The workflow now installs the extra binaries that the generated gates actually invoke, TypeScript coverage is constrained to `src/**`, and the real-project fixtures were tightened so Java, TypeScript, Python, and Rust cells match the generated files they are expected to execute. See `docs/DEVELOPMENT/REAL-PROJECT-TESTING.md` for the operational checklist and failure modes.

---

### MG — Scaled Thresholds + Practical/Pedantic Tiers

**Issue:** #88 · **Resolves:** C7, H6 · **Size:** M · **Deps:** MA

Thresholds compute from LoC (no coverage < 1000 LoC, no mutation < 5000 LoC, ramped 60% → 85%). New `strictnessTier: practical | pedantic` with per-language rule sets (L2 = practical, L3 = pedantic opt-in). Documented calibration source.

---

### MH — Test Pyramid Profile per Archetype

**Issue:** #89 · **Resolves:** H3 · **Size:** M · **Deps:** MA

Per-archetype pyramid definitions (backend-web-db gets L1-L5; cli gets unit/integration/e2e only; library gets unit/property-based/compat-matrix). No empty CI stages.

---

### MI — STRIDE Skeleton Enforcement

**Issue:** #90 · **Resolves:** H1 · **Size:** S · **Deps:** —

Generate STRIDE/RACI/RTM enforcement _skeletons_ (empty schemas), not pre-populated templates. Gate scans for HIGH/CRITICAL claims and requires linked `@Security`-tagged tests. Empty = no gate = no lie.

---

### MJ — Evidence Harness Retention Config

**Issue:** #91 · **Resolves:** H5 · **Size:** S · **Deps:** MA

`evidenceRetention: { mode, count?, bucketUrl? }` in ProjectConfig. Default `local-last-N` count 5. Generate `.gitignore` entry for `.evidence/` and `evidence-rotate.mjs`. External bucket is opt-in.

---

### MK — Grace Period for Level Upgrade ✓ SHIPPED

**Issue:** #92 · **Resolves:** H9 · **Size:** M · **Deps:** MB

New `arbiter upgrade-level` command captures baseline for newly activated gates, sets `graceEndsAt` (+30 days). During grace, new gates warn only; after grace, hard-fail. Bounded escape hatch for L1 → L2 → L3 migration.

**Shipped:** ADR-028 Part I; `src/commands/upgrade-level.ts`; grace guard in `check-all.mjs.ejs`; INV-33; `--extend` with `.arbiter/grace-log.json`.

---

### ML — Contract Testing by Contract Type ✓ SHIPPED

**Issue:** #93 · **Resolves:** H7 · **Size:** S · **Deps:** MA, M28

Extend ProjectConfig with `contractType: rest-owned | rest-public | graphql | grpc | message-queue | none`. M28 branches on type: Pact / OpenAPI diff / graphql-inspector / buf breaking / schema registry.

**Shipped:** ADR-028 Part II; `src/wizard/archetype-defaults.ts` (`defaultContractType`, `shouldAskContractType`); wizard prompt gated on `hasPublicApi`; propagated to all 5 call sites.

---

### Phase 9.5 Critical Path

```
MA (#82) ──┬── MB (#83) ──── MK (#92)
           ├── MG (#88)
           ├── MH (#89)
           ├── MJ (#91)
           └── ML (#93)

MC (#84) ──── M22, M24 prereq
MD (#85) ──── MF (#87) prereq
ME (#86) ──── parallel doc
MI (#90) ──── parallel (integrates with M24)
MF (#87) ──── needs MA + MD
```

**Entry point:** MD (#85) — smallest blast radius, validates the overall approach end-to-end.

**Exit criteria for Phase 9.5:** All 12 sub-issues closed. `arbiter.json` schema includes archetype, architectureStyle, strictnessTier, evidenceRetention, contractType. Real-project nightly CI runs ≥10 cells with all passing. Phase 10 milestones updated to reference the new foundation.

---

---

## Phase 10 — Production Baseline Enforcement (M22-M32)

Based on the exhaustive gap analysis (alignment doc removed). Principle: **once chosen, enforced** — see `ENFORCEMENT-PHILOSOPHY.md`.

> **Prerequisite:** Phase 9.5 (MA-ML, epic #81) must complete before Phase 10 milestones start. Each Phase 10 milestone depends on specific Phase 9.5 deliverables — see the "Phase 9.5 integration" note on each milestone.

---

## M22 — Architecture Verification Suite ✅ DONE

**Issue:** #70
**Scope:** Generate complete architecture enforcement for all languages. Currently arbiter generates 1 ArchUnit test; the prior-art baseline has 9+.

**Deliverables:**

- **Java:** Generate full ArchUnit suite:
  - `HexagonalArchitectureTest.java` — domain purity (no Spring/JPA in domain), dependency flow (inward only), ports independence, cross-module port discipline
  - `RestAssuredArchTest.java` — every `*ControllerIT` must extend `RestAssuredBaseIT`, legacy exemption list pattern
  - `TestCoverageArchTest.java` — every Controller must have a corresponding ControllerIT
  - `RestAssuredBaseIT.java` — base class with setup (base URI, container, auth)
  - RestAssured + Testcontainers dependencies in `build.gradle.ejs`
- **TypeScript:** Generate `eslint-plugin-boundaries` config + domain purity rules
- **Rust:** Generate `cargo-deny` config + clippy deny rules for dependency boundaries
- **Go:** Generate custom go/analysis linter config
- **Python:** Generate `import-linter` config + ruff custom rules

**Gate:** All architecture tests are HARD gate (L2+). Build fails on violation.

**Exit criteria:** All 5 stacks generate architecture boundary enforcement. Java generates full ArchUnit suite matching the prior-art baseline's 9+ rules. Matrix tests validate output for all stacks × L2/L3.

**Dependencies:** M21, MA (#82 — architecture style knob), MC (#84 — ArchUnit baseline suppression), ME (#86 — tool maturity).

**Phase 9.5 integration:** M22 no longer generates "the ArchUnit suite" — it generates rules conditioned on `architectureStyle`. Hexagonal rules emit only if `architectureStyle === "hexagonal"`. Layered rules emit only if `architectureStyle === "layered"`. Per-archetype rule subsets via MH.

---

## M23 — Mutation Testing as Hard Gate

**Issue:** #71
**Scope:** Transform mutation testing from advisory guide to enforced gate. Currently generates `pitest-setup.md`; must generate build tool integration.

**Deliverables:**

Per-stack mutation testing:

- **Java:** Pitest plugin in `build.gradle.ejs`, task `pitest`, thresholds (mutation ≥85%, coverage ≥90%), target classes pattern
- **TypeScript:** `stryker.config.mjs.ejs`, mutation score threshold, CI job
- **Rust:** `cargo-mutants` config + CI job
- **Go:** `go-mutesting` setup + CI job
- **Python:** `mutmut` config in `pyproject.toml.ejs` + CI job

CI integration:

- Dedicated mutation testing job in `ci.yml.ejs` (L3 only)
- `nightly.yml.ejs` mutation step
- `check-all.mjs.ejs` mutation step for L3

**Gate:** HARD for L3 (build fails if mutation score < 85%).

**Exit criteria:** All 5 stacks generate mutation testing config with hard threshold. L3 gate includes mutation check. Matrix tests validate.

**Dependencies:** M21, ME (#86 — tool maturity marking), MG (#88 — LoC-scaled thresholds).

**Phase 9.5 integration:** Mutation testing is gated on ME maturity. Stacks where mutation tools are `unsafe` or `beta` (Go, Rust, Python currently) require explicit `--accept-beta-tools` flag or are silently downgraded. MG ensures mutation gate is skipped below 5000 LoC. MH restricts mutation testing to archetypes where it makes sense (not libraries below threshold, not embedded).

---

## M24 — Security Scanning Suite

**Issue:** #72
**Scope:** Generate security scanning enforcement. Currently arbiter generates zero security scanning.

**Status:** COMPLETE (2026-04-17)

**Deliverables:**

Dependency audit (L2+, HARD): ✅

- [x] **Java:** OWASP DependencyCheck snippet `config/owasp-dependency-check.gradle` (failBuildOnCVSS=7.0)
- [x] **TypeScript:** `npm audit --audit-level=high` in CI and gate
- [x] **Rust:** `cargo audit` in CI and gate
- [x] **Go:** `govulncheck ./...` in CI and gate (new)
- [x] **Python:** `pip-audit` in CI and gate

Secrets detection (L2+, HARD): ✅

- [x] Generate `.gitleaks.toml` for all languages
- [x] Gitleaks CI job (`security-early-fail`) in `ci.yml.ejs`
- [x] Gitleaks step in L2 gate (`check-all.mjs.ejs`)

PII scan (L2+, HARD, early-fail): ✅

- [x] Generate `scripts/pii-scan.mjs` (email/phone/credit-card patterns, reads `pii-allowlist.json`)
- [x] PII scan before all other gates in `check-all.mjs.ejs` (HARD, no grace period)
- [x] CI `security-early-fail` job (PII + gitleaks) runs before `lint-and-test`
- [x] Claude Code hook: `check-no-pii.mjs` in PostToolUse (Edit|Write)
- [x] INV-11/12/13 upgraded: `alwaysActive: true`, `minGovernanceLevel: "L2"`, enforcement populated
- [x] INV-12 broadened: "No PII in logs" → "No PII in code, tests, or logs"

Container scan (L3, nightly): ⏳ Deferred to M25

- [ ] Trivy in `nightly.yml.ejs` — TODO(#73)

**Gate:** Dep audit and secrets are HARD (L2+). PII is HARD early-fail (L2+). Trivy is L3 nightly (M25).

**Exit criteria:** All 5 stacks generate security scanning. CI includes dep audit + gitleaks + PII scan for L2+. Matrix tests validate. ✅

**Dependencies:** M21, MC (#84 — suppression pattern), MI (#90 — STRIDE skeleton).

**Phase 9.5 integration:** Dep audit consults suppressions from MC (OWASP DC false positives principled-escape). STRIDE generation replaced with MI's skeleton enforcement — no pre-populated threats. PII scan uses `pii-allowlist.json` from MC.

---

## M25 — Nightly Pipeline & Evidence Harness (L3) ✓ DONE

**Issue:** #73
**Scope:** Generate L3-only nightly pipeline and evidence collection. The prior-art baseline's nightly includes E2E full, mutation, load, security deep.

**Deliverables:**

Nightly pipeline:

- Generate `nightly.yml.ejs` for L3 projects
- Jobs: E2E full suite, mutation testing (from M23), security deep scan (Trivy), load test placeholder
- Change detection: `scripts/ci-classify-changes.mjs` — path filter → flags (docs_only, backend, frontend, high_risk)
- Delta mode: skip L1+L2 if CI already green
- `ci.yml.ejs` conditions jobs on change detection flags

Evidence harness:

- Generate `.evidence/` directory structure
- Generate `scripts/evidence-collect.mjs` — collects logs, reports, generates `SUMMARY.json`
- SUMMARY.json schema: `{obs_gate: "PASS"|"FAIL", tests: {...}, coverage: {...}, timestamp, commit}`
- Gate: evidence REQUIRED for L3 merge

**Exit criteria:** L3 projects get nightly.yml + evidence harness. Change detection optimizes CI for L2+.

**Dependencies:** M23, M24, MA (#82 — archetype axis), MH (#89 — test pyramid profile), MJ (#91 — evidence retention).

**Phase 9.5 integration:** Nightly pipeline jobs are selected per archetype (MH) — no E2E stage for CLI or library archetypes, no Testcontainers stage where no DB. Evidence harness uses MJ retention config (default `local-last-N` count 5, `.evidence/` in `.gitignore`).

---

## M26 — Real Database & Integration Testing ✓ SHIPPED

**Issue:** #74 (PR #188)
**Scope:** Generate Testcontainers setup and enforce real database testing. The prior-art baseline uses Testcontainers with PostgreSQL; H2 is forbidden.

**Deliverables:**

- **Java:** Testcontainers dependency in `build.gradle.ejs` (testcontainers, postgresql), `AbstractIntegrationTest.java` base class, ArchUnit rule forbidding `org.h2` imports (`NoH2ArchTest.java`)
- **TypeScript:** `test-setup.ts.ejs` with testcontainers-node, `eslint-no-fake-db.json.ejs` banning `better-sqlite3`/`sqlite3`
- **Go:** `main_test.go.ejs` with testcontainers-go and TestMain setup
- **Python:** `conftest.py.ejs` with testcontainers-python PostgreSQL fixture
- **Rust:** `db_fixture.rs.ejs` with sqlx + testcontainers test setup

**Gate:** L2+ — integration tests with real database. No in-memory database allowed.

**Exit criteria:** All stacks with database projects get Testcontainers setup. Anti-H2 rule enforced for Java.

**Dependencies:** M22, MA (#82 — archetype axis for `hasDatabase` flag).

**Phase 9.5 integration:** Testcontainers setup emits only when `config.hasDatabase === true` (set by MA). Skipped entirely for CLI / library / frontend-spa without DB. Anti-H2 ArchUnit rule is gated on `architectureStyle !== "none"` — library projects with embedded H2 for tests are not blocked unless the user opts in.

---

## M27 — Behavioral Test Structure & Test Quality ✓ SHIPPED

**Issue:** #75 (PR #189)
**Scope:** Generate test structure templates and quality enforcement. The prior-art baseline uses @Nested/@DisplayName (Java), describe/it (TS).

**Deliverables:**

Behavioral test templates (`src/templates/behavioral-tests/`):

- **Java:** `ExampleBehavioralTest.java.ejs` — `@Nested`/`@DisplayName` Given/When/Then with AssertJ
- **TypeScript:** `example.behavioral.test.ts.ejs` — Vitest `describe/it` with nested context blocks
- **Rust:** `example_behavioral_test.rs.ejs` — `#[cfg(test)]` + `#[test]` with descriptive `given_X_when_Y_then_Z` names
- **Go:** `example_behavioral_test.go.ejs` — `t.Run("given X / when Y / then Z")` subtests
- **Python:** `test_example_behavioral.py.ejs` — pytest `class TestGiven...` with `def test_when_...` methods

Testing policy document:

- `TESTING_POLICY.md.ejs` with L1/L2/L3 governance guards: test pyramid, mock policy, E2E policy, naming conventions, coverage targets

Playwright quality (frontend-spa TypeScript only):

- `.eslintrc-playwright.json.ejs`: no-force-option, no-wait-for-timeout, no-page-pause, prefer-web-first-assertions
- Playwright gate wired in `check-all.mjs.ejs` (L1, graceful skip if plugin absent)

Gate (dual-sided, CANON-01/14):

- `scripts/check-test-naming.mjs.ejs` — language-specific naming convention gate (HARD L1+) for all 5 stacks
- Wired in `check-all.mjs.ejs` and in arbiter's own `scripts/check-all.mjs`

**Dependencies:** M26, MH (#89 — test pyramid profile).

**Phase 9.5 integration:** All behavioral templates emit unconditionally (every project gets TESTING_POLICY.md and the naming gate). Playwright config emits only for `frontend-spa + typescript`.

---

## M28 — Contract Testing (Configurable) ✅ SHIPPED

**Issue:** #76
**Scope:** Generate contract testing setup branching on `config.contractType` (set by ML, #93).

**Deliverables (per contractType):**

- **`rest-owned`:** Pact consumer + provider setup (pact-jvm / @pact-foundation/pact / equivalent)
- **`rest-public`:** OpenAPI diff — breaking-change detector in CI
- **`graphql`:** graphql-inspector schema diff
- **`grpc`:** buf breaking check
- **`message-queue`:** schema registry integration (Avro/Protobuf)
- **`none`:** no generation
- CI: Contract verification job in `ci.yml.ejs` (L2+) per type

**Gate:** INV-34 (HARD for L2+ when contractType ≠ "none").

**Dependencies:** M26, ML (#93, shipped — provides `config.contractType`).

---

## M29 — Complete Static Analysis Suite

**Issue:** #77
**Scope:** Generate precise static analysis config for all languages. Currently generates generic configs; must generate precise rulesets.

**Deliverables:**

- **Java:**
  - `config/checkstyle/checkstyle.xml` (CC≤15, method≤65, params≤7, classFanOut≤25)
  - `config/pmd/ruleset.xml` (7 categories: design, error-prone, security, multithreading, best-practices, performance — precise rules, not generic)
  - `config/spotbugs/exclude-filter.xml` (security patterns always active, framework FP narrowly suppressed)
  - Spotless plugin in `build.gradle.ejs` (Google Java Format)
- **TypeScript:** ESLint config: no-console, complexity, max-params, max-depth, max-lines-per-function, max-nested-callbacks, eslint-plugin-boundaries
- **Rust:** `clippy.toml` with pedantic + deny rules
- **Go:** `.golangci.yml` with full linter suite (gocyclo, goconst, gosec, gofmt, govet, deadcode)
- **Python:** `ruff.toml` with precise rules (C901, PLR0911-0913, F401, F811, S rules for security)

**Gate:** ALL static analysis tools are HARD gate (L1+).

**Dependencies:** M21, MB (#83 — baseline-freeze), MG (#88 — scaled thresholds + tiers).

**Phase 9.5 integration:** Precise thresholds for Checkstyle/PMD/ESLint come from MG per-tier rule sets (practical vs pedantic). Brownfield projects get baselines captured via MB's extended debt ratchet — existing violations lock in, only regressions fail the gate.

---

## M30 — Coverage Tool Integration ✅

**Issue:** #78 (closed)
**Scope:** Integrate coverage verification into build tools, not just gate scripts. Previously thresholds were only in gate script; now enforced in build tool config too.

**Deliverables (shipped):**

- **Java/Gradle:** `gradle/jacoco.gradle` — JaCoCo plugin, `jacocoTestCoverageVerification` task with line/branch thresholds, exclusions, HTML+XML reports to `build/coverage/`
- **Java/Maven:** `docs/coverage/jacoco-maven-setup.md` — advisory doc with full `pom.xml` snippet (fragment pattern, same as pitest)
- **TypeScript:** `vitest.config.ts` — provider v8, reporters text/html/lcov, threshold enforcement
- **Rust:** `.tarpaulin.toml` — `out = ["Html", "Xml", "Lcov"]`, `output-dir = "coverage/"`, threshold via `--fail-under` in gate
- **Python:** `.coveragerc` — `[run] branch=True`, `[report] fail_under`, html+xml+lcov report dirs
- **Go:** no config file; HTML report via `go tool cover -html` in gate script
- **CI:** `ci.yml.ejs` — JaCoCo path normalization steps (Gradle+Maven) + `actions/upload-artifact` for all stacks

**Gate:** Coverage verification in build tool (not just gate script).

**Phase 9.5 integration:** Coverage thresholds are no longer hardcoded. MG computes them per-project from LoC floors + archetype + strictness tier. A 500-LoC Rust CLI does not get a 80% threshold; a 100k-LoC monolith gets archetype-calibrated numbers.

---

## M31 — Configuration Skill & arbiter.json v2

**Issue:** #79
**Scope:** Post-init configuration via skill + richer arbiter.json.

**Deliverables:**

- Skill `/arbiter configure`: modify arbiter.json interactively
  - Toggle features (contract testing, mutation testing, security scanning)
  - Override thresholds (coverage, complexity)
  - Add/remove AI tools
- arbiter.json v2 schema with features and thresholds sections
- `arbiter update` reads v2 and regenerates only impacted files

**Dependencies:** M25.

---

## M32 — Extended AI Tool Support

**Issue:** #80
**Scope:** Additional AI tool support and plugin API.

**Deliverables:**

- Gemini CLI: `.gemini/GEMINI.md` + settings
- Windsurf: `windsurf-instructions.md`
- Aider: `.aider.conf.yml`
- Plugin API v1: interface for custom generators

**Dependencies:** M31.

---

## M33 — CLI-First Policy & Shared run-cli Wrapper

**Issue:** #95
**Scope:** Formalize CLI-first as an architectural invariant, consolidate scattered `spawnSync` call sites into `src/utils/run-cli.ts`, close the MCP fallback door left open in ADR-003, and clean up dangling MCP references across the docs. Arbiter was already CLI-first in practice — this milestone makes it enforceable.

**Deliverables:**

- `src/utils/run-cli.ts` + `__tests__/utils/run-cli.test.ts` (12 test cases: success, non-zero exit, timeout, ENOENT, retry, cwd, env, stdin, JSON parse)
- `docs/ADR/020-cli-first-over-mcp.md`
- `docs/ADR/003-gh-cli-required.md` — GitHub MCP fallback permanently closed
- `docs/ADR/README.md` — index updated with 018/019/020
- `docs/architecture/TEMPLATE-SYSTEM.md` — dangling `rules/mcp-usage.md` row removed
- `docs/PRODUCT/FEATURE_COMPARISON.md` — rows 75-78 reframed with `NG` / `G` values + ADR-020 footnote
- `AGENTS.md` — new **INV-12** (no direct `child_process` in `src/`, no MCP dependency)
- `.claude/hooks/check-no-direct-spawn.mjs` + registration in `.claude/settings.json`
- Migrated call sites: `src/detectors/git.ts`, `src/detectors/github.ts`, `src/github/labels.ts`, `src/github/branch-protection.ts`, `src/github/project-board.ts`, `scripts/check-all.mjs`

**Exit criteria:**

- L2 gate passes after migration
- `grep -rE "node:child_process" src/` matches only `src/utils/run-cli.ts`
- `grep -ri "MCP" docs/` matches only ADR-003 (historical), ADR-020 (policy), FEATURE_COMPARISON (gap with rationale), and this milestone entry
- `arbiter init` on a scratch repo produces zero MCP strings in generated output

**Dependencies:** M32.

---

## Milestone Dependency Graph

```
M1-M21 (ALL DONE)
         │
    [M0: Retrospective docs] ── prerequisite
         │
    ┌────┴────────────────────────────────────────────┐
    │  Phase 9.5 — Foundation (epic #81)              │
    │                                                  │
    │  MA (#82 archetype) ──┬── MB (#83 baseline) ── MK (#92 grace)
    │                       ├── MG (#88 thresholds)
    │                       ├── MH (#89 pyramid)
    │                       ├── MJ (#91 evidence retention)
    │                       └── ML (#93 contract type)
    │                                                  │
    │  MC (#84 suppressions) — parallel               │
    │  MD (#85 verify) ─── MF (#87 nightly matrix)    │
    │  ME (#86 maturity) — parallel (doc)             │
    │  MI (#90 STRIDE skeleton) — parallel            │
    └────────────────┬─────────────────────────────────┘
                     │
         ├── M22 (Architecture) ──┐           [needs MA, MC, ME]
         │                         │
         ├── M23 (Mutation) ───────┤           [needs ME, MG]
         │                         ├── M25 (Nightly + Evidence)  [needs MA, MH, MJ]
         ├── M24 (Security) ───────┤           [needs MC, MI]
         │                         │
         ├── M26 (Real DB) ────────┘           [needs MA]
         │    │
         │    ├── M27 (Behavioral) [needs MH]
         │    └── M28 (Contract)   [needs ML]
         │
         ├── M29 (Static Analysis) ── M30 (Coverage) [needs MB, MG]
         │
         └── M31 (Configure) ── M32 (Extended AI Tools)
```

**Entry point (Phase 9.5):** MD (#85) — smallest blast radius, isolated command, validates end-to-end approach.

**Critical path (Phase 9.5):** MA → MB → MK (~3 weeks serial). MC/MD/ME/MI run in parallel with MA.

**Critical path (Phase 10):** Phase 9.5 complete → M22 → M23 → M24 → M25 → M31.

**Parallelizable (Phase 10):** M22/M23/M24/M26/M29 can start in parallel once their Phase 9.5 prerequisites are met. M27/M28 after M26. M30 after M29. M32 after M31.

---

## Reconciliation 2026-07-18 (autonomous run #2000)

This section reconciles the milestone table above (last substantively updated
2026-04-19) against the live GitHub board as of 2026-07-18. It is an append-only
audit — the historical sections above are left untouched.

### a. Discrepancies found

Every `**Issue:**` / `**Issues:**` reference across M1-M33 (46 issues: M1-M21,
M11's #28/#34/#40, MA-ML's #82-#93, M22-M33, plus epic #81) was checked with
`gh issue view <n> --json state,title`.

**Result: zero state discrepancies.** All 46 referenced issues are `CLOSED` on the
live board, which matches or is consistent with every milestone this document
marks `✅ DONE` / `✓ SHIPPED` / `✓`.

| M | Issue | Status (doc) | Status (real) | Note |
| --- | --- | --- | --- | --- |
| M23 | #71 | *(no header marker)* | CLOSED | Header carries no ✅/✓ despite the issue being closed — cosmetic omission, not a false claim. |
| M24 | #72 | *(no header marker; inline "Status: COMPLETE (2026-04-17)")* | CLOSED | Consistent — inline status is correct, only the header checkmark is missing. |
| M29 | #77 | *(no header marker)* | CLOSED | Same pattern as M23. |
| M31 | #79 | *(no header marker)* | CLOSED | Same pattern as M23. |
| M32 | #80 | *(no header marker)* | CLOSED | Same pattern as M23. |
| M33 | #95 | *(no header marker)* | CLOSED | Same pattern as M23. |

No issue referenced by this document was found open, and no issue number
referenced was missing/nonexistent on the board. The five rows above are flagged
as a **formatting gap** (missing header checkmark), not a state discrepancy: the
underlying milestones are all real-closed. Left as-is as a historical-fidelity
call — not rewritten per the append-only rule for this run.

### b. Active tracks (live board)

**Open epics:**

| Epic | Title | State |
| --- | --- | --- |
| #1491 | Release-readiness remediation — pre-public-launch fix waves | OPEN |
| #1770 | Release v0.1 — public-launch wave (audit 2026-07-04) | OPEN |
| #1943 | Anti-context-rot enforcers E1-E7 (M8/M12/M13/M14/M9/M1/M4/M6 TO-CREATE debt) — untracked | OPEN |

**Milestone 7 — "GAP remediation (run #2000)":** 20 open issues, 2 closed.

**Open PRs (human-gated):**

| PR | Title | State |
| --- | --- | --- |
| #2002 | fix(wave): wave-5 integration — anti-context-rot twins, spawn-guard knob, compliance flags, T9 demo | OPEN |
| #2019 | docs(ssot): retarget stale governance paths to docs/internal/... | OPEN |
| #2024 | docs(gap): land GAP.md — verified claim inventory (run #2000) | OPEN |

**Verified-claim inventory:** `docs/internal/SYSTEM/GAP.md` (landing via #2024, not
yet on `main` as of this reconciliation; not to be confused with the generated
feature-gap register at `docs/internal/PRODUCT/GAP.md`) is the current
ground-truth audit of 78 documentation/enforcement claims: 46 VERO, 5 FALSO, 9
PARZIALE, 4 VACUO, 2 GRANDFATHERED (VERO but ratchet-excused). Treat it as the
authoritative claim inventory once merged.

### c. Operative source of truth

Operative state tracking = **issue + milestone + label** (GitHub Issues/Milestones/Labels).
GitHub Projects (v2) is not usable as the source of truth for this reconciliation —
board access is blocked by an insufficient token scope (see #2000).
