# Changelog

All notable changes to this project are documented in this file.

This project uses [changesets](https://github.com/changesets/changesets) and follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions. Versions are aligned to
[Semantic Versioning](https://semver.org/) (pre-1.0: a breaking change bumps the minor).

## [Unreleased]

_Nothing yet._

## [0.4.0] — 2026-07-07

**Channel:** stable

### Highlights

- **Wave-2 kit (#1817, A1–A11)** — governance features validated against a real
  100k-LOC adopter project before being absorbed into arbiter:
  - `arbiter init` generates a **five-lane CI shape** (pre-commit / PR-blocking /
    nightly / weekly / release-seal) with tier budgets in comments, plus a sticky
    failure issue for persistently-red nightly/weekly lanes. (A1, A6)
  - **Journey-first Definition-of-Done**, extending INV-114 completion evidence
    from unit coverage to user-journey coverage. (A2)
  - **Zero-retry smoke + quarantine TTL** for E2E suites — a flaky test gets a
    time-boxed quarantine, not an indefinite retry loop. (A3)
  - An installable **E2E constitution** (~10 rules) that ships as project
    governance, not just prose convention. (A4)
  - **`doctor --prove-gates`**: negative-proof checks that a project's gates
    actually catch what they claim to (deliberately break an invariant, assert
    the gate goes red). (A5)
  - Executable **handoff template** + model-pyramid guidance for right-sizing
    which model tier runs a given step. (A7, A8)
  - Cross-stack **kit** gates: Java (Flyway migration hygiene + taxonomy) and
    frontend (design-token hygiene). (A9, A10)
  - **Closer mode**: an installable rule + close-phase + guard hook so an agent
    can drive a task to a verified, merged state autonomously. (A11)
- **B-prune (#1817, B1+B2)** — removed 2025-era model-tier machinery superseded
  by A8's model-pyramid guidance and the wave-2 kit. `src/sizing/`,
  `src/affinity/`, `src/cost/`, `src/decomposition/`, the multi-pass
  `src/review/` dispatch subsystem, and the `arbiter work` / `findings promote`
  commands are gone (**-11,423 LOC**). `arbiter review diff` remains the one
  review entry point; `verticalsForTier` is now the tier→vertical SSOT.
- **Dependency hygiene**: dependabot alert backlog drained across fixtures,
  examples, and transitive deps.

### Removed

- `arbiter work` (issue decomposition backend).
- `arbiter findings promote` / `arbiter findings list` (auto-drain of the
  finding spool into filed issues) — the spool (`.arbiter/findings/*.jsonl`,
  written by `arbiter note`) is unaffected; promotion is manual now.
- `arbiter review code` / `arbiter review plan` (multi-pass review dispatch)
  and the cost-tracking runtime (`--skip-budget`, transcript-based cost
  evidence).

## [0.3.0] — 2026-07-05

**Channel:** stable

### Highlights

- **First public-release prep (epic #1770, T11)** — the tag `v0.2.0` predates 418 commits
  of internal hardening, so this release ships under a fresh version rather than
  retagging stale history.
- **Public CLI surface reduced to 11 commands** — experimental/R&D commands hidden from
  `--help` (still reachable, unlisted) and dead R&D commands removed outright.
- **Docs split**: public-facing docs separated from internal governance docs so the
  published package/README reflects only what an external user needs.
- **Packaged-artifact E2E**: an outsider-simulation test exercises the packaged tarball
  the way an external consumer would, catching packaging gaps the source tree hides.
- **Evidence/redaction hardening**: user paths and private-project attributions redacted
  from evidence bundles and examples before anything ships externally.
- **CI resilience**: templates fall back to `ubuntu-latest` when runner-label variables
  are absent, so generated CI does not silently break for external adopters without the
  self-hosted runner configured.
- **Iron Laws** codified in project governance (PR-owned-until-merged; pre-existing
  failures are fixed at the root cause, not dismissed).

### Changed

- `runnerProfile` config axis (`solo` | `fleet`) for the CI cadence model (ADR-101).
  `fleet` (default) is byte-identical to previous output; `solo` moves heavy scheduled
  jobs (fuzz, soak-e2e) to the weekly workflow for single-runner setups, with the weekly
  gate hard-failing on fuzz/soak regressions. (#1693)
- `exceljs` runtime dependency replaced with a native zero-dependency xlsx writer,
  removing transitive `uuid@8` (GHSA-w5hq-g745-h8pq) from the production closure.
  `arbiter feature-matrix export --format xlsx` output contract unchanged. (#1670)

## [0.2.0] — 2026-06-21

**Channel:** stable

### Highlights

- **Gold-depth (epic #1469)** — the gold-audit gains deterministic `forbidden_pattern`,
  `file_stat` and constrained-glob check types (dual-engine byte-parity), a fail-closed
  `freshness()` banner + `gold-audit --check-fresh`, an ADR→check enforcement-linkage gate,
  and a TTY-gated goldness **cockpit** (`gold-audit --cockpit` / `--ascii`).
- **Governance L4** — `GovernanceLevel` widened to L1/L2/L3/L4; the evidence harness moves to
  L4-only. (Breaking; pre-1.0 so released as a minor.)

### Behavior

- Exit-code contract extended: `arbiter update` and `arbiter init` now exit `78` (POSIX
  `EX_CONFIG`) when no arbiter config is found or a pre-flight config error occurs, instead
  of exiting `1` or `0`. Fatal gh API errors (e.g. auth lost) now exit `2`; recoverable
  gh errors (e.g. 404 label not found) continue to exit `1`. (#1074, ADR-002, INV-53)
- `--json` envelopes now include an `errorClass` field (`recoverable`|`fatal`|`config`)
  alongside `status` when an error occurs, enabling CI wrappers to triage failures
  without parsing error message strings. (#1074)

### Added

- `audit-toolchain.mjs` generator (Track A + Track B): emits a toolchain audit script
  that checks CI workflow files, gate scripts, and build toolchain presence (#887, W11)
- TDD evidence bundle for W11 planning skeleton migration close-out

### Added & Changed

- feat(claude): emit 50-batch-execution.md rule for safe parallel agents (#722)
- feat(#710): ISO 27001 / NIS2 / GDPR compliance mapping generator

  Adds opt-in `generateCompliance` generator that emits `docs/COMPLIANCE_MAPPING.md`
  mapping every arbiter-generated quality gate to the compliance control it satisfies.
  Supports three independent frameworks via `enableIso27001Mapping`, `enableNis2Mapping`,
  and `enableGdprMapping` flags. Includes audit preparation checklists per framework.

- Generate context-economy rule, machine-readable knowledge-map, pre-task track detection hook, and track-aware post-commit checklist (#720, #724).

  - `.claude/rules/40-context-economy.md` — minimum startup set + track routing table
  - `.claude/knowledge-map.json` — machine-readable track routing (signal paths, required/optional docs per track)
  - `.claude/hooks/pre-task-track-detect.mjs` — UserPromptSubmit hook that detects frontend/backend/docs track from changed files and prompt keywords
  - `post-commit-check.mjs` extended with per-track checklist output after INV-22 conventional commit check

- docs(#533 #566 #599 #609 #665 #666 #667): add semver policy, file stability map, ROADMAP.md, POSITIONING.md, measurement guide, anti-overclaim doc, and FAQ
- feat(evidence): emit evidence-prune.mjs + retention policy doc; red-team SSOT vectors (#718 #723)
- Add telemetry-stance banner on first run (#548) and polished error messages (#547)
- Add experimental feature flag system (#601). Introduces `--experimental.<name>` CLI flag for opt-in experimental features. Unknown experiment names are rejected with a clear error. Flags stored in `ARBITER_EXPERIMENTAL` env var for downstream commands. Registry ships empty; experiments added as features are promoted to beta.
- Add CLI flag deprecation lifecycle (#606). Introduces three-stage deprecation: `warn` (flag passes through with stderr notice), `hide` (flag suppressed from --help with notice), `remove` (flag rejected with replacement hint). Lifecycle enforced by `check-deprecations.mjs` gate. Registry ships empty; flags added as they are deprecated.
- feat(#617 #611): adverse git state detection + atomic file writes

  - Detects rebase, merge, cherry-pick, bisect, and detached HEAD before writing files
  - `--force` flag overrides the check with a warning
  - All file writes now use atomic tmp-then-rename pattern; ENOSPC surfaces a clear UserFacingError

- feat: M-19 — emit docs/COMMANDS.md CLI catalog at L2/L3 (#728)

  Generates a uniform command reference from project config (build/test/lint/format
  commands + gate commands) via `src/templates/documentation/cli-catalog.md.ejs`.

- feat(#730): generate check-no-skipped-tests.mjs hook for target projects. The new NI-11 enforcement hook blocks `.skip()`, `xit()`, `@Disabled`, `@pytest.mark.skip`, and `#[ignore]` patterns on PostToolUse Edit|Write. Wired in the Claude hooks dispatcher and Codex config adapter for all target projects.
- Phase C1 of #867: arbiter self-dogfoods the 8-tier CI structure. Generates `.github/workflows/0[1-9]-*.yml` from the templates introduced in #866. Adds `.arbiter/workflow-exemptions.json` mechanism (consumed by `scripts/check-arbiter-self-dogfood.mjs`) to allow listed files to be skipped during the dual-run window, paired 1:1 with sunset conditions in `docs/SYSTEM/CI-TIER-EXCEPTIONS.md`. Legacy 18-workflow set still active; PR-3 migrates orphan jobs and PR-4 deletes them.
- Phase C3+C4 of #867: remove the legacy `generateNightly` pipeline (superseded by the 8-tier model from #866). Deletes `src/generators/nightly.ts`, `src/templates/github/workflows/nightly.yml.ejs`, the `nightly` registry entry, and the M25 `generateNightly` cross-product tests. Also fixes `.github/workflows/security-scan.yml:24` — removes the `continue-on-error: true` on the gitleaks step so novel secret leaks block PR/merge instead of being silently advisory. Documents in `docs/SYSTEM/CI-TIER-EXCEPTIONS.md` that arbiter's 18 legacy workflows persist as arbiter's internal test suite while the 8 tier files are the public spec demo — original PR-3/PR-4 plan to fold all legacy into templates was the wrong architecture.
- feat(quality): CANON-22 evidence-based quality — un-blind gates + real DRY/duplication enforcement

  **Un-blind (PART A).** Removed the blanket `ignoreIssues` mute from `knip.json` (a live CANON-09 violation — a gate that hid its own findings). Resolved the surfaced rot: deleted dead `src/context-pack/`, `src/commands/tooling-promote.ts`, the orphan `src/templates/css/.stylelintrc.json.ejs`, and the unused `src/kit/index.ts` barrel; wired the `integrations list` CLI command; gated the `pharma` generator behind `industryOverlay==='pharma'`; declared `src/adapters/index.ts` a knip `entry` (INV-88 surface). Fixed the vacuous `madge --circular src` (0 files scanned) → `--extensions ts,tsx,js,jsx` in arbiter CI, the generated `01-pr-fast.yml.ejs`, the qa-audit schema, and both `check-all` variants. The ~37 tested-but-uncalled exports knip masks are recorded as a tracked anti-bloat burn-down (`docs/audits/unwired-exports-2026-06-01.md`) where a hard `ts-prune` gate lands after burn-down — not muted, not faked.

  **Real DRY / anti-bloat (PART B).** New `src/generators/duplication.ts` emits a governance-scaled `.jscpd.json` + the jscpd devDep to TypeScript targets (dual-sided with arbiter's own dogfooded `jscpd` gate). Added `duplicationPercentage` to the debt ratchet (Lehman entropy — a patch can't raise duplication). Added a root-cause-or-record-debt rule to `90-exec-protocol.md` and Anti-Bloat & Root-Cause vectors (symptom-vs-root-cause, dup-of-existing-helper, missed-extraction) to the red-team agent. Trimmed the `clean-code` skill to a gate-map.

  **CANON-22 (PART C).** New `docs/SYSTEM/CANON.md` entry separating Tier-1 validated metrics (McCabe, CK/Basili, Khomh/Palomba, Juergens, Lehman, SEI/SQALE, Boehm) that may HARD-GATE from Tier-2 contested heuristics (SOLID, DRY-as-dogma, cognitive complexity) that may only advise. Graduated the duplication gate + ratchet to INV-109 with AGENTS.md↔catalog parity.

- feat(governance): product-truth FEATURE_MATRIX v1 — generated + gated RTM (INV-112, CANON-23)

  Materializes the reconciliation audit as arbiter's committed Product-Truth bible:

  **Track A (self-doc):** `docs/PRODUCT/FEATURE_MATRIX.md` — 50 rows, all 77 KIT dims covered,
  conservatively seeded (Partial/Done max; no Verified from seed). Status ladder:
  Missing → Partial → Done → Verified (fail-closed, machine-validated).

  **Gate:** `scripts/check-feature-matrix.mjs` (INV-112, L1 fail-closed) validates:

  - Status ladder (Verified ⟹ all 4 refs non-empty + files exist)
  - KIT-dim coverage via `kit_dims` column join against `src/kit/catalog.json`
  - Counter integrity (summary row counts match actual)
  - L3+ DoD: Done/Verified rows must have test_ref file present
  - L4: audit_trail-category rows require code_ref + test_ref
  - Level injection via `--level L2|L3|L4` / `ARBITER_MATRIX_LEVEL` env for fixture testing

  **Track B (governed projects):** `src/generators/feature-matrix.ts` + `src/templates/docs/FEATURE_MATRIX.md.ejs`
  scaffold the matrix for target projects at L2+ (skipIfExists, user-owned after first write).

  **Export:** `arbiter feature-matrix export --format csv|xlsx` — CSV via hand-rolled RFC-4180
  (reuses `src/kit/csv.ts` pattern; zero new dep), xlsx via lazy-imported `exceljs`.

  **INV-112:** `tier:governance`, `alwaysActive:true`, `minGovernanceLevel:'L2'`, `selfOnly:false`.
  **CANON-23:** RTM-required-by-level; promoted to INV-112.

  **Parity:** AGENTS.md + GLOBAL_INVARIANTS.md + CLI ref + doc index all updated.
  Count tests updated: 109 → 110 invariants (5 assertions).

  **GAP register:** 10 issues filed (#1149–#1158) for all Partial/Missing rows and rigor holes
  (a11y, Kotlin, kit-gate fiction, anti-drift orphan, CANON-09 blind spot, 29 untested gates,
  17 undocumented commands, generic L4 audit-trail, dead config, CANON parity).

- first-class FE governance — WCAG 2.2, W3C DTCG tokens, Vitest browser mode + VRT, Core Web Vitals gates, framework-aware (react/vue/svelte); arbiter is now genuinely full-stack.

  Supersedes #1124 (initial frontend-governance generator — FE constitution + design principles).

  ## New generators
  - **`frontend-governance`** (#1124): emits `FRONTEND_CONSTITUTION.md` + `FE_DESIGN_PRINCIPLES.md`.
  - **`frontend-quality`** (#1127): emits all mechanical enforcement scripts (tokens, i18n, coverage, VRT, perf, bundle).

  ## Framework-awareness fix (#1127 S0)

  Fixed framework-blindness bug: `.eslintrc-frontend-spa.cjs` now branches on `config.frontend.framework` — Vue gets `.vue` globs + `vuejs-accessibility`, Svelte gets `.svelte` + `eslint-plugin-svelte`, React gets `.tsx/.jsx` + `jsx-a11y`. Before this, all frontend-spa projects received React-shaped output.

  Auto-detection: `init.ts` now derives `frontend.framework` from the detected `config.framework` for frontend-spa projects (vue→vue, react→react, next→react, svelte→svelte).

  New `vue-frontend-spa` fixture proves non-React output (INV-32 matrix compliance).

  ## WCAG 2.2 upgrade (#1127 S1)

  `run-axe.ts.ejs` upgraded from WCAG 2.1 AA to full WCAG 2.2 AA tag set (`wcag2a + wcag2aa + wcag21a + wcag21aa + wcag22aa`). Covers target-size (2.5.8), focus-appearance (2.4.11), accessible-auth (3.3.8).

  `16-frontend-quality.yml.ejs` a11y step is now blocking (removed `|| true`; routes through Playwright harness).

  ## New enforcement artifacts (emitted by `frontend-quality` generator)

  | Artifact                           | Purpose                                   | Invariant |
  | ---------------------------------- | ----------------------------------------- | --------- |
  | `design-tokens.json`               | W3C DTCG token seed                       | INV-105   |
  | `scripts/verify-tokens.mjs`        | raw hex/phantom token gate                | INV-105   |
  | `scripts/i18n-literal-scanner.mjs` | raw UI text literal gate                  | INV-106   |
  | `scripts/verify-i18n-parity.mjs`   | locale key-parity gate                    | INV-106   |
  | `scripts/verify-fe-coverage.mjs`   | per-layer coverage ratchet                | —         |
  | `vitest.browser.config.ts`         | Vitest browser mode (Playwright/Chromium) | —         |
  | `docs/GOVERNANCE/VRT_SETUP.md`     | VRT baseline capture guide                | —         |
  | `.lighthouserc.json`               | CWV 2026 blocking budgets (LCP/CLS/INP)   | —         |
  | `bundle-budget.json`               | bundle size budget config                 | —         |
  | `scripts/check-bundle-size.mjs`    | bundle size gate vs dist/                 | —         |

  ## New invariants

  INV-102 API-layer isolation, INV-103 headless domain purity, INV-104 state-mgmt discipline, INV-105 token discipline, INV-106 i18n parity. All tier=operational, languages=[typescript], minGovernanceLevel=L2.

  **Blast radius:** Projects with `frontend-spa` archetype or `lanes: ["frontend"]` receive new enforcement artifacts on next `arbiter update` (all `skipIfExists: true` — no overwrite).

- feat(governance): GLOBAL_INVARIANTS↔catalog coverage parity gate (INV-110)

  GLOBAL_INVARIANTS.md drifted to 53/107 invariant coverage with no guarding gate.
  Added the 13 missing always-active invariants (INV-27/28/29/33/72/95/97/98/99/100/101/107/108)
  and `scripts/check-global-invariants-parity.mjs` (L1) — forward (every alwaysActive
  invariant documented) + reverse (no phantom rows), mirroring the AGENTS.md↔catalog
  parity gate (CANON-08). Promoted to INV-110 (selfOnly governance) with AGENTS.md rows.
  The dual-ADR consolidation + CLI-ref gate from the same task are recorded for a
  careful follow-up in docs/audits/dual-adr-cli-followup-2026-06-02.md (the ADR store
  has 8 id collisions + orphaned decisions — too risky to rush).

- feat(governance): resilience patterns generator (#1176)

  Adds `src/generators/resilience.ts` — a stack-aware advisory generator for
  `backend-web-db` projects at L2+. Emits `docs/governance/RESILIENCE.md` with
  copy-pasteable defaults for circuit breaker, retry/backoff, rate limiter, and
  timeout budgets. TypeScript (cockatiel) and Java (Resilience4j) get concrete
  config blocks; `multi` emits both; Go/Python/Kotlin degrade gracefully. L3/L4
  governance level appends a hard-requirements enforcement addendum.

  - CANON-04: template render test
  - CANON-05: generator unit tests (happy path, idempotency, negatives, null-guard)
  - CANON-11: brownfield skipIfExists test
  - FEATURE_MATRIX: REQ-051 row, status Done
  - No new INV — advisory pattern, not machine-enforceable in arbiter self-gate

- feat(frontend): emit #352 stylelint design-token config + wire the lint:css gate

  `frontend-quality` now emits `.stylelintrc.json` (HARD design-token rules: `color-no-hex` → `var(--color-*)`, `length-zero-no-unit`, `custom-property-no-missing-var-function`) and injects the `stylelint` devDep, so the generated `lint:css` gate (which #1137 made gate-on-present) actually runs and resolves in CI for frontend-spa / frontend-lane targets. Core stylelint rules only — no `extends`/plugins — so it enforces design tokens without flooding a brownfield project with general-CSS findings.

  Refactor (DRY, dogfoods CANON-22): extracted a shared `injectDevDependency` helper (`src/utils/pkg.ts`) used by both the jscpd (duplication) and stylelint generators, replacing the per-tool inline inject functions so a second near-identical copy doesn't accrue.

- feat(#1082): INV-101 ff-only merge enforcement — ADR-052, branch-protection two-call split, cosign verify L2+ (PR 2/3)
- fix(#1119): wire collaborationMode end-to-end — solo/small-team ceremony

  **Problem (before this PR):**

  - `task.md.ejs` hardcoded `gh pr merge --squash` + full PR ceremony for ALL modes
  - `resolveDefaultMergeMode` / `resolveDefaultWorktreeMode` had zero callers
  - `buildRenderContext` (claude.ts) never injected resolved `mergeMode`/`branchingStrategy`
  - `configure --set collaborationMode=garbage` accepted any string (no enum validation)
  - No `--solo` CLI flag; wizard asked deprecated `soloDevMode` boolean, not a 3-way prompt
  - Five duplicated inline derivations of `collaborationMode` from `soloDevMode`

  **Changes:**

  - **Single derivation source:** `resolveCollaborationMode` + `resolveCollaborationAxes` added to
    `collaboration-mode-defaults.ts`; replaces 5 inline copies. The dead resolvers
    (`resolveDefaultMergeMode`, `resolveDefaultWorktreeMode`) are now called from here.
  - **`task.md.ejs` mode-aware:**
    - Phase 10 keyed on `mergeMode`: `direct` → no PR (commit+push to trunk);
      `pr-ff` → `gh pr create` + `gh pr merge --merge` (ff). **`--squash` removed** (ADR-051).
    - Phase 0 branch-guard: for `direct` mode, "HARD STOP on main" becomes a confirmation (trunk-solo
      allows working directly on trunk).
    - Review ceremony: `trunk-solo` → 1 self-review agent; `peer-review`/`gated-review` → tier counts.
  - **`CLAUDE.md.ejs`:** adds Quick Reference row showing collaboration mode, merge method, branching.
  - **`--solo` CLI flag** (`arbiter init --solo`): sets `collaborationMode='trunk-solo'`.
  - **Wizard 3-way prompt:** replaces the deprecated `soloDevMode` confirm with a
    `trunk-solo | peer-review | gated-review` list. `collaborationMode` persisted to config (not discarded).
  - **`configure` enum validation:** `collaborationMode`, `solo.mergeMode`, and `branchingStrategy`
    are now validated with `E_INVALID_ARCHETYPE` errors. `solo.mergeMode` and `branchingStrategy` added
    to `ALLOWED_PATHS`.
  - **`ArbiterConfigV2`** gains `solo?: { mergeMode: SoloMergeMode }` and `branchingStrategy?`.
    Both are round-tripped through init/configure/update.
  - **`diff.ts` PATH_TO_KEYS:** `collaborationMode` now triggers `claude` generator (task.md/CLAUDE.md
    regeneration on `arbiter update`); `solo.mergeMode` and `branchingStrategy` added.
  - **Design invariant (prevents idempotence bugs):** only `collaborationMode` + explicit user overrides
    (`solo.mergeMode`, `branchingStrategy`) are persisted; all derived values (mergeMode, worktreeMode,
    pipelineStyle) are recomputed at render time by `resolveCollaborationAxes`.
  - **Dogfood:** arbiter's own `arbiter.json` gets `solo: { mergeMode: 'pr-ff' }` so its trunk-solo
    self-config keeps the PR+ff workflow (branch protection requires PRs).

  **Blast radius:**

  - Template output changes for all projects on next `arbiter update` (squash→ff for PR modes; mode-gated
    review ceremony). Existing `task.md` files use `skipIfExists` and are NOT automatically rewritten —
    users can delete and re-init or run `arbiter update` after deleting the file.
  - `features.soloDevMode` is still WRITTEN (back-compat) but the wizard no longer asks for it directly;
    `collaborationMode` is now the authoritative field.

- feat(#729): industrial-grade meta-preset

  Adds `--preset industrial-grade` to `arbiter init` (and the programmatic
  `applyPreset` function). Applying the preset enables the full compliance +
  governance stack in one opt-in:

  - ISO 27001 / NIS2 / GDPR control-mapping (`enableIso27001Mapping/Nis2/Gdpr`)
  - Risk register + P×I assessment (`enableRiskRegister`)
  - Evidence harness (`enableEvidenceHarness`)
  - Operations handbook (`enableOperationsHandbook`)
  - MCP fallback determinism rule (`enableMcpFallback`)
  - Auth scaffold with `tenantIsolation: true` (provider stays `'none'`)
  - Observability scaffold with metrics + logs + alerts (provider stays `'none'`)

  Providers are left as `'none'` so no files are generated until the user
  explicitly picks one via `--auth-provider` / `--observability-provider`.

  Also fixes the pre-existing schema gap: `ArbiterConfigV2` now includes
  `observability?`, `auth?`, and `preset?` fields, enabling round-trip
  persistence of provider + preset config through `arbiter.json`.

  See `docs/PRODUCT/PRESETS.md` for usage examples.

- Add kit engineering phases B–D: Spring Modulith generator, brownfield wave-engine, 6-phase kit-install orchestrator, and tooling proposal lifecycle.

  New exports: `buildWavePlan`, `runKitInstall`, `buildToolingProposal`, `advanceProposalStatus`. New CLI command: `arbiter kit install`.

- feat(#1002)!: widen GovernanceLevel L1/L2/L3 → L1/L2/L3/L4; move evidence harness to L4-only

  **Breaking changes:**

  - `GovernanceLevel` widened from `'L1' | 'L2' | 'L3'` to `'L1' | 'L2' | 'L3' | 'L4'`
  - Evidence harness (`evidence-retention`, `evidence-backlog`) moved from L2+ to **L4-only**
  - STRIDE risk assessment moved from L3 to **L4-only**
  - TRACK_ROUTER generation moved from L3 to **L4-only**
  - Config `$schemaVersion` bumped 2→3 (forward-only migration applied automatically on next read)
  - `src/config/thresholds-l1-l2-l3.ts` renamed to `src/config/thresholds-by-level.ts` (CANON-20)
  - L3 now activates E2E + mutation testing only (no evidence/compliance artifacts)
  - SLSA `verifyOnSign` in release workflow now requires L4 (was L3)

  **New level summary:**

  | Level | Activates                                                        |
  | ----- | ---------------------------------------------------------------- |
  | L1    | lint + format + unit tests                                       |
  | L2    | + coverage + integration + debt gates + security scan            |
  | L3    | + E2E + mutation testing                                         |
  | L4    | + evidence harness + STRIDE risk + TRACK_ROUTER + SLSA-L3 attest |

  **Migration guidance:**

  - Existing L2 projects: unchanged except evidence harness no longer regenerates (was a misconfiguration)
  - Existing L3 projects: unchanged for quality gates; evidence artifacts move to L4 — if you relied on evidence, run `arbiter upgrade-level --to L4`
  - All projects: `$schemaVersion` migration is automatic on next `arbiter update` run

- feat(claude): MCP fallback rule + cross-language skip-test hook (#721 #730)
- F4+F11: `--github` opt-in default and project board namespacing.

  - `--github` flag is now required for live GitHub API calls (`arbiter init`, `arbiter update`). Without it, no API calls are made regardless of stored config.
  - `ARBITER_GITHUB=1` env var activates GitHub API calls in CI.
  - Stored config key `useGitHub` renamed to `permitGitHub`; old key auto-migrated on first run.
  - Project board titles now include project name: `<name> Board · <owner>/<repo> · <date>`.
  - Idempotent board detection updated to match namespaced titles.

- feat(operations): operations handbook generator (#717) — opt-in `enableOperationsHandbook` flag emits `docs/OPERATIONS_HANDBOOK.md` with 4-signal observability, RC checklist, on-call protocol, and runbook templates; archetype-aware (backend-web-db/data-pipeline add DB signals, frontend-spa adds Core Web Vitals)
- feat(#725 #726): observability + auth provider abstraction generators

  Adds two opt-in generators that emit provider-specific setup docs:

  - `generateObservability`: emits `docs/OBSERVABILITY.md` when `observability.provider`
    is set and not `'none'`. Supports 9 providers: stdout-minimal, signoz, openobserve,
    victoria-vector-quickwit, prom-grafana-loki-jaeger, saas-sentry, saas-datadog,
    saas-axiom, saas-betterstack.
  - `generateAuth`: emits `docs/AUTH_SETUP.md` when `auth.provider` is set and not
    `'none'`. Supports 10 providers: app-level-ts, authelia, authentik, ory-stack,
    zitadel, keycloak, saas-clerk, saas-auth0, saas-supabase-auth, saas-cognito.

  Both generators use `skipIfExists` so user customisations are never overwritten.
  Registry entries, diff PATH_TO_KEYS, and type definitions included.

- feat(w1-bundle): r1.k7+k6 — config $schemaVersion + plugin API stability gate (#605 #603)

  - `arbiter.json` gains an optional `$schemaVersion: <int>` field. Migration writes `$schemaVersion: 2` on every v2 output; load rejects `$schemaVersion > CURRENT_CONFIG_SCHEMA_VERSION` as a hard error so a future config never silently loads.
  - New `docs/PLUGIN-API.md` enumerates `ArbiterPlugin` / `PluginContext` / `PluginFile` / `PluginResult` field-by-field with stability markers (stable / beta / experimental) plus the apiVersion bump policy.
  - New L1 gate `scripts/check-plugin-api-stability.mjs` fails any PR that edits `src/types/plugin.ts` without bumping `apiVersion` in the same commit.

- feat(w1-bundle): r1.k9+l9 — state file schema version + checksum + repair (#607 #619)

  - `.arbiter-generated.json` is now a versioned envelope `{ ".checksum", "$schemaVersion": 1, "config": {...} }` with a SHA-256 of the canonical inner payload.
  - `loadSnapshot` throws `SnapshotChecksumError` on tamper instead of silently overwriting.
  - v0 (pre-envelope) snapshots auto-migrate on first read — no user action required.
  - `saveConfigAndSnapshot` rotates the previous snapshot to `.arbiter-generated.json.bak.<iso-ts>`, capped at the 10 most recent backups.
  - New `arbiter doctor --repair-state` re-derives the snapshot from `arbiter.json` (never touches the source config).
  - Storage migrations live under `src/state/migrations/`, paralleling `src/config/migrations/`.

- docs(#651): case study — arbiter governs arbiter (R1.O1)

  New `docs/case-studies/arbiter-itself.md` documents the recursive use of
  arbiter on its own repo: governance level (L2 + soloDevMode), invariants
  that have actually fired during development, meta-config layout, public
  evidence trail, and the recursion limits (no telemetry, no external review
  service, no skip-gate).

- feat(#660): npm dist-tag channel strategy — latest / beta / canary (R1.Q1)

  - `docs/CHANNELS.md` documents three channels (stable / beta / canary), install commands, tag shapes, and rollback procedure.
  - `.github/workflows/npm-publish.yml` resolves the npm dist-tag from the tag shape.
  - New `.github/workflows/canary-publish.yml` publishes `v0.0.0-canary.<short-sha>` on every push to `main`.

- docs(#663): channel switching policy + rollback path (R1.Q4)

  Extends `docs/CHANNELS.md` with per-direction risk table (latest ↔ beta ↔ canary) and the rollback recipe leveraging the R1.K9/L9 building blocks (`.arbiter-generated.json.bak.<ts>` + `arbiter doctor --repair-state` + git history of `arbiter.json`). Documents which downgrades the framework will refuse and why.

- feat(w1-bundle): R1.S6+S7 — context-rot 3-layer recovery + N-pass plan reviewer gate (#694 #695)

  - `arbiter task recover` prints 3-layer recovery context (BACKLOG.md, CHECKPOINT commits, recent git log)
  - `pre-compact` hook injects BACKLOG.md content into preserved-state output
  - `dispatchPlanReview` runs `TIER_PASS_COUNT[tier]` invocations per cycle with per-pass evidence under `.arbiter/evidence/plan-review/<sanitized-id>/run-<ts>/`
  - `arbiter task advance --to implementation` blocks when `.arbiter/plan-review.enabled` is present and no PASS evidence (with matching plan SHA-256 digest) exists
  - `--skip-plan-review` flag + audited env bypass with CI-mode refusal of env-only bypass

- feat(governance): risk register + P×I assessment template (#712) — opt-in `enableRiskRegister` flag emits `docs/GOVERNANCE/RISK_REGISTER.md` and `docs/GOVERNANCE/RISK_ASSESSMENT_TEMPLATE.md`; ISO 27001:2022 §6.1.2 aligned; archetype-aware pre-populated risks
- Add StackAdapter interface + registry + language adapters + INV-88 (#881). Introduces a formal `StackAdapter` extension point for language-specific generation behaviour. TypeScript ships as a full adapter; Java, Python, Go, and Rust ship as stubs. `check-adapter-coverage.mjs` enforces INV-88 at L1. `arbiter doctor health` reports adapter coverage per project.
- feat(testing): 25-dimension test taxonomy extension (#719) — opt-in `enableTaxonomy25d` flag generates compliance-grade taxonomy with audit trail, PII masking, rate limiting, session lifecycle, event delivery, graceful degradation, SLA assertion, and OWASP security surface dimensions
- docs(#1099): Wave 2 — docs/ADR/ as canonical ADR SSOT + RUNBOOKS casing collapse

  Track A: git mv docs/RUNBOOKS/ → docs/runbooks/ (case collision), update docs-backfill-tags.mjs, regenerate INDEX.md.

  Track B: promote docs/ADR/ to canonical ADR SSOT (freeze docs/SYSTEM/DECISIONS.md as legacy); migrate DECISIONS-only ADR-054..072 into per-file docs; assign ADR-073 (FE Governance Generator, was accidental ADR-055 duplicate) and ADR-074 (Risk register, was accidental ADR-050 duplicate); fix docs/ADR/041-044 mis-titled frontmatter (were ADR-001..004, now ADR-041..044); populate canonical_id in all 74 ADR files; rewrite src/graph/builders/adr.ts to parse per-file YAML frontmatter instead of DECISIONS.md section-headings; regenerate docs/ADR/README.md via new generator; add scripts/check-adr-index.mjs gate (INV-97) to enforce unique numbers, canonical_id match, and README coverage at L1.

### Fixed

- Batch A consolidation: promote FEATURE_MATRIX rows to Verified; hygiene.

  - REQ-028 + REQ-041 promoted to Verified (honest evidence chain — no new code)
  - REQ-026 Kotlin note updated: smoke-test-only exposed; follow-up #1177 filed
  - TDD evidence for #1148/#1149 committed
  - SELF-KIT-AUDIT baseline regenerated (N10 + N70 dim updates)
  - Completed wave0/wave0.5/wave1 audit dirs removed from working tree (git history intact)
  - MILESTONES.md + DONE.md SSOT links neutralized; DEC-014 recorded

- chore(#1131): add DISABLE_LABEL_SYNC opt-out + prune live duplicate labels (slice 3)

  `_label-sync` now skips when the `DISABLE_LABEL_SYNC` repo variable is `'true'`, so a repo that manages its own label taxonomy (the framework source repo) does not get `.github/labels.yml` additively injected into its live label set. arbiter-self sets the variable.

  Also documents the two-taxonomy model (canonical shipped set vs arbiter-self's legacy namespaced labels) in `docs/GOVERNANCE/LABELS.md`; live duplicate-label pruning and the optional shape convergence are tracked in #1134.

- chore(ci): prune no-consumer labels, define applied-but-undefined labels, fix trunk-solo nightly double-emit (#1131)

  Slice 1 of the label + workflow hygiene wave:

  - Generator: trunk-solo (incl. the `enableSoloDevMode` alias) at L3/L4 no longer emits both `06-nightly.yml` and `06-nightly-lite.yml`; it gets the lite nightly only (and not the full nightly/weekly/monthly suite), via `resolveCollaborationMode()` at both emit guards. Same root-cause fix also resolves the mode for the CI-gap guards (codeql/frontend-quality/OSSF), which previously read the raw (often undefined) `collaborationMode` and silently suppressed `15-codeql.yml` for default-resolved peer-review configs.
  - Labels (dual-track `labels.yml.ejs` + `.github/labels.yml`): removed 10 no-consumer labels (`wave-0..3`, `quality-wave`, `approved`, `size: L`, `size: XL`, `ready-for-review`, `ai-generated`); added 5 applied-but-undefined labels (`in-progress` promoted to ALWAYS, `in-review`, `stale`, `no-stale`, `governance`).
  - Docs: new `docs/GOVERNANCE/LABELS.md` catalogue — every surviving label cites its consumer — linked from the governance index.

- docs(#627): add 6 missing hook rows to .claude/CLAUDE.md hooks table (CANON-10)
- feat(#613): atomic writes + SIGTERM/SIGINT cleanup for in-flight temp files
- fix(#772): replace sequential saveConfig+saveSnapshot with saveConfigAndSnapshot — serializes once before any write, preventing inconsistent state on ENOSPC
- fix(#773): route writeTaskStatus through atomicWrite — tmp file now registered in inFlightTmpPaths for SIGTERM cleanup
- Fix batch #678-#684 #628: WriteResult action values, loadConfig error handling, UserFacingError CLI output, selfOnly invariant filter, alwaysActive semantics, shared readFileSafe helper, composite framework archetype detection
- fix(quality): CANON-22 red-team polish — gate-on-present lint:css, fail-closed duplication ratchet, ADR-076

  Closes the non-blocking findings from #1136's red-team review:

  - **Generated `check-all` `lint:css`** now runs only when a `.stylelintrc` config is present, so frontend targets don't FAIL CI on a stylelint config that no generator emits yet (emitting the #352 design-token config is a tracked follow-up). Matches the sibling `fsd-boundaries` gate-on-present pattern.
  - **Debt-ratchet duplication collector is fail-closed:** jscpd writes no report at 0 clones, so report-absence alone can't mean "clean". The collector now records 0% only on a clean (exit 0) run with no report, parses the report when present, and **omits** the metric (ratchet skips, not a false 0%) when jscpd fails — so a crashed run can no longer silently mask duplication. Dual-sided (`scripts/debt-lib.mjs` + template).
  - **Added ADR-076** recording the CANON-22 evidence-tiering + gate-un-blinding decision (`docs/SYSTEM/DECISIONS.md` is frozen; new ADRs live in `docs/ADR/`).

  Two flagged items were intentionally not changed (rationale in the plan): the `src/adapters/index.ts` knip `entry` is already honestly recorded in the burn-down audit (demoting it nets more findings, not fewer), and `coverage.ts` emitting `vitest.config.ts` for `multi` is legitimate — that config is consumed by test execution, unlike the gate-only `.jscpd.json`.

- fix(governance): collapse dual ADR store + CLI-ref single-source gate (INV-111)

  Three-part governance hardening completing the deferred items from PR #1143:

  **1. ADR dual-store collapse (Items 1+2)**

  - Extracted 11 orphaned formal ADRs (ADR-077..087) from `docs/SYSTEM/DECISIONS.md`
    — decisions that existed only in the legacy log with colliding IDs:
    - ADR-077: Agent Registry Introduction (was ADR-053 in DECISIONS)
    - ADR-078: ISO 27001/NIS2/GDPR Compliance Gate Mapping (was ADR-052)
    - ADR-079: Red-Team SSOT Alignment Checks (was ADR-051)
    - ADR-080: Operations Handbook Generator (was ADR-049)
    - ADR-081: 25-Dimension Test Taxonomy Extension (was ADR-048)
    - ADR-082: MCP Fallback Determinism + Skip-Test Guard (was ADR-046)
    - ADR-083: Matrix Downgrade-vs-Fix Verdict (was ADR-043)
    - ADR-084: User-Toggle Catalog Preconditions (was ADR-044)
    - ADR-085: Evidence Prune + Red-Team SSOT Alignment Vectors (was ADR-047)
    - ADR-086: Four-Pillar SSOT Infrastructure (was mislabeled ADR-042 sub-entry)
    - ADR-087: Rust INV-04 Checkers + Rebased Docs-Check (was second ADR-042)
  - Reduced `docs/SYSTEM/DECISIONS.md` to a **generated digest** (87-row ADR index,
    idempotent). Extended `scripts/gen-adr-readme.mjs` to emit both `docs/ADR/README.md`
    and `docs/SYSTEM/DECISIONS.md` from the same per-file SSOT parse.
  - Wired `gen-adr-readme.mjs --check` into the L1 gate so digest can't drift.
  - `check-adr-index.mjs` (INV-107) confirms: 87 ADR files, all IDs consistent, no dups.

  **2. CLI-ref single-source gate (Item 4, INV-111)**

  - Added `scripts/gen-cli-ref.mjs`: regex-parse `.command()` tree from `src/cli.ts`
    (no build step), emit a marker-delimited generated region into `website/reference/cli.md`.
    Bidirectional `--check`: registered ↔ documented, no phantom, no missing.
  - 28 top-level commands now documented; 4 previously phantom command references
    (governance/use/state/version) confirmed not to exist (they were prose-only mentions).
  - Wired as `cli ref parity (INV-111)` L1 gate.
  - New invariant INV-111 registered in catalog, AGENTS.md, and GLOBAL_INVARIANTS.md.

  **3. Item 3 (GLOBAL_INVARIANTS parity) — already done in #1143**

  INV-110 + `scripts/check-global-invariants-parity.mjs` shipped in PR #1143 (commit
  e73cdee0). Confirmed: 51 always-active invariants in parity, gate wired L1, passing.
  Not rebuilt; stated explicitly to avoid silent scope drop.

  Per-decision map (zero-loss proof): every heading in the old DECISIONS.md was assigned
  (a) stale dup → drop (decision also in docs/ADR/) or (b) orphan → extracted to 077+
  or (c) non-ADR commit-log entry → preserved in git history (not formal ADR).
  Before: 76 ADR files. After: 87 ADR files. Zero decisions lost.

- refactor(#1131): consolidate setup-node + npm ci into the setup-node-pnpm composite (#1131 slice 2)

  Eliminates the duplicated `actions/setup-node + npm ci` boilerplate across CI workflows by extending the (previously dead, 0-caller) `setup-node-pnpm` composite action to bundle setup-node + `npm ci` (opt-out via the `install` input) and pinning a single canonical setup-node SHA.

  - **Composite (both tracks):** `setup-node-pnpm/action.yml(.ejs)` now runs `npm ci` (gated on `install`, `shell: bash`) and pins `actions/setup-node@…v6.4.0` (was a dead v4.3.0). Emit-wiring unchanged (already emitted by the CI-tier generator). The legacy `-pnpm` dir name is retained (renaming would orphan the dir in already-generated repos); the action's `name:` is corrected.
  - **Rewired** every `setup-node + npm ci` pair to `uses: ./.github/actions/setup-node-pnpm` across 01-pr-fast, 02-pr-extended, 05-release, 06-nightly, 06-nightly-lite, 07-weekly, 08-monthly, 12-mutation-scheduled, 14-license-scan, 15-codeql, drift-shadow. Parity-gated workflows are regenerated from their templates; 05-release is hand-edited (both tracks). Node-only/bare jobs (PII scan, change-classify, action-pin audit) and the publish-package job (needs `registry-url`) keep their inline setup-node.
  - **SHA consolidation:** 3 distinct setup-node pins → 1 (v6.4.0). This bumps the per-PR hot path (01/02) v4→v6.4.0 (node 22 compatible). The composite pin sits outside `sync-action-pins`/INV-76, so a new render test (`setup-node-pnpm-render.test.ts`) asserts the canonical SHA; a new `01-pr-fast-render.test.ts` covers the most-rewired workflow.

- Expand package `files` to include `README.md`, `LICENSE`, `NOTICE`, `CHANGELOG.md`, and `THIRD_PARTY_LICENSES.md`. Convert `exports["."]` to conditional form with `types` and `import` fields. Add `prepack` script and pack-size budget tooling.
- docs(wave1): Obsidian-friendly doc index + zero-risk deletes

  - Enrich `docs/INDEX.md` generator: grouped by top-level directory,
    real markdown links (Obsidian-clickable + graph-wired, GitHub/VitePress-portable),
    `status` and `kind/*` tag per entry, `canonical_id` column retained.
  - Export `collectDocs()` and `buildIndex()` from `scripts/gen-doc-index.mjs`
    for testability; add first unit test suite (15 tests, RED→GREEN).
  - Switch generator from `import.meta.url` root to `process.cwd()` (consistent
    with other gate scripts; enables temp-dir CLI testing).
  - Parse `tags: [...]` frontmatter arrays into `string[]` (was raw string).
  - Delete three stale/wrong-stack docs: `docs/SYSTEM/CI-SMOKE.md` (stray
    timestamp), `docs/security/STRIDE.md` (empty casing-dup of
    `docs/SECURITY/STRIDE.md`), `docs/COMMANDS.md` (gradle/Java dogfood artifact).
  - Add `*.bak.*` to `.gitignore` (anti-recurrence for timestamped generated backups).

- feat(worktree): harvest parent-state guardrails (#733) — prevent worktree harvest when parent branch has uncommitted changes or is ahead of remote

## [0.1.0] — 2026-05-15

### Added

- Initial public release of arbiter AI-governance framework
- `arbiter init` CLI command to scaffold governance into target projects
- Cross-language compatibility matrix (TypeScript, Python, Rust, Java, Go)
- L1/L2/L3 gate tiers with `check-all.mjs` generation
- Claude Code hook generation (pre-edit, post-edit, UserPromptSubmit, PreCompact)
- Changeset-based changelog workflow (this file)
- `.changeset/` configuration for future version management
- CI `changeset-check` workflow enforcing changeset presence on user-facing PRs
- CI `release` workflow consuming changesets to bump version and tag

[0.1.0]: https://github.com/LucaDominici/arbiter/releases/tag/v0.1.0
