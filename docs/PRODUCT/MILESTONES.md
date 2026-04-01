# Arbiter — Milestones

**Status:** Active
**Last updated:** 2026-04-01

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

## Milestone Dependency Graph

```
M1 → M2 → M3 ──┐
          → M4 ─┤
     M2 → M5 ──┼→ M6 → M7 → M8 → M9
                │              └──→ M10
                └─────────────────┘
```

**Parallelism:**

- M3 ∥ M4 (architecture docs ∥ reference docs)
- M4 ∥ M5 (reference docs ∥ test infrastructure)
- M10 can start after M7 (independent of M8, M9)
