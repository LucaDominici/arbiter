---
title: 'arbiter — AGENTS.md'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/governance']
related: []
---

# arbiter — AGENTS.md

> **Canonical governance for AI coding agents.**
> All tools read this file. Tool-specific extensions: `.claude/CLAUDE.md`, `.agents/CODEX.md`
>
> Standard: [AGENTS.md — AAIF / Linux Foundation](https://agents.md/)

---

## Project

| Fact      | Value                                                  |
| --------- | ------------------------------------------------------ |
| **What**  | arbiter project                                        |
| **Stack** | typescript                                             |
| **Build** | `npm run build`                                        |
| **Test**  | `npm run test`                                         |
| **Gate**  | `node scripts/check-all.mjs` (mandatory before commit) |

---

## Authority Hierarchy

When documents conflict, higher level wins. No debate.

```
Level 1:  AGENTS.md — invariants + governance (this file)
Level 2:  ADRs (docs/internal/ADR/) — architectural decisions
Level 3:  docs/internal/SYSTEM/CANON.md — process constraints
Level 4:  Active task plan (.claude/plans/*.md) — task-level guidance
Level 5:  AI judgment — last resort
```

> Use `.claude/skills/ssot-navigation/SKILL.md` to navigate this hierarchy and locate the right document for any task.

---

## Iron Laws

Behavioral protocol rules that sit above the invariant catalog — process discipline.
Each law is stated once, with its rationale and (where one exists) the mechanism that
backs it; a law whose mechanism is listed is not prose-only, and treating it as
negotiable trips that mechanism. Violation protocol: **STOP → REFUSE → cite the law**.

### Worktree Isolation Is Mandatory For Parallel Agents

Concurrent agents must each work in an isolated git worktree. Shared-tree parallel
editing — two or more agents writing into the same working tree at once — is
prohibited: git index state, lockfiles, and in-flight diffs corrupt under
concurrent writers, with no clean recovery path. One agent, one worktree, one
branch.
_Backed by:_ `pre-spawn-worktree-guard.mjs` (hard grading enabled repo-wide via
`ARBITER_SPAWN_GUARD_HARD=1` in `.claude/settings.json` `env`).

### Complete Means Merged To Main

No task, PR, or issue may be reported complete before its PR is merged green on
`main`. Open is not done. A PR is owned until merged: follow it through CI and fix
each red by root cause (read the failing job's log, fix the underlying cause,
push, re-verify), repeated until every check passes and it merges. Handing back or
abandoning a red PR, or reporting a task complete while its PR is still open, is a
process violation.
_Backed by:_ `stop-evidence-guard.mjs` (INV-114 correlated evidence) and
`guard-done-evidence.mjs` (#1872, active via `features.evidenceHarness: true`).

### Root-Cause-First After Any Failure

On an error, stop the patch-spiral. Do not attempt a second fix before performing
structural analysis: read the actual failure, trace it to its origin, and only
then apply the fix that addresses the root cause. A patch applied without
diagnosis is a guess, not a fix, and tends to compound rather than resolve.

### Verification-Before-Victory

Run targeted local verification — an end-to-end exercise of the changed behavior,
not just a green typecheck or unit-test run — before every push. This is the
dominant agent failure mode: of observed real agent errors, the majority (5 of 8)
were claims of success without the change ever having been exercised. Review
layers fail to prevent this; only verification does.

### Model-Pyramid: 90/10 Guidance (Not Machinery)

Rule of thumb, validated empirically on real projects (#1817 gold-rebaseline handoff,
pattern A8): roughly 90% of implementation work belongs on a cheap, fast model executing
a plan someone already worked out; the remaining 10% — root-cause analysis, architecture
decisions, plan review — is where an expensive model earns its cost. If the expensive
model spends its turn executing rather than judging, the plan handed to it was the
actual defect, not the model tier. This is guidance for human or orchestrator judgment
about model selection, not a runtime feature: arbiter does not measure, select, or gate
on model tier at any pipeline stage — the tier-assignment machinery this replaces stays
deprecated, not reintroduced.

The guidance is applied statically, not at runtime: sub-agents pin their tier in
frontmatter (`model:` in `.claude/agents/*.md` — Haiku for mechanical scans, Sonnet for
structured review passes, `inherit` where an adversarial judgment is the deliverable), and
the orchestration commands (`/ship`, `/drain`) carry per-phase dispatch guidance. The
frontmatter is the SSOT; `.claude/AGENT_REGISTRY.md` mirrors it.

---

## Invariants

Violation protocol: **STOP → REFUSE → cite INV-XX**.

### Tier 1: Architectural Integrity

- **INV-01:** No circular dependencies between modules
- **INV-02:** Public API surface must be intentional — no accidental exports
- **INV-03:** Architecture boundary enforcement
- **INV-04:** Language-specific type safety
- **INV-05:** Complexity limits enforced
- **INV-06:** No unused or dead code
- **INV-46:** Anti-bloat enforcement — Survey gate + duplication detector + LOC ratchet

### Tier 2: Data Integrity

- **INV-07:** Schema changes via versioned migrations only — no manual DDL
- **INV-08:** Input validation at system boundaries
- **INV-09:** Audit trail for mutable entities
- **INV-10:** Soft delete preferred over hard delete
- **INV-33:** L4 merges require valid evidence with obs_gate == PASS
- **INV-34:** Integration tests must use real database (L2+)

### Tier 3: Security & Compliance

- **INV-11:** No secrets in source code
- **INV-12:** No PII in code, tests, or logs
- **INV-13:** Dependencies scanned for known vulnerabilities
- **INV-14:** No dynamic code execution with untrusted input
- **INV-15:** Authentication required at every entry point

### Tier 4: Operational Excellence

- **INV-16:** Structured logging only — no raw print statements in production
- **INV-17:** Explicit error handling — panics and unhandled errors are forbidden
- **INV-18:** No hardcoded environment values
- **INV-19:** Resilient external calls — circuit breaker or retry required
- **INV-20:** Health and readiness endpoints required for deployed services
- **INV-35:** Contract testing enforced when contractType is active
- **INV-40:** BDD scenarios with @ignore tag are HARD-fail
- **INV-41:** Message-queue contract tests must call Schema Registry testCompatibility
- **INV-42:** Pact broker glue must be env-gated; no silent runs against default URL
- **INV-43:** OpenAPI exporter must run before diff; missing reference is HARD-fail
- **INV-44:** SpotBugs security-category bugs MUST NEVER be suppressed or baselined

### Tier 5: Governance

- **INV-21:** Every TODO comment must reference a task ID: `TODO(#NNN)`
- **INV-22:** Branch naming: `task/#NNN-description`
- **INV-23:** No direct commits to `main` — all changes via task branches + PR
- **INV-24:** Gate must pass before commit: `node scripts/check-all.mjs L1`
- **INV-25:** Gate must pass before push: `node scripts/check-all.mjs L2`
- **INV-26:** TDD mandatory — test first, then implement
- **INV-27:** Evidence artifacts must be generated for all gate runs
- **INV-28:** SSOT documents must not contradict — run drift check before merge
- **INV-29:** No MockMvc — use RestAssured for integration tests (Java)
- **INV-30:** Mutation testing required — PIT/pitest (Java, L2+)
- **INV-31:** Suppressions must have mandatory expiry
- **INV-32:** Every 'proven' language must have a nightly real-project fixture
- **INV-36:** Hook hardness manifest — every hook must declare intent; HARD hooks must empirically block
- **INV-37:** Generated githooks
- **INV-38:** Phase-tracked lifecycle enforcement
- **INV-39:** Hook templates require empirical fire-tests
- **INV-45:** Self-dogfood check — every EJS template must render to match its materialized self-repo file
- **INV-47:** Matrix proven cell requires a gate invocation in check-all.mjs.ejs
- **INV-48:** EJS template render-test coverage must not regress
  - _Enforcement:_ `scripts/check-template-tests.mjs` (L1; sibling `scripts/check-brownfield-tests.mjs` for CANON-11 generator brownfield coverage). Both report the gap with its denominator (`183/580 (32%)`, `54/89 (61%)`), not a bare integer, and both fail in BOTH directions: above the baseline is a regression, below it is an unbanked improvement that must be committed via `--update-baseline` — otherwise the recovered slots stay free for silent re-widening (#2013).
- **INV-49:** Every generator in src/generators/ must have a unit test
- **INV-50:** Every command in src/commands/ must have a test
- **INV-51:** Every catalog invariant must appear in AGENTS.md §Invariants
- **INV-52:** Catalog enforcement script citations must be wired in check-all.mjs
- **INV-53:** Exit-code universal contract — every Arbiter-emitted script exits 0=PASS / 1=FAIL / 2=ERROR
- **INV-54:** SSOT core set integrity — all listed files must exist
- **INV-55:** Doc-links integrity — all markdown links must resolve
- **INV-57:** Canonical-paths integrity — all redirect targets must exist
- **INV-58:** Node version SSOT — .nvmrc is canonical; all CI jobs use node-version-file
- **INV-59:** Gate result parity — local L1 static gates must produce the same pass/fail pattern as CI
- **INV-60:** Release binary size capped at archetype default
- **INV-61:** a11y critical violations are HARD-fail at L2
- **INV-72:** File-lock semantics — process-bound exclusive lock with bootId + pid + cmd

## Optional — Extended Invariants (opt-in, INV-62..INV-71)

Enable via `arbiter.json` → `governance.invariants_catalog: 'extended'`.

- **INV-62:** Frontend state separation — async (server) and sync (UI) state in distinct stores
- **INV-63:** SSOT atomic update — code and SSOT documentation land in the same commit
- **INV-64:** No magic code — non-trivial idioms documented in a pattern catalog
- **INV-65:** Platform abstraction — env-specific APIs accessed only via adapter
- **INV-66:** Process self-documentation — docs/METHOD/ is canonical for process rules
- **INV-67:** No internal mocking in E2E — backend endpoints are exercised against the real service
- **INV-68:** MCP-first forensic inspection — debug via MCP tools before raw shell
- **INV-69:** Design rationale traceability — new abstractions cite their motivating ADR
- **INV-70:** Reuse before new — canonical registry search precedes creating a new module
  - _Enforcement:_ code review — this invariant has no hard gate. Its only mechanical proxy, `scripts/check-reuse-survey.mjs`, is **ADVISORY** (`runWarnCheck`, promoteBy 2026-10-14 in `scripts/data/advisory-ledger.json`; the hard flip is #2044 item c) and cannot fail a build (#2419).
- **INV-71:** Track D task completion — docs-only changes follow the documented completion rules

## GitHub CI Tier Invariants (INV-73..INV-82, INV-136)

Applies when `useGitHub: true`. Generated gate scripts enforce these at L1/L2.

- **INV-73:** CI tier presence — all 8 workflow files must exist under .github/workflows/
- **INV-74:** Anti-bot human-approval gate — reviewer must be a human distinct from the PR author
- **INV-75:** Heartbeat watchdog — T4 nightly ≤26 h, T5 weekly ≤8 d, T5b monthly ≤35 d
- **INV-76:** SHA-pinned actions only — all third-party GitHub Actions must be pinned to a full 40-char SHA
- **INV-77:** Top-level workflow permissions — every workflow file must declare explicit top-level permissions
- **INV-78:** SLSA provenance present at T3 — release workflow must emit signed build provenance
- **INV-79:** Cosign sign-blob present for every release artifact
- **INV-80:** No continue-on-error on test or build steps — failures must propagate immediately
- **INV-81:** Tier-hash local↔CI parity — check-all.mjs subcommand hashes must match CI workflow steps
- **INV-82:** Monthly (T5b) workflow present + heartbeat asserts ≤32d freshness
- **INV-136:** Tier-assignment rule — a check lives at the fastest tier where its red changes the developer's immediate next action
  - _Enforcement:_ `src/generators/ci-five-lane.ts`, opt-in via `enableFiveLaneCi` and mutually exclusive with the standard `github`/`ci-tier` generators above (see `src/generators/registry.ts`). Emits the collapsed 5-lane shape validated on a real project (10 workflows collapsed to 5, one nightly red left standing for 3 weeks, 20 auto-filed issues left unread): pre-commit (<10s, local via githooks, no workflow file) / PR-blocking (`ci.yml`, ≤15min) / nightly (`nightly.yml`, ≤45min) / weekly (`weekly.yml`, unbounded) / release-seal (`release.yml`, on tag push). Each generated workflow states its own tier and time budget in a header comment. Templates: `src/templates/github/workflows/five-lane/{ci,nightly,weekly,release}.yml.ejs`. AC: `arbiter init` with `enableFiveLaneCi: true` emits exactly 4 workflow files, each carrying its tier budget in a header comment. Verified by `__tests__/generators/ci-five-lane.test.ts`, `__tests__/generators/registry.test.ts` (mutual exclusivity), and `__tests__/templates/ci-five-lane-render.test.ts` (red→green). Activation (#1835 Task B): interactive wizard prompt (GitHub-backend projects only, step 14.5, default No) or the `enableFiveLaneCi` recipe field (`--recipe`); round-tripped through `arbiter.json` `features.fiveLaneCi` so `arbiter update` preserves it.
  - **#1817 (A6) sticky failure issue:** the scheduled lanes (`nightly.yml`/`weekly.yml`) avoid filing a fresh issue per red run; instead both source one shared script, `<project>/.github/scripts/sticky-failure-issue.sh` (rendered from `src/templates/github/scripts/sticky-failure-issue.sh.ejs`), invoked as `record <lane>` on failure and `close <lane>` on success. `record` finds-or-creates a single open issue titled `chore(<lane>): pipeline red` and appends a comment carrying the run link plus an incremented failure counter; `close` closes that issue with a green run-link comment. Proven end to end against a mocked `gh` CLI in `__tests__/templates/sticky-failure-issue-script.test.ts`: two consecutive recorded failures yield one open issue carrying two `Run:`-prefixed comments (not two issues), a third failure appends a third entry to that same issue, and a `close` invocation closes it.

## Kit Source Leakage (INV-85)

- **INV-85:** No kit source leakage — committed kit files must not contain employer-specific tokens
- **INV-86:** Kit catalog parity
  - Enforced by `scripts/check-kit-catalog-parity.mjs` (L1 gate)
  - Architecture: see `docs/internal/ADR/045-kit-taxonomy.md` (ADR-045)

## Local-Wrapper Parity (INV-87)

- **INV-87:** Local-wrapper ↔ CI parity façade
  - _Enforcement:_ `scripts/check-local-ci-parity.mjs` — static Makefile↔workflow check at L1 (`PARITY_STATIC_CHECK_ONLY=1`), full static + runtime `parityContentHash` check at L2

## Anti-Drift Validator Family (INV-89)

- **INV-89:** Anti-drift validator family — W6+F4 validators must be present and wired
  - _Enforcement:_ 13 scripts dual-track — wired both in arbiter L1 gate AND emitted for target projects (`check-suppression-rationale.mjs`, `check-suppression-expiry.mjs`, `check-secret-scan.mjs`, `check-drift.mjs`, `check-workflow-runners.mjs`, `check-workflow-docs-sync.mjs`, `check-workflow-test-integrity.mjs`, `check-secret-presence.mjs` (#1497), `check-continue-on-error.mjs` (#1497), `check-test-scope-tier.mjs` (#1497), `check-pr-size-gate.mjs`, `check-claude-md-lint.mjs` (#1266), `check-unwired-guards.mjs` (#2159)); 3 scripts Track-B-only (emitted for target projects only, not wired in arbiter self-gate): `check-workflow-sha-pinning.mjs`, `check-workflow-job-naming.mjs`, `check-min-test-execution.mjs` (#1497); plus the F4 batch — `check-validator-helptext.mjs` (always emitted) and the conditional fallbacks emitted only when their dedicated owner generator is disabled: the github trio `check-action-pins.mjs`/`check-workflow-perms.mjs`/`check-ci-tiers.mjs` (emitted when github-setup is off — L1 or github-off) and `check-exit-code-contract.mjs` + `check-pipe-tee-hazard.mjs` (emitted when self-validation is off — #1835). Per-target total via `src/generators/anti-drift-validators.ts`: 17 for a github-enabled L2/L3 target, 20 at L1 or github-off, 22 at L1/github-off + self-validation-off. Diffed against the generator emit arrays by the #1674 prose-parity self-gate (`__tests__/generators/anti-drift-validators.test.ts`).

## Evidence Bundle Schema Compliance (INV-90)

- **INV-90:** Evidence bundle schema compliance
  - _Enforcement:_ `scripts/check-evidence-bundle.mjs`
  - Every task evidence bundle in `.evidence/task-NNN/` must conform to `schemas/evidence-bundle.schema.json`. Exit 0 when no bundles are present.
  - **Author provenance (#2164):** bundles may carry an optional `provenance` block (`model_id`, `agent_harness`, `harness_version`, `gate_manifest_hash`, `session_id`, `config_hashes: {agents_md, claude_md, skills[]}`) recording _what produced_ the bundle — model/harness/config/gate snapshot/session — so a gate regression can be traced back to a code change vs. an agent/prompt/model change.
  - Every provenance field is an opaque id or a sha256 hex digest, not raw file content or transcript text.
  - Fields with no genuinely observable source (e.g. `model_id`, since no env var carries a literal model id in this harness) stay omitted rather than guessed; `provenance_note` may explain the omission.
  - If `provenance` is present but fails schema validation, the gate exits **2** (dominant — wins over exit 1 even when non-provenance violations are also present in the run); absence is a pass.
  - `src/evidence/provenance.ts` (`buildProvenance`/`validateProvenance`/`formatProvenance`) is the shared TS module backing both this bundle path and the `.evidence/SUMMARY.json` path (`src/evidence/summary.ts`, `arbiter verify evidence`) — the JSON Schema stays the enforced source of truth for the bundle gate itself.

## AI-PR Gate (INV-91)

- **INV-91:** AI-PR human-approval gate
  - Bot-authored PRs require the `approved-by-human` label before merge
  - _Enforcement:_ generated `_ai-draft-check.yml` workflow + `_label-on-approve.yml` workflow

## Nightly Freshness Gate (INV-93)

- **INV-93:** Nightly freshness gate
  - _Enforcement:_ `scripts/check-nightly-freshness.mjs`
  - The nightly CI stamp artifact (`.arbiter/nightly/last-run.json`) must not be older than 26 hours when present. Exit 0 vacuously when no artifact exists.

## Script Catalog Cohesion (INV-94)

- **INV-94:** Script catalog cohesion — every new gate script must carry a CATALOG marker block
  - _Enforcement:_ `scripts/check-script-cohesion.mjs`
  - Every `scripts/check-*.mjs` file added after the baseline freeze must carry a `// CATALOG:` marker block of ≥3 contiguous comment lines declaring what the script aggregates and why it cannot fold into a sibling. Pre-existing scripts are grandfathered via `scripts/data/script-catalog-baseline.json`.

## Fail-Closed Audit (INV-96)

- **INV-96:** Fail-closed audit — every gate script must default to BLOCK on uncertainty
  - _Enforcement:_ `scripts/check-fail-closed-audit.mjs`
  - Every gate, hook, check, and generator emitted by arbiter must default to BLOCK on uncertainty, never SKIP. Audits scripts/, .githooks/, and .claude/hooks/ for fail-open anti-patterns. New scripts outside the baseline must pass all checks.

## Supply Chain (INV-92)

- **INV-92:** Supply chain — keyless signing, SBOM attestation, and Trivy CRITICAL block
  - Enforcement: generated `05-release.yml` workflow (`trivy-fs-scan` + `cosign-sign` + `sbom-attest` jobs)
  - Release artifacts must be signed with cosign keyless (OIDC) and attested with CycloneDX SBOM via `cosign attest --predicate`. Trivy must block on CRITICAL vulnerabilities before signing. A `_sigstore-retry-sign` reusable workflow handles signing retry on Sigstore flakiness.

## Deploy Target Supply Chain (INV-95/97/98/99)

- **INV-95:** release.yml must invoke cosign sign on container image builds
  - _Enforcement:_ `scripts/check-workflow-cosign.mjs` (L1)
  - When `deployTarget` is not `"none"`, `05-release.yml` must invoke `cosign sign --yes` after the container image build step, signing the image digest via keyless Sigstore OIDC. Ensures every release artifact is signed before promotion to TEST or PROD.

- **INV-97:** deploy-prod must cosign-verify before traffic shift
  - _Enforcement:_ `scripts/check-workflow-cosign.mjs` (L1)
  - When `deployTarget` is not `"none"`, `10-deploy-prod.yml` must include a `cosign verify` step with `--certificate-identity-regexp` and `--certificate-oidc-issuer https://token.actions.githubusercontent.com` before any container-app update or service-routing command.

- **INV-98:** release workflow trigger must be tag-only (no branch push)
  - _Enforcement:_ `scripts/check-workflow-cosign.mjs` (L1)
  - When `deployTarget` is not `"none"`, `10-deploy-prod.yml` must trigger on `release:` events only and must NOT contain `push.branches`. Branch-push triggers on release workflows create unsigned pre-release artifacts that pollute the digest namespace used by `cosign copy`.

- **INV-99:** deployTarget must be a known cloud or "none"
  - _Enforcement:_ Zod schema (`src/config/schema.ts` `deployTargetSchema`) + EJS whitelist preamble in `04-deploy-test.yml.ejs` + `10-deploy-prod.yml.ejs`
  - The `deployTarget` field in `arbiter.json` must be one of: `"ghcr"`, `"azure-container-app"`, `"aws-ecs"`, `"gcp-cloud-run"`, `"none"`. Unknown values cause EJS `include()` path traversal at render time (RT-7).

- **INV-100:** collaborationMode must be set in arbiter.json
  - _Enforcement:_ `scripts/check-collab-mode-wired.mjs` (L1)
  - Every arbiter-scaffolded project must declare `collaborationMode` in `arbiter.json`. Valid values: `trunk-solo`, `peer-review`, `gated-review`. Absent collaborationMode falls back to deprecated `soloDevMode` inference. Run `arbiter update` to auto-migrate.

- **INV-101:** exact-SHA non-force landing for evidence-bearing changes
  - _Enforcement:_ `scripts/check-merge-method.mjs` (L1)
  - An evidence-bearing `trunk-solo + pr-ff` landing atomically advances `main` from the observed gated base to the exact gated head with GraphQL `updateRefs`, including a same-transaction head-ref assertion and `force:false`. Success requires live-policy validation and post-verification `main == gatedHeadSha`; GitHub PR merge methods are forbidden. Repo compatibility settings are `allow_merge_commit:true`, `allow_squash_merge:false`, `allow_rebase_merge:false`; branch protection uses `required_linear_history:false`, `allow_force_pushes:false`, and `allow_deletions:false`. Linearity comes from the non-force compare-and-swap, not GitHub's inoperable linear-history/merge-method tuple.

- **INV-106:** i18n parity — all locale files must have identical key sets
  - _Enforcement:_ Generated `<project>/scripts/verify-i18n-parity.mjs` + `<project>/scripts/i18n-literal-scanner.mjs` (L2, frontend-spa and frontend-lane projects)
  - In FE projects, all locale JSON files must contain the same set of translation keys. Raw UI text literals in component source are also flagged. Mirrors P6 of FE_DESIGN_PRINCIPLES.

- **INV-107:** docs/internal/ADR/ is the canonical ADR SSOT — numbers unique, canonical_id populated, README in sync
  - _Enforcement:_ `scripts/check-adr-index.mjs` (L1, selfOnly — arbiter self-governance only)

- **INV-108:** SSOT core set exhaustiveness — every qualifying doc must be listed
  - _Enforcement:_ `scripts/check-ssot-core.mjs` (reverse check via `gen-ssot-core.mjs` `selectSsotDocs`) + `gen-ssot-core.mjs --check` (L1, selfOnly — arbiter self-governance only)

- **INV-109:** Duplication (DRY) gate + ratchet — generated and dogfooded
- **INV-110:** GLOBAL_INVARIANTS.md must document every always-active invariant — coverage parity
  - _Enforcement:_ `npx jscpd` (L2, see `.jscpd.json`) + `scripts/debt-report.mjs --gate` (`duplicationPercentage` ratchet); generated for TypeScript targets by `src/generators/duplication.ts` (CANON-22 Tier-1)
- **INV-111:** CLI reference must document every registered command — no phantom, no missing
  - _Enforcement:_ `scripts/gen-cli-ref.mjs --check` (L1, selfOnly — arbiter self-governance only)
- **INV-112:** RTM/FEATURE_MATRIX required at L2+; serious-test DoD at L3+; 21CFR audit-trail at L4
  - _Enforcement:_ `scripts/check-feature-matrix.mjs` (L1, fail-closed status ladder + KIT-dim coverage + counter integrity + level-gated DoD)
- **INV-113:** Single authoritative task-phase document — no split-brain dotfiles
  - _Enforcement:_ `scripts/check-phase-doc-consistency.mjs` (L1; bans legacy `.task-*` dotfile literals in src/\*\* except the migration shim + validates `.claude/.task/status.json`)
- **INV-114:** Fail-closed Stop gate — completion claims require correlated evidence
  - _Enforcement:_ `.claude/hooks/stop-evidence-guard.mjs` (Claude Code `Stop` event, exit 2 = block; L2+, generated for targets + dogfooded per CANON-01/14)
- **INV-115:** Free-text governance prohibitions must resolve to a verified enforcer, live scan, or explicit triage
  - _Enforcement:_ `scripts/check-constraint-scan.mjs` (L1; extracts NEVER/MUST NOT/DO NOT prohibitions from AGENTS.md/CANON.md/CLAUDE.md, classifies via `scripts/constraint-map.json` with enforcer-existence verification, fails on a live un-covered violation, map-fiction, or a MISSING map file (ADR-109, escape: governance.constraintScan=off); generated for targets + dogfooded per CANON-01/14)
- **INV-116:** wiki/ must be free of broken wikilinks, orphan pages, stale source hashes, and missing citations
  - _Enforcement:_ `scripts/check-wiki-lint.mjs` (L2; validates 4 lint dimensions: broken-link, orphan, stale, citation-integrity; exits 0 on bootstrap; generated for targets + dogfooded per CANON-01/14)
- **INV-117:** arbiter self-repo must not track binary build artifacts
  - _Enforcement:_ `scripts/check-no-tracked-artifacts.mjs` (L1; selfOnly — arbiter npm-pack hygiene only; exits 0=PASS, 1=FAIL, 2=ERROR per INV-53)
- **INV-118:** Anti-proforma test gate — every test must carry a real assertion
  - _Enforcement:_ `scripts/check-anti-proforma.mjs` (L1+; **arbiter's own gate wires `--enforce`, so a finding is a hard block** (#2007) — warn-default remains the shipped default for targets, and `--enforce` promotes it; exit 0=PASS/WARN, 1=FAIL, 2=ERROR per INV-53). Block detection is literal-masked + paren-matched, not line/brace heuristics: strings, template literals, regexes and comments are blanked before parsing, so an `it(` inside fixture text is not a test and a `}` inside a string cannot truncate a block; assertions reached through a same-file helper count, and `expect(<module-scope identifier>).toBeDefined()/toBeTruthy()` as a block's only assertion is reported as a masked tautology (#2031). `.skip`/`.todo` blocks belong to `check-no-skipped-tests.mjs`, not here. JVM hard-block via `src/templates/archunit/AntiProformaTest.java.ejs` (L2+, bytecode scan). Bypass: @AntiProformaExempt("rationale") (JVM) or // anti-proforma-exempt: rationale (other). Bypass ratio >5% triggers EXEMPT-THRESHOLD alarm (#1249).
- **INV-119:** Commit-footer audit evidence required for suppression/override/bypass commits
  - _Enforcement:_ `scripts/check-commit-footer-rationale.mjs` (L2+; scans origin/main..HEAD for commits touching trivyignore/owasp-suppressions/pitest-override/sigstore-bypass/suppressions/\*\*; requires recognized footer trailer: Suppression-Rationale:, Pitest-Override-Rationale:, Trivy-Expiry-Extension:, Sigstore-Bypass:; evidence artifact written to .arbiter/evidence/commit-footer-audit/; fails open when origin/main unavailable; exit 0=PASS, 1=FAIL, 2=ERROR per INV-53; #1249).
- **INV-120:** Workflow needs-chain depth must not exceed the configured limit (parallelism regression gate)
  - _Enforcement:_ `scripts/check-workflow-parallelism.mjs` (L1, selfOnly; scans .github/workflows/\*.yml DAG; default ≤3 edges; per-file overrides: 01-pr-fast ≤3, 05-release ≤4, nightly/weekly/monthly ≤5; aggregator sinks with `if: always()` excluded; configurable via ARBITER_MAX_NEEDS_CHAIN env; exit 0=PASS, 1=FAIL, 2=ERROR per INV-53; #1231).
- **INV-121:** Stack conformity — the repo-root manifest must not contradict declared axes
  - _Enforcement:_ `<project>/scripts/check-stack-conformity.mjs` (L1, generated for targets when a language is declared; fails when the repo-ROOT manifest contradicts the declared language/databaseEngine — e.g. language="go" with a root package.json and no go.mod, or databaseEngine="sqlite" with a postgres driver. Self-safety is RUNTIME-resident: re-reads the target arbiter.json, absent language ⇒ exit 0, absent/none databaseEngine ⇒ DB conformity skipped. Root-scope only, never recurses. exit 0=PASS/SKIP, 1=FAIL, 2=ERROR per INV-53; #1312).

- **INV-122:** Update propagates template fixes to pristine generated files; user-modified files are preserved
  - _Enforcement:_ Integration + unit tests (`__tests__/integration/update-propagates-fixes.test.ts`, plus `fs-generation-session` and `generated-manifest` units). Runtime-resident in the arbiter CLI engine (init/update/diff): a committed per-file content-hash manifest (`.arbiter-generated-manifest.json`, repo root) lets `update` rewrite a pristine (disk hash == recorded render) `skipIfExists` file to propagate a template fix, while a user-modified file is preserved with a withheld-fix warning, and `diff` reports the pristine-stale file as changed (never a lying "unchanged"). Corrupt manifest fails closed (exit 2); missing is a legitimate first run. Inherited by the fleet via the CLI — not a render-time gate (#1328).

- **INV-123:** Emission coherence — every referenced emission must exist or be a declared optional
  - _Enforcement:_ `scripts/check-emission-coherence.mjs` (pure `checkEmissionCoherence(dir)`) — wired into arbiter's own `check-all.mjs` self-gate and run across the FULL (language × level × mode) matrix by `__tests__/integration/e2e/emission-coherence-matrix.test.ts` (static, in-process, no toolchains). Every `scripts/*.mjs` invoked by check-all, every `hooks.mjs` handler, every `.githook`/workflow node script, and every `.claude/settings.json` command must resolve to an emitted file. Unguarded-missing = always FAIL (crash class); guarded-missing (behind `existsSync()`/shell `[ -f ]`) = FAIL unless declared in `scripts/optional-emissions.json` with a non-empty rationale (the manifest can never silence an unguarded reference). Workflows must SHA-pin every `uses:` (local `./` and `docker://` excepted) and name every top-level job. The optional manifest is emitted for targets from `src/templates/scripts/optional-emissions.json.ejs`. exit 0=PASS, 1=FAIL, 2=ERROR per INV-53 (#1331).

- **INV-126:** Service archetypes must ship a non-mocked live-API e2e suite
  - _Enforcement:_ `scripts/check-api-e2e.mjs` (L1) — reads `api-e2e.json` at repo root; SKIP (exit 0) when absent (ungoverned repos never false-fail) or `required:false` (non-service archetype). For a service archetype (`required:true`, i.e. `backend-web-db`) the manifest `glob` must match ≥1 NON-EMPTY suite file under `tests/api/` that boots the real binary and asserts on live HTTP responses; absent/empty = exit 1. This is the INVERTED absent-semantics vs INV-124, closing the "domain green, HTTP wiring broken" gap. Generated for targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-api-e2e.mjs.ejs` (CANON-01/04/11). Manifest + starter suite + `<project>/tests/api/run.sh` (chmod 0o755) emitted by `src/generators/api-e2e.ts` (skipIfExists:true; suite scaffolded only for service archetypes; per-stack supertest/httptest/RestAssured/httpx/Newman). Boundary: presence + non-empty only — the live run is CI/L2 via `run.sh`; assertion quality is INV-118. exit 0=PASS/SKIP, 1=absent/empty suite, 2=schema/path-traversal per INV-53 (#1365).

- **INV-125:** Persisted domain fields must be reachable through the public HTTP API
  - _Enforcement:_ `scripts/check-domain-api-surface.mjs` (L1) — reads `domain-api-surface.json` at repo root; SKIP (exit 0) when absent (non-governed brownfield always passes to avoid false-fail). For each resource, every `persisted:true` field must appear in `inRequestSchema:true` OR `inResponseSchema:true`; missing from both = surface gap (exit 1). Generated for targets where `config.hasPublicApi` is true via the `emitDomainApiSurface` helper in `src/generators/check-all.ts` (skipIfExists:true); seed manifest from `src/templates/scripts/domain-api-surface.json.ejs`. exit 0=PASS/SKIP, 1=gap, 2=schema/parse per INV-53 (#1367).

- **INV-127:** Frontend archetypes must carry a render-smoke behavioural test
  - _Enforcement:_ `scripts/check-render-smoke.mjs` (L1) — self-gate wired in `scripts/check-all.mjs`. Active when `arbiter.json` declares archetype `frontend-spa` OR a `frontend` lane; any other archetype / a missing `arbiter.json` → SKIP (exit 0) so non-frontend and ungoverned repos never false-fail. A frontend project must carry ≥1 render-smoke spec (presence globs: `<project>/tests/e2e/render-smoke.spec.ts`, `**/*.render-smoke.{spec,test}.ts`, `<project>/frontend/tests/e2e/render-smoke.spec.ts`) — a headless-browser Playwright spec that boots the built SPA and asserts the app shell mounts with real content and zero console errors. Missing = fail-closed (exit 1), catching a known prior-internal-project failure mode (token-purity passed while the screen rendered broken). Generated for targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-render-smoke.mjs.ejs` (imports the shared `scripts/lib/glob-walk.mjs` helper, also unconditionally emitted); starter spec scaffolded for TS frontends by `src/generators/frontend-quality.ts` from `src/templates/e2e/playwright-ts/render-smoke.spec.ts.ejs` (skipIfExists:true). VRT against a committed baseline (`VRT_SETUP.md`) remains the stronger optional bar. exit 0=PASS/SKIP, 1=missing spec, 2=schema/parse per INV-53 (#1366).

- **INV-137:** Declared smoke journeys must be covered — no aspirational acceptance floor
  - _Enforcement:_ `scripts/check-smoke-journeys.mjs` (L1) — self-gate wired in `scripts/check-all.mjs`. Reads `smoke-journeys.json` at repo root (schema `arbiter-smoke-journeys-v1`); SKIP (exit 0) when absent (ungoverned repos never false-fail) or `applicable:false` (an archetype with no interactive login/CRUD/authz journeys, e.g. library/cli/backend-web-db — the latter's floor is INV-126's live-API suite). For an applicable manifest, every `required` journey's glob must match ≥1 spec file (OR semantics); a journey applicable to the archetype defaults to `required` (absent status ⇒ required — fail-closed, never silently n/a), `n/a` needs an auditable rationale ≥20 chars, and all-n/a is a hard fail. This is the synthesis of INV-124's auditable per-item shape with INV-126's fail-closed default: applicability is archetype×language-computed (not human-asserted), so a wired-but-dead CI job can never be laundered into a legitimate `n/a`. Day-1-green comes from a REAL scaffolded starter (`<project>/tests/smoke/smoke-journeys.spec.ts`, frontend-spa + TypeScript), not a default flag. Generated for targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-smoke-journeys.mjs.ejs` (imports the shared `scripts/lib/glob-walk.mjs` helper); manifest + starter emitted by `src/generators/smoke-journeys.ts` (skipIfExists:true). Boundary: presence only — assertion quality is INV-118, execution is the render-smoke/e2e lane. exit 0=PASS/SKIP, 1=policy violation, 2=schema/path-traversal per INV-53 (#2080).

- **INV-128:** Conformance script generated
  - _Enforcement:_ `scripts/conformance.mjs` — emitted unconditionally for all governed targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/conformance.mjs.ejs` (CANON-01/04/11). The script delegates to `npx @arbiter/cli conformance --check` (no local install required). **Known gap:** the `conformance` CLI command was removed in the T2 command-surface cut (`commands/conformance.ts` deleted; `src/conformance/{render,score,doc-probes}.ts` cut, though `gate-proofs.ts`/`dimensions.ts`/`engine.ts`/`shared.ts` survive for `doctor --prove-gates`) — the emitted script currently has nothing to delegate to. Wired as advisory (`runWarnCheck`) in the generated `scripts/check-all.mjs` L2 behind an `existsSync` guard — informational only, does not hard-fail the gate, so the gap fails soft. Emitted by `src/generators/conformance.ts` `generateConformanceScript` (skipIfExists:true). exit 0=PASS, 1=FAIL (below threshold), 2=ERROR per INV-53 (#1398).

- **INV-129:** No tracked data/state files or compiled binaries in the index
  - _Enforcement:_ `scripts/check-no-tracked-artifacts.mjs` (L1; self — extended for data/state globs `*.sqlite`/`*.sqlite3`/`*.db`/`*.db-shm`/`*.db-wal` + magic-byte binary detection ELF/Mach-O/PE). Distinct from INV-117 (selfOnly `*.tgz` build-artifact axis, unchanged): INV-129 is the DATA/STATE axis and applies downstream. Load-bearing in the three-way security split — a committed finance.sqlite trips neither gitleaks (no secret pattern) nor pii-scan (skips binaries). Allowlist: `__tests__/fixtures/**` + font/image/.wasm/.pdf. Downstream: emitted for targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-no-tracked-artifacts.mjs.ejs` (CANON-01/04/11), wired at L1 in the generated `scripts/check-all.mjs`. Fail-closed: non-git tree → ERROR (exit 2). exit 0=PASS, 1=FAIL, 2=ERROR per INV-53 (#1407/#1408).

- **INV-130:** E2E flaky-test quarantine annotates but never suppresses, and cannot rot
  - _Enforcement:_ `<project>/scripts/check-e2e-quarantine.mjs` (L1, Track-B — not an arbiter self-gate) — emitted unconditionally for all governed targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-e2e-quarantine.mjs.ejs` (CANON-01/04/11), alongside the library `src/templates/scripts/lib/e2e-reliability.mjs.ejs` it imports (deterministic failure fingerprint, INFRA/FLAKE/REGRESSION classify, initial→single-test→spec retry ladder, R0–R4 risk tier that fail-closes to R4, append-only JSONL ledger, quarantine schema). Wired HARD (`runCheck`) at L1 in the generated `scripts/check-all.mjs`. A quarantine entry ANNOTATES a known-unstable test but never suppresses it — quarantined tests still run and report; the gate enforces the registry (`.arbiter/e2e/quarantine.json`) cannot rot into a permanent silent mute (every entry needs the full field set + a FUTURE `expires`). Self-SKIPs (exit 0) when no registry is present. exit 0=PASS/absent, 1=FAIL (expired/malformed), 2=ERROR per INV-53 (#1445).
    **#1817 (A3):** retries hide races, so `retryLadder({ tier: 'smoke' })` force-truncates the ladder to a single `['initial']` attempt — zero retries for `@smoke`, non-bypassable (overrides caller-supplied `opts.scopes`). Quarantine rot is also surfaced as a conformance dimension, `DISC-e2e-quarantine` (tier-1 must-pass), via `probeE2eQuarantine` in `src/conformance/dimensions.ts` / wired in `src/conformance/gate-proofs.ts` (consumed by `arbiter doctor --prove-gates` — the `conformance` command that used to run this probe directly was removed in the T2 cut) — an arbiter self-gate (Track-A), distinct from the emitted Track-B script above. AC: a repo with an expired quarantine entry fails `arbiter doctor --prove-gates`.
    **#1817 (A4):** the ~10-rule installable E2E determinism standard lives in `<project>/docs/GOVERNANCE/E2E_CONSTITUTION.md`, generated by `generateE2eConstitution` for any project with a Playwright harness (frontend-spa or backend-web-db).
    The installed file is customizable: arbiter does not overwrite a user's edits on re-run (`skipIfExists`), same contract as `FRONTEND_CONSTITUTION.md`. `DISC-e2e-quarantine` evidence links back to it.

- **INV-131:** TDD red→green evidence is re-verified on a fresh checkout in CI
  - _Enforcement:_ `scripts/check-tdd-evidence.mjs` (L2, Track-B — not an arbiter self-gate) — emitted unconditionally for all governed targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-tdd-evidence.mjs.ejs` (CANON-01/04/11). The self-contained gate (inlines the v1 evidence schema + git checks, so no local arbiter install is needed) re-verifies, on a fresh CI checkout, that every task-ID commit on the branch carries valid TDD evidence: file present + schema-valid, `task_id` matches, a recognised test-runner FAILURE signature present (proves RED), `test_commit_sha` exists in history, `test_path` exists in that commit. The `ARBITER-SKIP-TDD` trailer is forbidden. Wired HARD (`runCheck`) at L2 in the generated `scripts/check-all.mjs`, independent of debt gates. Self-SKIPs (exit 0) when origin/main is unavailable or no task-ID commits exist. Arbiter dogfoods its own `scripts/check-tdd-evidence.mjs` (which delegates to the CLI; `--dir <repo>` points it at another checkout). exit 0=PASS/vacuous, 1=FAIL (missing/inconsistent evidence or forbidden trailer), 2=ERROR per INV-53 (#1446).
  - _Evidence is owed per CHANGE, not per commit (#2217, both tracks):_ task ids in a commit SUBJECT are verified individually, as before. A branch with **no** subject-scoped id that changes `src/` must carry **at least one** verified evidence among the tasks its commit BODIES cite (`Refs #NNN`) — the convention for a commit with no TDD cycle of its own, which used to parse to zero ids and pass **vacuously**. No commit type is trusted to declare itself exempt; a docs- or chore-only branch stays vacuous because it changes no source. `src/templates/**` counts as source. The failure names the two ways forward: record real evidence for a cited task, or move the source change onto its own branch whose subject carries the id. Arbiter's own gate adds one guard the emitted gate deliberately omits: the evidence file must have been COMMITTED on the branch, so inherited evidence from `main` cannot satisfy the floor. It is omitted for targets because the generated `.gitignore` ignores `.arbiter/` wholesale — the check would reject every target branch until a project un-ignores `.arbiter/evidence/tdd/*.json` as arbiter does for itself.
  - _The pin is rebase-stable (#2116):_ in BOTH tracks `test_commit_sha` must be REACHABLE from HEAD, not merely present as an object — a pre-rebase commit lingering behind a stale branch is not history anyone can reach, and it stops resolving entirely once that branch is deleted. Because a rebase rewrites every sha, evidence also records `test_blob_sha`, the RED test's content, which a rebase preserves. Re-resolving a rewritten commit from that blob (and running every downstream check against the resolved commit) is arbiter's own `verify tdd` path; the self-contained target gate asserts reachability only and fails loudly, requiring the evidence to be re-recorded. Evidence recorded before the pin existed cannot be healed on either track.
  - _The RED commit is committable (#2051):_ a genuine RED contains a test that FAILS, which the pre-commit L1 gate would block — the commit `record-red` must point at could not be made without `--no-verify`. The generated `.githooks/pre-commit` resolves this for exactly that commit shape: `phase=red` AND every staged path a test. Secret scanning and lint still run; source staged alongside, or any other phase, runs the full gate, as does the GREEN commit that follows.

- **INV-132:** arbiter init exposes a progressive-adoption tier on-ramp (bootstrap → L4)
  - _Enforcement:_ `src/commands/init.ts` (`resolveAdoptionTier` desugars `--tier` into `governanceLevel` + `brownfield`; `runInit` applies it before level resolution) + the `--tier` CLI option in `src/cli.ts`. `--tier bootstrap` is the gentlest Day-1 entry — governance L1 (the minimal runnable gate) + brownfield baseline lock-in so a messy repo's pre-existing debt is captured, not thrown as day-1 red; `L1`–`L4` are governance-level aliases. The tier adds NO new persisted config field (a view over `(governanceLevel, brownfield, grace)`); graduation uses the existing `arbiter upgrade-level` (grace-softened, ADR-028) + `arbiter configure` flows. Verified by `__tests__/commands/init-tier.test.ts` (red→green). Documented in ADR-098. selfOnly — governs arbiter's own init CLI behaviour, not a gate emitted to targets (#1447).

- **INV-135:** doc-set + anti-fake-green runners generated
  - _Enforcement:_ `scripts/check-doc-set.mjs` + `scripts/check-anti-fake-green.mjs` — two Track-B thin runners emitted unconditionally for all governed targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-doc-set.mjs.ejs` and `src/templates/scripts/check-anti-fake-green.mjs.ejs` (CANON-01/04/11). Each follows the gold-audit thin-runner shape (#1419, INV-128): a STATIC `spawnSync("npx", ["--no-install", "arbiter", "<cmd>", ...args])` delegation, so a consumer needs NO local `yaml` dep — the engine + its `yaml` parse run inside arbiter's own env. Both wired ADVISORY (`runWarnCheck`) at L2 in generated `scripts/check-all.mjs` behind existsSync guards: doc-set is advisory unless `--strict`, and the anti-fake-green gh-audit guards fail OPEN when `gh` is absent, so a fresh consumer passes with no day-1 redness. **The `class: 'gh-audit'` guards (`min-review-time`, `ownership-distribution`) are ADVISORY on BOTH tracks even where the aggregate runs hard — their exit 1 fails nothing unless the aggregate is invoked `--enforce` — and each now carries a dated promotion in `scripts/data/advisory-ledger.json` (promoteBy 2026-11-28 for both), policed by `scripts/check-bypass-ceremony.mjs` at L1 so the date can actually lapse (#2419 AC-3).** CLI: `src/commands/doc-set.ts` (verified by `__tests__/commands/doc-set.test.ts`, red→green). anti-fake-green has no CLI subcommand — its real enforcement path is the self-contained `scripts/check-anti-fake-green.mjs` aggregate (INV-135, verified by `__tests__/templates/anti-fake-green-render.test.ts` + `__tests__/conformance/anti-fake-green-self-audit.test.ts`). Exit codes per INV-53: 0=PASS/advisory, 1=FAIL, 2=ERROR (#1428).

- **INV-133:** TODO max-age enforced via linked-issue creation date
  - _Enforcement:_ `scripts/check-todo-max-age.mjs` (L2, self) — a `TODO(#NNN)` whose linked issue was created more than MAX_AGE_DAYS (default 180, `TODO_MAX_AGE_DAYS` override) days ago is reported as over-age and the gate exits 1. Age derives from the issue `created_at` (resolved per issue via `gh api repos/OWNER/REPO/issues/NNN --jq .created_at`, cached), so re-touching a TODO line leaves its age unchanged. This complements INV-21: INV-21 keeps a TODO traceable, INV-133 ages a traceable TODO out. The gate walks source for `TODO(#NNN)` and resolves OWNER/REPO from the git `origin` remote. When gh is absent, the token is missing, the host is offline, or `created_at` is unresolvable, the gate exits 0 (graceful skip, without false-fails). The age decision is a PURE function (`isOverAge` / `classifyOverAge` over an injected `{issueNumber→created_at}` map), unit-tested without live gh. Emitted unconditionally for governed targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-todo-max-age.mjs.ejs` (CANON-01/04/11), wired at L2 in the generated and self `scripts/check-all.mjs`. Verified by `__tests__/scripts/check-todo-max-age.test.ts` (red→green) + `__tests__/templates/check-todo-max-age-render.test.ts` (CANON-04). exit 0=PASS/SKIP, 1=FAIL, 2=ERROR per INV-53 (#1456).
- **INV-134:** per-module coverage non-regression ratchet
  - _Enforcement:_ `<project>/scripts/verify-module-coverage.mjs` (L2, ADVISORY, Track-B — emitted to governed targets rather than run as an arbiter self-gate) — emitted unconditionally for all governed targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/verify-module-coverage.mjs.ejs` (CANON-01/04/11). Holds per-MODULE (per-file/package) line coverage to an upward-only ratchet with a ±0.5pp slack: a module dropping more than 0.5pp below `module-coverage-baseline.json` is reported as a regression. All-languages, greenfield-aware (a module with zero executable lines contributes nothing and stays green). Per-language dispatch: TypeScript/JavaScript (`coverage/coverage-summary.json`) is robust; Java (JaCoCo), Python (coverage.py), Rust (tarpaulin) and Go (go cover) are scaffolded to SKIP gracefully when their summary is absent or unsupported, keeping false-positives out. The ratchet compare is the pure exported `compareModuleCoverage`. A first run with coverage and no baseline seeds the baseline (exit 0); a run with no coverage artifact SKIPs; `--update-baseline` advances it (CI leaves it untouched). Wired ADVISORY (`runWarnCheck`) at L2 in the generated `scripts/check-all.mjs` behind `existsSync` (start-warn, promote-later, to bound false positives). Complements the FE per-layer ratchet, the total-coverage greenfield gate (INV-30), and the bloat/debt ratchets without duplicating them. Verified by `__tests__/generators/module-coverage-ratchet.test.ts` (pure ratchet red→green) + `__tests__/templates/module-coverage-render.test.ts` (render across archetypes). exit 0=PASS/SKIP/seed, 1=regression (#1457).

- **INV-138:** Acceptance-criteria anchor — plans freeze issue AC; fit is evidenced per criterion
  - _Enforcement:_ `scripts/check-acceptance.mjs` (L1, flag-gated `features.acceptanceAnchor` / `ARBITER_ACCEPTANCE_ANCHOR`; selfOnly — the orchestration tools `issue-readiness.mjs`/`rework-log.mjs`/`scripts/lib/acceptance-criteria.mjs` are emitted to governed targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS, while wiring the gate itself into generated check-all is the tracked ADR-110 follow-up) — wired `runCheck` in `scripts/check-all.mjs`, `--plan` mode for wave integrate. Entry gate `scripts/issue-readiness.mjs` (orchestration-time, gh allowed) classifies an issue workable only with explicit `AC-N:` acceptance criteria beyond template stock lines + a Non-goals section + files/contracts touched; unready issues get `needs-clarification` and stay out of waves. During implementation phases the anchored plan freezes the issue AC verbatim (`## Acceptance Criteria`, explicit `AC-N` ids) plus `## Non-Goals`; at verification/close the reviewer-written `.arbiter/evidence/ac-fit/<task>.json` (committed) covers every criterion with verdict PASS and a cited file:line — unproven criteria reject the change mechanically. Rework telemetry: `scripts/rework-log.mjs` appends why × where-caught entries to the committed `.arbiter/rework/ledger.jsonl` (merge=union). Pure core: `scripts/lib/acceptance-criteria.mjs`. Vacuous without an active task; flag off ⇒ inert. exit 0=PASS/SKIP, 1=FAIL, 2=ERROR per INV-53 (ADR-110).

- **INV-139:** Fixture and smoke output must never land in real evidence directories
  - _Enforcement:_ `scripts/check-fixture-isolation.mjs` (L1, self) — scans the filesystem, rather than the git index, for parsed `.json`/`.jsonl` documents under `.arbiter/evidence` and `.evidence`, catching contamination before commit. It applies an ANCHORED-SCALAR rule only to whitespace-free string values and object keys matching `/^fake-/` or containing `STUDY_FAKE`, deliberately not a substring grep: the live corpus contains 158 legitimate `fake-green`/`fake-db` occurrences inside multi-line diff and log blobs. The #2176 `/ship-v2` study found two contaminated runs with `fake-*` finding IDs that reached real results, passed mechanical guards, and were caught only by the semantic judge. Unparseable documents are skipped; non-JSON artifacts are out of scope; NO-DATA (no evidence roots) is PASS. Enrolled in the anti-fake-green roster (`scripts/lib/anti-fake-green-guards.mjs`, `file-scan`) so a broken guard fails the aggregate, with a bad/clean discrimination proof in `scripts/lib/guard-flip-registry.mjs`. selfOnly because `STUDY_FAKE` and bare `fake-` are arbiter-study vocabulary and would create false positives in arbitrary target projects; the Track-B mirror waits on a configurable marker set. Verified by `__tests__/scripts/check-fixture-isolation.test.ts` (red→green). exit 0=PASS/NO-DATA, 1=contamination, 2=ERROR per INV-53 (#2181).

- **INV-124:** Declared test levels must be non-empty — no aspirational pyramid
  - _Enforcement:_ `scripts/check-test-pyramid.mjs` (L1) — reads `test-pyramid.json` at repo root; SKIP (exit 0) when absent (non-governed repos never false-fail; fail-closed provided by generator emission + SSOT completeness test). For each `required` level, at least one declared glob must match ≥1 file (OR semantics). `n/a` levels require a rationale ≥20 chars. All-n/a → hard fail. Manifest absent → SKIP. Generated for targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-test-pyramid.mjs.ejs` (CANON-01/04/11). Manifest emitted by `src/generators/test-pyramid-manifest.ts` (skipIfExists:true; Rust L1 auto-n/a; archetype-mismatch guard at gate time). exit 0=PASS/SKIP, 1=policy, 2=schema/path-traversal per INV-53 (#1364).

- **INV-105:** design token discipline — no raw colors or phantom tokens in UI components
  - _Enforcement:_ Generated `<project>/scripts/verify-tokens.mjs` (L2, frontend-spa and frontend-lane projects)
  - In FE projects, UI component files MUST use semantic design tokens from design-tokens.json (W3C DTCG format). Raw hex/rgb/hsl colors, foundation/primitive tokens (--f-\*), and phantom token references are FORBIDDEN. Mirrors FE006 + P1 of the FRONTEND_CONSTITUTION.

- **INV-102:** API-layer isolation — no HTTP calls outside the adapter layer
  - _Enforcement:_ Generated `<project>/scripts/check-fe-boundaries.mjs` (L2, frontend-spa and frontend-lane projects)
  - In FE projects (archetype frontend-spa or lanes:[frontend]), direct fetch()/axios.\* calls MUST NOT appear in UI component files, composables/hooks, or state stores. All HTTP I/O must be confined to a dedicated adapter/api layer. Mirrors FE001 of the FRONTEND_CONSTITUTION.

- **INV-103:** Headless domain logic — no browser APIs in domain or store layer
  - _Enforcement:_ Generated `<project>/scripts/check-fe-boundaries.mjs` (L2, frontend-spa and frontend-lane projects)
  - In FE projects, domain and store files MUST NOT import or reference browser APIs (window, document, localStorage, sessionStorage, matchMedia, navigator, location, history, IndexedDB). Browser coupling makes domain logic untestable in Node.js and prevents SSR. Mirrors FE002 of the FRONTEND_CONSTITUTION.

- **INV-104:** State-management discipline — stores are synchronous and client-only
  - _Enforcement:_ Generated `<project>/scripts/check-fe-boundaries.mjs` (L2, frontend-spa and frontend-lane projects)
  - In FE projects, state store files MUST NOT contain async fetch calls or direct API caching. Server state MUST be delegated to a data-fetching library (TanStack Query, SWR, or equivalent). Mirrors FE003 of the FRONTEND_CONSTITUTION.

---

## Coding Standards

### TypeScript

- Strict mode always on (`"strict": true` in tsconfig)
- No `any`. Use `unknown` and narrow, or create proper types.
- Prefer `const` over `let`, never `var`
- Async/await over callbacks or raw Promises
- Named exports preferred over default exports
- File naming: `kebab-case.ts`

---

## Testing Policy

### L2 (Standard)

- Unit tests: 80% coverage minimum
- Integration tests for all external boundaries (database, APIs)
- No mocking of internal modules — only boundary mocks
- TDD mandatory: test first, then implement. Record evidence with `arbiter task record-red --test-path <path>` before advancing to `green` phase

---

## Commit Convention

```
type(scope): summary

Types: feat, fix, refactor, test, docs, ci, chore, perf
Scope: optional — module or area affected
Summary: imperative, lowercase, ≤ 72 chars
```

Examples:

- `feat(auth): add OAuth2 token refresh`
- `fix(#123): resolve null pointer in payment flow`
- `test: add integration tests for user registration`

---

## Branch Strategy

- Main branch: `main` — protected, requires PR + passing CI
- Task branches: `task/#NNN-short-description`
- No direct commits to `main`

---

## Gate System

```
L1 (fast, pre-commit):    npm run lint
                          npx prettier --check .
                          npm run test

L2 (full, pre-push):      L1 + coverage + audit + integration tests

L3 (deep, nightly/CI):    L2 + E2E + static analysis + evidence
```

Run locally:

```bash
node scripts/check-all.mjs L1   # before commit
node scripts/check-all.mjs L2   # before push
```

**Ceremony is per train, gates are per landing.** The unit both are priced against is the train
(one worktree, branch, plan, gate and PR carrying N small issues), not the individual issue.
Plan, plan-review, red-team, code review, the cross-model seat and the PR run once for
the train; L1 runs once at the landing commit and L2 once at the push, whatever the train
carries. `ship.train` in `arbiter.json` (`maxChain`, `maxAgeMinutes`) bounds how far a train
may grow before it must be landed. Re-running the whole ceremony per issue over a batch of
small issues is a violation of the playbook (`.claude/commands/ship.md` §Train), not extra
safety.

---

## Enforcement Chain

Changes pass through five enforcement layers:

| Layer             | Mechanism                             | Coverage                   |
| ----------------- | ------------------------------------- | -------------------------- |
| Edit-time         | Claude Code hooks (`.claude/hooks/`)  | Claude Code edits only     |
| Pre-commit        | `.githooks/pre-commit` — runs L1 gate | All editors (`git commit`) |
| Pre-push          | `.githooks/pre-push` — runs L2 gate   | All pushes                 |
| CI                | GitHub Actions / equivalent           | All PRs                    |
| Branch protection | See ADR-007                           | Force-push, direct merge   |

Install hooks: `git config core.hooksPath .githooks` (auto-applied via `npm install` — see `package.json` `prepare` script).
Bypass surface: only `git commit --no-verify` (documented, audited at PR review).

---

## Tech Debt Gates

Enforced at L2+ (automated, runs in CI and locally via `node scripts/check-all.mjs L2`):

| Check         | Tool                     | Threshold           |
| ------------- | ------------------------ | ------------------- |
| Coverage      | vitest / jest            | 80% lines           |
| Complexity    | ESLint `complexity` rule | max 15              |
| Dead Code     | Knip                     | zero unused exports |
| Circular Deps | madge                    | zero cycles         |

---

## Debt Ratchet

Proactive debt regression prevention. Baseline metrics stored in `debt-baseline.json` (commit this file).

**Commands:**

- `node scripts/capture-debt-baseline.mjs` — Capture current metrics as baseline
- `node scripts/capture-debt-baseline.mjs --update` — Tighten baseline (accepts improvements only; refuses to loosen)
- `node scripts/debt-report.mjs` — Print current vs baseline comparison report
- `node scripts/debt-report.mjs --gate` — Fail if any metric regressed (used in L2 gate)

**Tracked:** coverage, complexity violations, dead code count, TODO count

**Rule:** Never manually edit `debt-baseline.json` to loosen metrics — that defeats the ratchet. Only run `--update` after genuine improvements.

---

## Security Scanning (INV-11/12/13)

Security gates run as L2+ hard requirements. PII scan is HARD (no grace period) and runs before all other gates.

| Scanner           | Tool         | Gate Level         | Trigger                                                                   |
| ----------------- | ------------ | ------------------ | ------------------------------------------------------------------------- |
| Secrets detection | gitleaks     | L2 HARD            | `gitleaks detect --source . --baseline-path suppressions/.gitleaksignore` |
| PII scan          | pii-scan.mjs | L2 HARD (no grace) | `node scripts/pii-scan.mjs`                                               |
| Dep audit         | npm audit    | L2 HARD            | `npm audit --omit=dev --audit-level=high`                                 |

**Suppression files** (user-edited, not overwritten):

- `suppressions/.gitleaksignore` — allowlisted gitleaks findings
- `suppressions/pii-allowlist.json` — allowlisted PII patterns (format: `[{"pattern": "...", "reason": "..."}]`)

**Claude hook**: `check-no-pii.mjs` (PostToolUse, Edit|Write) blocks PII from being written to source files.

---

## Integrations

arbiter uses a detect-and-reference posture with other Claude Code skill suites. See [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md) for the legal stance, attribution rules, and how to add a new skill to the matrix.

**Companion plugins (#1730, ADR-100 — `docs/internal/ADR/100-companion-plugin-awareness.md`).** The same posture extends into the ship orchestrator: a companion registered in the skills matrix with a companion policy (first-class: **ponytail**, a YAGNI drafting persona) is detected home-only and composed into the green implementation phase on product repos, with each step announcing the active companions. It stays off on arbiter-self and is capped below the test-skipping ultra mode; when none is installed the orchestrator behaves exactly as before. arbiter detects and composes rather than vendoring companion code, and the gates stay authoritative. Full policy: ADR-100.

---

## Process Canon (CANON-01..23)

Structural process rules enforced by `scripts/check-catalog-agents-parity.mjs` (CANON-08).
Canonical source: `docs/internal/SYSTEM/CANON.md`.

- **CANON-01:** Dual-sided declination
- **CANON-02:** Proven cell ⇒ gated step
- **CANON-03:** Proven cell ⇒ fixture
- **CANON-04:** Every .ejs has a render test
- **CANON-05:** Every generator has a unit test
- **CANON-06:** Every CLI command has a test
- **CANON-07:** Generated scripts must be executed in tests
- **CANON-08:** Catalog ↔ AGENTS.md parity
- **CANON-09:** Invariant enforcement claim = wired gate step
- **CANON-10:** Every active hook is documented in .claude/CLAUDE.md
- **CANON-11:** Every file-emitting generator has a brownfield test
- **CANON-12:** INV-12 applies to arbiter's own source
- **CANON-13:** EJS conditionals preserved on every template edit
- **CANON-14:** Self-config ⊇ template at equal governance level
- **CANON-15:** Boundary/security templates require a wired gate step
- **CANON-16:** Refactor-first before creating new source files
- **CANON-17:** FS errno translation
- **CANON-18:** Every workflow EJS template edit must be tested across all stacks × governance
- **CANON-19:** sign-and-attest composite action edits require release workflow re-validation
- **CANON-20:** Governance threshold table changes require cross-product fixture update
- **CANON-21:** Aggregate, don't proliferate
- **CANON-22:** Evidence-based quality: validated metrics gate, contested heuristics advise
- **CANON-23:** RTM-required-by-level: every governed project ships a gated FEATURE_MATRIX
- **CANON-24:** Name the change that turns a gate red, and prove it by inverting it

---

## Multi-Agent Tool Extensions

This project uses AGENTS.md as the canonical source. Tool-specific files add only what each tool uniquely needs:

| File                | Tool         | Purpose                                        |
| ------------------- | ------------ | ---------------------------------------------- |
| `.claude/CLAUDE.md` | Claude Code  | Hook configuration, sub-agents, slash commands |
| `.agents/CODEX.md`  | OpenAI Codex | Plan JSON schema, execution router             |

When using Claude Code: read `.claude/CLAUDE.md` for Claude-specific configuration.
When using Codex: read `.agents/CODEX.md` for Codex-specific configuration.
All governance rules are in **this file**.

Sub-agent registry (names, models, effort, interaction chains): `.claude/AGENT_REGISTRY.md`.

<!-- arbiter:preserve — This AGENTS.md is hand-authored self-governance for the arbiter repo,
     intentionally richer than the generic generateAgentsMd() output every consumer project gets
     (frontmatter, 5-level Authority Hierarchy, Process Canon, Model-Pyramid Iron Law, per-INV
     enforcement detail) and is not reproducible from the shipped template. The preserve marker
     (src/utils/fs.ts #1980) stops `arbiter update` from overwriting it with the lossy generic
     version; the guard in __tests__/governance/agents-md-parity.test.ts checks both the marker and
     the hand-authored sentinels. Placed at end-of-file so it shifts no constraint line numbers
     (keeps docs/internal/PRODUCT/GAP.md + wiki source hashes stable). See #2055. -->
