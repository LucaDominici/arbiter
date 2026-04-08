# Arbiter — Milestones

**Status:** Active
**Last updated:** 2026-04-02

Each milestone has a scope, exit criteria, and dependency chain. Milestones are tracked as GitHub issues.

---

## M1 — Documentation Foundation ✅ DONE

**Issue:** #10
**Scope:** Create docs/ hierarchy, split ADR monolith, migrate existing docs, update links.

**Deliverables:**

- `docs/ADR/001-008.md` (split from `docs/ADR.md`)
- `docs/ARCHITECTURE/OVERVIEW.md` (migrated from `docs/ARCHITECTURE.md`)
- `docs/ARCHITECTURE/CONFLICT-RESOLUTION.md` (split)
- `docs/REFERENCE/CLI.md` (migrated from `docs/CLI.md`)
- `docs/ADR/README.md` (index + format template)
- `README.md` links updated

**Exit criteria:** 8+ ADR files exist, docs/ hierarchy established, no broken links, old flat files deleted.

**Dependencies:** None.

---

## M2 — PRD & Product Docs

**Issue:** #11
**Scope:** Write `docs/PRODUCT/PRD.md`, `docs/PRODUCT/MILESTONES.md`, `docs/PRODUCT/COMPETITION.md`.

**Deliverables:**

- `docs/PRODUCT/PRD.md` — Vision, problem, users, features by phase, supported stacks, governance levels, success metrics
- `docs/PRODUCT/MILESTONES.md` — This file
- `docs/PRODUCT/COMPETITION.md` — Competitor analysis (ai-rulez, ruler, manual setup)

**Exit criteria:** PRD covers all phases + non-goals + metrics. Competition analysis covers key alternatives. `README.md` links to PRODUCT docs.

**Dependencies:** M1.

---

## M3 — Architecture & Development Docs

**Issue:** #12
**Scope:** Architecture deep-dives, development guides, and retroactive ADRs 009-011.

**Deliverables:**

- `docs/ARCHITECTURE/CANONICAL-SOURCE-MODEL.md` — Why AGENTS.md, thin pointer pattern, drift prevention
- `docs/ARCHITECTURE/TEMPLATE-SYSTEM.md` — EJS architecture, variable reference, conditional branches
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

## M4 — Reference Docs

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

## M5 — Test Infrastructure

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

## M6 — Generator & Template Tests

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

## M7 — Matrix, Tool & Brownfield Tests

**Issue:** #16
**Scope:** Language matrix integration, brownfield scenarios, integration expansion. ~145 → 200+ tests.

**Deliverables:**

- `__tests__/matrix/` — Full `arbiter init` → output per language (TS, Java, Rust, Go, Python)
- `__tests__/brownfield/` — Scenarios: existing AGENTS.md, existing .claude/, existing ai-rulez, settings merge
- Integration tests expanded: multi-tool, multi-level init variants

**Exit criteria:** Full init→output validated for all 5 languages and all 4 tools. Brownfield scenarios for AGENTS.md, .claude/, ai-rulez, settings.json. 200+ total tests. 85%+ coverage. CI green.

**Dependencies:** M6.

---

## M8 — Documentation Enforcement

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

## M9 — Real Repo Validation

**Issue:** #18
**Scope:** Run `arbiter update` on haben and coach-system. Verify output. Fix any regressions.

**Deliverables:**

- Verified: `arbiter update --dir <path>` succeeds on both repos with no errors
- Verified: existing customizations in haben preserved
- Verified: settings.json merged correctly in coach-system
- Any regressions found → fixed with tests added

**Exit criteria:** Both repos updated without errors. Existing customizations preserved. No regressions.

**Dependencies:** M7, M8.

---

## M10 — Smart Init Wizard Redesign

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
**Scope:** Generate `/start-task` and `/complete-task` slash commands for target projects. Migrate all bash hooks to portable Node.js `.mjs` files. Retroactive matrix test expansion for INV-11.

**Deliverables:**

- `.claude/commands/start-task.md` template (governance-level-parameterized)
- `.claude/commands/complete-task.md` template (governance-level-parameterized)
- All `.sh` hooks rewritten as `.mjs` (Node.js, cross-platform)
- Settings merge logic upgraded to handle `.sh` → `.mjs` migration
- Cross-product matrix tests: 5 stacks x 3 levels for AGENTS.md, ci.yml, check-all.mjs, commands

**Exit criteria:** Commands generated for all governance levels. All hooks are `.mjs`. Matrix tests pass for all 60 cells. CI green.

**Dependencies:** M10.

---

## M12 — Go/Python Stack Parity (foundation repair)

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

## M13 — Documentation Alignment + Retroactive Fixes

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

## M15 — Generated Per-Stack Tech Debt Gates

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

## M16 — Novel Anti-Tech-Debt Mechanism

**Issue:** #43
**Scope:** Design and implement a proactive tech debt detection system that does not exist in Viafera or any comparable tool. Generated for target projects across all stacks. See ADR-014.

**Deliverables:**

TBD after M12-M15 establish the foundation. Potential forms:

- A generated `scripts/debt-audit.mjs` that quantifies debt metrics and trends them over time
- A baseline file (`debt-baseline.json`) that captures current debt state; gate fails on regression
- A Claude Code agent or hook that audits for debt patterns on schedule
- Integration with the gate system: L2 includes debt-no-regression check, L3 includes debt-zero check
- Dashboard or report output (markdown or JSON) attachable to PRs

**Testing protocol:** 6-repo real-project validation + demonstrate debt detection catches a real regression.

**Exit criteria:** Mechanism detects at least: coverage decay, complexity creep, dead code accumulation, dependency staleness, placeholder accumulation. Works across all 5 stacks. Baseline comparison prevents regressions.

**Dependencies:** M15.

---

## M17 — Advanced Hooks (previously M12)

**Issue:** #35
**Scope:** Generate advanced Claude Code hooks for target projects: plan-anchor, debug-state, pre-compact, dispatch.

**Dependencies:** M16.

---

## M18 — Rich Invariant Catalog (previously M14)

**Issue:** #37
**Scope:** Expand from 10 to 25+ invariants across 5 tiers. Now includes Go and Python invariants (made possible by M12).

**Dependencies:** M12, M15.

---

## M19 — Skills & Sub-Agents Generation (previously M13)

**Issue:** #36
**Scope:** Skeleton skills and agent definitions for target projects.

**Dependencies:** M17.

---

## M20 — SSOT Framework Generation (previously M15)

**Issue:** #38
**Scope:** Knowledge map, track router, engineering defaults.

**Dependencies:** M18.

---

## M21 — Richer GitHub Integration (previously M16)

**Issue:** #39
**Scope:** Task-brief templates, epic template, project board.

**Dependencies:** M20.

---

## Milestone Dependency Graph

```
                    ┌── M1-M10 (DONE) ──┐
                    │                    │
                    v                    v
                  M11 (DONE)          (docs/tests done)
                    │
                    v
            ┌─── M12 (Go/Python fix) ───┐
            │                            │
            v                            v
          M13 (doc alignment)      M18 (invariants)
            │
            v
          M14 (self-enforce)
            │
            v
          M15 (generated gates)
            │
            v
          M16 (anti-debt mechanism)
            │
            v
          M17 (advanced hooks)
            │
            v
          M19 (skills/agents)
            │
            v
          M20 (SSOT framework)
            │
            v
          M21 (GitHub integration)
```

**Critical path:** M12 → M13 → M14 → M15 → M16 → M17 → M19 → M20 → M21

**Parallelism:** M18 (Rich Invariant Catalog) can start after M12 + M15, independent of M13-M14.
