---
title: 'arbiter — Global Invariants Reference'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/invariant']
related: []
---

# arbiter — Global Invariants Reference

> **Deep reference companion to AGENTS.md.**
> AGENTS.md lists invariants concisely (one line each). This file adds descriptions,
> rationale, enforcement details, and language-specific guidance.
>
> Invariant tiers active for this project: **architectural, governance, data, operational**

---

## Tier 1: Architectural Integrity

### INV-01: No circular dependencies between modules

Circular imports create tight coupling and make modules impossible to test in isolation. Every module must have a clear single direction of dependency. Detected by static analysis in CI.

**Enforcement:** CI (madge / go vet / cargo check / pylint)

---

### INV-02: Public API surface must be intentional — no accidental exports

Every publicly exported symbol is a commitment to callers. Exporting by default leaks implementation details and makes refactoring costly. Only intentionally designed symbols may be public.

**Enforcement:** CI (Knip / cargo doc / PMD / unused linters)

---

### INV-03: Layer boundaries enforced — domain code must not import from infrastructure layers

Layers must respect their dependency direction. Domain/business logic must not import from infrastructure or adapters. Boundary violations break testability and portability.

**Typescript guidance:** Layer boundaries enforced — domain code must not import from infrastructure layers

**Enforcement:** CI (ArchUnit / architecture linters / manual)

---

### INV-04: No `any` type in TypeScript — use `unknown` and narrow, or create proper types

Each language has idioms for expressing and enforcing type safety at compile or lint time. Bypassing these mechanisms removes the safety net and allows runtime errors that the type system was designed to prevent.

**Typescript guidance:** No `any` type in TypeScript — use `unknown` and narrow, or create proper types

**Enforcement:** hook + CI (ESLint no-explicit-any / cargo clippy / ruff / golangci-lint)

---

### INV-05: Cyclomatic complexity ≤ 15 (ESLint `complexity` rule)

High cyclomatic complexity correlates with defect density and makes code harder to test. Functions and methods must stay within complexity bounds to ensure readability and testability.

**Typescript guidance:** Cyclomatic complexity ≤ 15 (ESLint `complexity` rule)

**Enforcement:** CI (ESLint / PMD / clippy / golangci-lint / ruff)

---

### INV-06: No unused exports (Knip dead code analysis, zero findings)

Dead code is a maintenance liability — it misleads readers, bloats binaries, and may hide latent bugs. All exported symbols and dependencies must be actively used.

**Typescript guidance:** No unused exports (Knip dead code analysis, zero findings)

**Enforcement:** CI (Knip / PMD / clippy / golangci-lint / ruff)

---

### INV-46: Anti-bloat enforcement — Survey gate + duplication detector + LOC ratchet

Before any new file is written under src/, a valid Existing Code Survey block must exist in the active plan (Target anchor, Decision keyword, ≥3 evidence rows, ≥200-char Rationale). The pre-edit hook hard-blocks (exit 2) any Write that lacks the survey. L2: jscpd detects code duplication above 5% threshold. L1: check-bloat-ratchet.mjs enforces file-count and LOC ceilings per src/ bucket (default +10%/+5 files; src/templates tighter at +5%/+3 files). Bypass surfaces: ARBITER_PLAN_BYPASS=1 (Survey gate) and ALLOW_BLOAT=1 (ratchet), both session-scoped and documented in CONTRIBUTING.md.

**Enforcement:** .claude/hooks/pre-edit-plan-anchor.mjs (CANON-16 Survey gate, exit 2) + scripts/check-bloat-ratchet.mjs (L1 ratchet) + npx jscpd (L2 duplication, see .jscpd.json)

---

### INV-99: deployTarget must be a known cloud or "none"

`deployTarget` selects which deploy workflows are generated. An unknown value would silently skip deploy governance, so the config schema rejects anything outside the known cloud set (default `none` prevents an undefined target).

**Enforcement:** Zod schema validation on config load + EJS whitelist preamble in the deploy workflow templates

---

### INV-100: collaborationMode must be set in arbiter.json

`collaborationMode` selects the worktree / merge / review governance axis. A missing value leaves that axis undefined, so the gate fails closed until it is set.

**Enforcement:** scripts/check-collab-mode-wired.mjs (L1)

---

### INV-101: ff-only merge is the only allowed merge method

Fast-forward-only merges keep history linear and preserve the cosign signature bound to the merged commit; a merge commit would orphan that attestation.

**Enforcement:** scripts/check-merge-method.mjs (L1)

---

### INV-29: No MockMvc — use RestAssured for integration tests (Java)

Java integration tests must exercise the real HTTP stack via RestAssured; MockMvc bypasses the servlet container and gives false confidence about wire-level behaviour.

**Enforcement:** hook (check-no-mockmvc.mjs) + ArchUnit (NoMockMvcTest.java) + policy

---

## Tier 2: Data Integrity

### INV-07: Schema changes via versioned migrations only — no manual DDL

Database schema must evolve through versioned migration files (e.g. Flyway, Alembic, golang-migrate). Direct ALTER TABLE in application code, ORM auto-schema, or manual production changes are forbidden. Every schema state must be reproducible from migration history.

**Enforcement:** CI (migration lint / manual review)

---

### INV-08: Input validation at system boundaries

All data entering the system from external sources (HTTP requests, message queues, files, user input) must be validated and rejected if malformed before reaching domain logic. Never trust external input.

**Enforcement:** code review / integration tests

---

### INV-09: Audit trail for mutable entities

Every create, update, or delete on business-critical entities must be auditable. Changes must be traceable to the acting user, timestamp, and prior state.

**Enforcement:** code review / integration tests

**Minimum governance level:** L2+

---

### INV-10: Soft delete preferred over hard delete

Business data should be logically deleted (e.g. `deleted_at` timestamp, `is_active` flag) rather than physically removed. Hard delete is permitted only for explicit GDPR erasure flows. Queries must exclude soft-deleted records by default.

**Enforcement:** code review / ArchUnit or equivalent

---

### INV-34: Integration tests must use real database (L2+)

Integration tests must execute against a real database via Testcontainers at L2+. In-memory databases (H2, SQLite in-memory mode) are forbidden as a substitute for a real database engine. Tests that pass against an in-memory store may fail against the production database due to SQL dialect differences, constraint handling, and index behaviour.

**Enforcement:** check-all.mjs integration test step (L2+ when hasDatabase=true); anti-fake-DB gates: ArchUnit NoH2ArchTest (Java), ESLint no-restricted-imports (TypeScript), ruff F401-style check (Python); generated by src/generators/integration-testing.ts

**Minimum governance level:** L2+

---

## Tier 3: Security & Compliance

### INV-11: No secrets in source code

API keys, passwords, tokens, and other secrets must never appear in source files, configuration files committed to version control, or log output. Use environment variables or secret managers (Vault, AWS Secrets Manager, etc.).

**Enforcement:** CI (gitleaks secrets scan — security-early-fail job, runs before lint-and-test); local gate: `gitleaks detect --source . --baseline-path suppressions/.gitleaksignore` (L2 block)

**Minimum governance level:** L2+

---

### INV-12: No PII in code, tests, or logs

Personally identifiable information (emails, phone numbers, credit card numbers) must not appear in source code, test fixtures, or log output. Mask or redact PII before logging. Required for GDPR/NIS2 compliance. Enforced by static scan (pii-scan.mjs) as a HARD early-fail gate — no grace-period exception applies.

**Enforcement:** CI (pii-scan.mjs — security-early-fail job, HARD early-fail, no grace period); local gate: `node scripts/pii-scan.mjs` runs before all L1 checks; Claude hook: check-no-pii.mjs (PostToolUse, Edit|Write)

**Minimum governance level:** L2+

---

### INV-13: Dependencies scanned for known vulnerabilities

All third-party dependencies must be scanned for CVEs before each release. High-severity vulnerabilities (CVSS ≥ 7.0) block deployment. Dependency updates must be reviewed for breaking changes.

**Enforcement:** CI dep-audit step per stack — TypeScript: `npm audit --audit-level=high`; Rust: rustsec/audit-check action; Java: OWASP Dependency-Check (failBuildOnCVSS=7.0, apply config/owasp-dependency-check.gradle); Go: golang/govulncheck-action; Python: pip-audit. Local gate (L2 block): same commands, soft: graceActive

**Minimum governance level:** L2+

---

### INV-95: release.yml must invoke cosign sign on container image builds

Container images shipped from `release.yml` must be signed so downstream consumers can verify provenance; a release that builds an image without `cosign sign` is rejected.

**Enforcement:** scripts/check-workflow-cosign.mjs (L1)

---

### INV-97: deploy-prod must cosign-verify before traffic shift

Production deploys must `cosign verify` the image before shifting traffic, so an unsigned or tampered image can never reach prod.

**Enforcement:** scripts/check-workflow-cosign.mjs (L1)

---

### INV-98: release workflow trigger must be tag-only (no branch push)

The release workflow must trigger only on `push.tags` — a branch-push trigger would publish unversioned artifacts and bypass the tag-gated release flow.

**Enforcement:** scripts/check-workflow-cosign.mjs (L1)

---

## Tier 4: Operational Excellence

### INV-16: No `console.log/warn/error` in production code — use structured logger

Production code must use a structured logging library that emits machine-parseable output (JSON). Raw print statements bypass log level filtering, structured fields, and correlation IDs. Every log entry should include `traceId` where applicable.

**Typescript guidance:** No `console.log/warn/error` in production code — use structured logger

**Enforcement:** hook + CI (lint rules / grep / ESLint no-console)

---

### INV-17: Unhandled Promise rejections forbidden — always `.catch()` or `await` in `try/catch`

Unhandled errors and unexpected panics cause silent data corruption or opaque crashes. Every error path must be explicitly handled, logged, or propagated with context.

**Typescript guidance:** Unhandled Promise rejections forbidden — always `.catch()` or `await` in `try/catch`

**Enforcement:** hook + CI (lint rules / clippy)

---

### INV-18: No hardcoded environment values

Configuration values that differ between environments (URLs, ports, timeouts, feature flags) must be externalized via environment variables or configuration files, never hardcoded in source. This enables environment parity and safe deployments.

**Enforcement:** code review / SAST

---

### INV-19: Resilient external calls — circuit breaker or retry required

Every outbound call to an external service (HTTP, database, queue) must be wrapped in a resilience pattern: retry with exponential backoff and/or circuit breaker. Unbounded blocking calls and missing timeouts cause cascading failures.

**Enforcement:** code review / integration tests

**Minimum governance level:** L2+

---

### INV-20: Health and readiness endpoints required for deployed services

Every deployed service must expose `/health` (liveness) and `/ready` (readiness) endpoints that orchestrators (Kubernetes, ECS, etc.) can probe. These endpoints must reflect actual dependency health, not just process uptime.

**Enforcement:** integration tests / deployment checks

**Minimum governance level:** L2+

---

### INV-35: Contract testing enforced when contractType is active

When contractType !== 'none', contract tests must run in CI at L2+ and are a HARD gate. Failures block merge. Supported contract types: rest-owned, rest-public, graphql, grpc, message-queue. Each type generates the appropriate tooling (Pact, graphql-inspector, buf) and CI job.

**Enforcement:** check-all.mjs L2 contract gate + CI contract-verify job; generated by src/generators/contract-testing.ts

**Minimum governance level:** L2+

---

### INV-40: BDD scenarios with @ignore tag are HARD-fail

Generated check-all.mjs must scan feature files for the @ignore tag before running BDD scenarios. Any @ignore-tagged scenario causes the gate to exit non-zero immediately (soft: false), regardless of grace period. Ignored scenarios are dead specs — they silently pass and give false confidence about coverage.

**Enforcement:** src/templates/scripts/check-all.mjs.ejs (@ignore grep block, soft: false) + src/templates/behavioral-tests/bdd/example.feature.ejs (no @ignore in shipped example)

---

### INV-41: Message-queue contract tests must call Schema Registry testCompatibility

Schema Registry contract tests must invoke testCompatibility() against the registered schema, not merely check reachability (HTTP-200 on /subjects). The compatibility level must be BACKWARD or FULL. A test that only GETs /subjects is not a contract test — it is a health check.

**Enforcement:** src/templates/contract-testing/message-queue/schema-registry-check.ts.ejs + src/templates/contract-testing/message-queue/SchemaRegistryCheckIT.java.ejs + src/templates/contract-testing/message-queue/schema_registry_test.go.ejs + src/templates/contract-testing/message-queue/test_schema_registry.py.ejs + src/templates/contract-testing/message-queue/schema_registry_test.rs.ejs

---

### INV-42: Pact broker glue must be env-gated; no silent runs against default URL

Generated Pact contract gates in check-all.mjs and CI workflows must be wrapped in a PACT_BROKER_BASE_URL environment check. When the variable is unset the step skips with a visible log line. When set, PACT_BROKER_TOKEN is forwarded to the Gradle/Maven/npx process as a system property or env var. No hardcoded broker URL is permitted.

**Enforcement:** src/templates/scripts/check-all.mjs.ejs (env-gate block around Pact runCheck calls) + src/templates/github/workflows/ci.yml.ejs (if: vars.PACT_BROKER_BASE_URL != '' + env: block) + src/templates/contract-testing/rest-owned/pact-deps.gradle.ejs (conditional system props)

---

### INV-43: OpenAPI exporter must run before diff; missing reference is HARD-fail

Generated OpenAPI diff tests must not silently skip when spec files are missing. If contracts/openapi-current.yaml is absent, the test fails HARD (exporter was not run). If contracts/openapi-reference.yaml is absent, the test fails HARD unless ALLOW_OPENAPI_BOOTSTRAP=1 is set (first-run escape hatch). A test that silently passes with missing files is not a contract test — it is dead code.

**Enforcement:** src/templates/contract-testing/rest-public/openapi-diff.ts.ejs + src/templates/contract-testing/rest-public/OpenApiDiffIT.java.ejs + src/templates/contract-testing/rest-public/openapi_diff_test.go.ejs + src/templates/contract-testing/rest-public/test_openapi_diff.py.ejs + src/templates/contract-testing/rest-public/openapi_diff_test.rs.ejs

---

## Tier 5: Governance

### INV-21: Every TODO comment must reference a task ID: `TODO(#NNN)`

Orphan TODOs without a task ID cannot be tracked or prioritized and accumulate as invisible tech debt. Every TODO must link to a trackable issue so it can be scheduled or explicitly deferred.

**Enforcement:** hook (check-no-orphan-todo.mjs) + CI

---

### INV-22: Branch naming: `task/#NNN-description`

Consistent branch naming enables automatic linking between code and issue trackers, makes CI filtering predictable, and allows automated branch cleanup.

**Enforcement:** pre-push hook / CI branch name check

---

### INV-23: No direct commits to `main` — all changes via task branches + PR

Direct commits to the main branch bypass code review, CI validation, and the PR discussion record. All changes must flow through a PR from a task branch.

**Enforcement:** branch protection (GitHub) / pre-push hook

---

### INV-24: Gate must pass before commit: `node scripts/check-all.mjs L1`

The L1 gate (lint + unit tests) is the minimum bar for any commit. Committing broken code wastes reviewer time and breaks other developers' workflows.

**Enforcement:** pre-commit hook / CI

---

### INV-25: Gate must pass before push: `node scripts/check-all.mjs L2`

The L2 gate (L1 + coverage + integration tests) verifies that the feature works end-to-end before others are affected. Pushing broken code blocks the team.

**Enforcement:** pre-push hook / CI

---

### INV-26: TDD mandatory — test first, then implement

Test-driven development forces explicit design thinking before coding and produces code that is testable by construction. Writing tests after the fact often results in tests written to pass rather than tests that document expected behavior.

**Enforcement:** process / code review

**Minimum governance level:** L2+

---

### INV-31: Suppressions must have mandatory expiry

Every suppression entry — both file-based (dependency-check-suppressions.xml, .gitleaksignore, pii-allowlist.json, archunit-baseline.json) and inline comment directives (arbiter-suppress(INV-NN, until=YYYY-MM-DD, reason=..., owner=@handle)) — must carry mandatory metadata: reason (≥10 chars), owner (@github-handle), and expiresAt/until (ISO date). Entries with a past expiry block the L1 gate. There are no permanent suppressions — waivers must be renewed or removed when the underlying issue is resolved.

**Enforcement:** CI gate (scripts/check-suppressions.mjs + scripts/check-inline-suppressions.mjs — L1) + pre-commit hook

---

### INV-32: Every 'proven' language must have a nightly real-project fixture

Arbiter's cross-language-matrix.json tracks tool maturity per language. A 'proven' rating implies the tool chain works end-to-end on real projects. Every language that carries at least one 'proven' cell must have a corresponding fixture under **tests**/fixtures/real-projects/ so the nightly real-project-matrix workflow can exercise the full arbiter pipeline (init → verify → check-all) against it. Promoting a language to 'proven' without a fixture is rejected by the L1 gate.

**Enforcement:** CI gate (scripts/check-matrix-fixtures.mjs — L1) + nightly real-project-matrix workflow

---

### INV-36: Hook hardness manifest — every hook must declare intent; HARD hooks must empirically block

Every hook in src/templates/claude/hooks/ must be declared in .arbiter/hooks-manifest.json with an explicit classification (HARD | ADVISORY). HARD hooks must empirically exit non-zero on a canonical violation fixture. Any hook file without a manifest entry, or any HARD hook that exits 0 on violation, fails CI. This prevents silent ceremony regression — where a hook is declared hard but silently exits 0.

**Enforcement:** L1 gate (scripts/check-hardness-inventory.mjs) — drift and empirical exit-code assertions on every CI run

---

### INV-37: Generated githooks

generateGithooks emits executable .githooks/{pre-commit,pre-push,commit-msg} for every supported language stack. Hooks must run L1/L2 gates respectively.

**Enforcement:** src/generators/githooks.ts (generator) + **tests**/generators/githooks.test.ts + **tests**/integration/githooks-generation.test.ts

---

### INV-38: Phase-tracked lifecycle enforcement

Task lifecycle phase transitions are validated mechanically: completion guard exits 2 on premature claim (returns stderr to Claude as error context), pre-commit blocks commits during preflight/plan phases, and arbiter task advance validates forward-only transitions with audit log. Evidence guard (guard-done-evidence.mjs.ejs) additionally blocks done claims until SHA-pinned evidence (.claude/.last-done-evidence.json) is present, all_green, and SHAs match current tree. Evidence is captured by running node scripts/done-evidence.mjs (runs L2 gate + pins source SHAs).

**Enforcement:** src/templates/claude/hooks/guard-task-completion.mjs.ejs (exit 2) + src/templates/claude/hooks/guard-done-evidence.mjs.ejs (exit 2, SHA-pin validation) + src/templates/scripts/done-evidence.mjs.ejs (evidence capture CLI) + src/templates/githooks/pre-commit.ejs (phase guard) + src/commands/task.ts (advance validator)

---

### INV-39: Hook templates require empirical fire-tests

Every Claude Code hook template in src/templates/claude/hooks/ must have at least one empirical fire-test in **tests**/hooks/empirical/. Adding a hook template without a corresponding test is a gate violation.

**Enforcement:** **tests**/hooks/empirical/hook-fires.test.ts (22 tests covering all 14 hook templates)

---

### INV-45: Self-dogfood check — every EJS template must render to match its materialized .claude/ file

Every EJS template under src/templates/claude/ must render (with arbiter's own config) to content that matches the corresponding materialized .claude/ file. Files listed in .dogfood-divergences.json are explicitly exempted (intentional arbiter-internal extensions not appropriate for target projects). Config-gated templates are skipped when the relevant feature flag is disabled in arbiter.json. This invariant prevents arbiter from shipping stale template skeletons that diverge from its own governance without an explicit documented reason.

**Enforcement:** scripts/check-self-dogfood.mjs (L2 gate check) — exits 1 on unexpected drift

---

### INV-47: Matrix proven cell requires a gate invocation in check-all.mjs.ejs

Every tool cell marked 'proven' in src/compatibility/cross-language-matrix.json must produce a concrete invocation step in src/templates/scripts/check-all.mjs.ejs at the correct gate level (L1, L2, or L3). Pre-existing gaps (e.g. mutation testing) are tracked in .matrix-proven-cells-exceptions.json with TODO references to the wiring issue.

**Enforcement:** scripts/check-matrix-proven-cells.mjs (L1 gate)

---

### INV-48: EJS template render-test coverage must not regress

Every template file under src/templates/ should be asserted by at least one test in **tests**/templates/ that renders the template and checks concrete output strings. Enforced via ratchet: the count of untested EJS files must not exceed the committed baseline (.template-tests-baseline.txt). Run with --update-baseline when adding tests.

**Enforcement:** scripts/check-template-tests.mjs (L1 ratchet gate)

---

### INV-49: Every generator in src/generators/ must have a unit test

Every file under src/generators/ requires a corresponding **tests**/generators/\*.test.ts covering the happy path, idempotency, and at least one negative case. Untested generators can silently emit wrong governance content into target projects.

**Enforcement:** scripts/check-generator-tests.mjs (L1 gate)

---

### INV-50: Every command in src/commands/ must have a test

Every file under src/commands/ requires at least one corresponding **tests**/commands/\*.test.ts (prefix-match: review.ts is covered by review-code.test.ts). CLI commands are the user entry point; untested commands cannot be refactored safely.

**Enforcement:** scripts/check-command-tests.mjs (L1 gate)

---

### INV-51: Every catalog invariant must appear in AGENTS.md §Invariants

Every invariant in src/invariants/catalog.ts must have a matching entry in AGENTS.md §Invariants. AGENTS.md is the canonical governance document read by all AI agents and new contributors. Invariants that exist only in code are invisible to the governance layer.

**Enforcement:** scripts/check-catalog-agents-parity.mjs (L1 gate)

---

### INV-52: Catalog enforcement script citations must be wired in check-all.mjs

If the enforcement field of a catalog invariant references a scripts/\*.mjs file, that script must be called in scripts/check-all.mjs. Claimed enforcement that is not wired is a false guarantee — callers of the gate will believe it checks something it does not.

**Enforcement:** scripts/check-inv-enforcement-wired.mjs (L1 gate)

---

### INV-53: Exit-code universal contract — every Arbiter-emitted script exits 0=PASS / 1=FAIL / 2=ERROR

Every script emitted by Arbiter (scripts/_.mjs, src/templates/scripts/_.ejs) must use exactly three exit codes: 0=PASS, 1=FAIL, 2=ERROR. That is: 0 for success, 1 for detected failure, 2 for invocation error (bad arguments, missing required inputs, environment not ready). Any other exit code is a violation. This contract makes every gate composable: callers can distinguish a clean run (0), a caught violation (1), and an unconfigured/broken environment (2) without parsing output. Enforced by scripts/check-exit-code-contract.mjs (L1 gate) which scans all emitted scripts and fails on any process.exit(N) where N ∉ {0, 1, 2}. The self-validation drill (scripts/self-validation.mjs, L2) proves the contract holds by running each gate against clean, drift, and error fixtures and asserting the expected exit.

**Enforcement:** scripts/check-exit-code-contract.mjs (L1 gate) — exits 1 on violation; scripts/self-validation.mjs (L2 A/B/C drill) — exits 1 if any gate fails its proof

---

### INV-54: SSOT core set integrity — all listed files must exist

Every file listed in docs/METHOD/SSOT_CORE_SET.md must exist on disk. The gate exits 1 if any listed file is missing. Bootstrap mode: if SSOT_CORE_SET.md itself is absent, the gate exits 0 and skips.

**Enforcement:** scripts/check-ssot-core.mjs (L1 gate, #255)

---

### INV-55: Doc-links integrity — all markdown links must resolve

Every local markdown link in docs/ must resolve to an existing file. Before failing, the gate checks CANONICAL_PATHS.md for a redirect alias. Links in .docs-links-ignore are exempt. Bootstrap mode: if no docs/ files are found, the gate exits 0.

**Enforcement:** scripts/check-doc-links.mjs (L1 gate, #255)

---

### INV-56: Knowledge-map freshness — line counts must not drift beyond tolerance

Every **Lines:** entry in docs/METHOD/KNOWLEDGE_MAP.md must match the actual line count of the referenced document within ±30% tolerance. Lines: 0 entries are skipped (not yet populated). Missing referenced files are skipped. Run knowledge-map-update.mjs to refresh counts.

**Enforcement:** scripts/check-knowledge-map.mjs (L1 gate, #255)

---

### INV-57: Canonical-paths integrity — all redirect targets must exist

Every redirect target in docs/METHOD/CANONICAL_PATHS.md must exist on disk. A dangling alias (target missing) causes the gate to exit 1. Bootstrap mode: if CANONICAL_PATHS.md is absent, the gate exits 0.

**Enforcement:** scripts/check-canonical-paths.mjs (L1 gate, #255)

---

### INV-58: Node version SSOT — .nvmrc is canonical; all CI jobs use node-version-file

.nvmrc at the repo root is the single source of truth for the Node.js version. All GitHub Actions workflows must use `node-version-file: '.nvmrc'` — never a literal version pin. The same applies to all EJS templates that emit CI workflows. process.version major at runtime must match .nvmrc major. Enforced by scripts/check-node-version-ssot.mjs (L1 gate, #470).

**Enforcement:** scripts/check-node-version-ssot.mjs (L1 gate, #470)

---

### INV-59: Gate result parity — local L1 static gates must produce the same pass/fail pattern as CI

check-all.mjs emits a gate result JSON to .arbiter/gate/local-result.json on every run (schema: arbiter-gate-v1). The parityContentHash field is a sha256 of the static L1 gate subset (27 gates, sorted by name; excludes commitlint, docs, unit tests which differ structurally between local and CI environments). The CI gate-aggregation job runs check-all.mjs L1 --json gate-result.json and uploads it as an artifact named gate-result. scripts/check-local-ci-parity.mjs (L2 gate) downloads the latest CI artifact via gh CLI and compares parityContentHash. A mismatch means local and CI disagree on a static check — a prerequisite violation for features.soloDevMode (#470). Skip (exit 0) when gh CLI is unavailable or no CI artifact exists.

**Enforcement:** scripts/check-local-ci-parity.mjs (L2 gate, #470) — exits 1 on hash mismatch; scripts/check-all.mjs --json flag emits the artifact that check-local-ci-parity.mjs reads

---

### INV-96: Fail-closed default — every gate, hook, check, and generator blocks on uncertainty

Doctrine: arbiter's gates default to block-on-uncertainty, never skip-on-uncertainty. Every script under scripts/, .githooks/, and .claude/hooks/ (and their EJS templates under src/templates/) must: (a) translate unhandled errors into a non-zero exit — node scripts wrap their entry block in try/catch with process.exit(1) or consume runCheck/runWarnCheck/runToolCheck from scripts/lib/run-helpers.mjs; bash scripts start with `set -euo pipefail`; (b) treat missing required inputs as failure with a diagnostic line; (c) reject silent bypass — any opt-out must be a loud env var with a logged reason (see Port #10 loud-bypass contract); (d) avoid the documented anti-patterns: `|| true` on critical paths, swallowed `catch {}` blocks, default-true booleans without explicit fallback. Legitimate fail-open paths must carry a `# FAIL-OPEN-INTENT: <reason>` (bash) or `// FAIL-OPEN-INTENT: <reason>` (node) comment on the line above the construct; reviewers must challenge the reason. Pre-existing non-conformant scripts are grandfathered in scripts/data/fail-closed-baseline.json — the baseline is a debt ledger, not a bypass. The gate hard-fails only when a NEW file (not in the baseline) violates the contract. See docs/SYSTEM/FAIL_CLOSED.md for the full doctrine, contract, and anti-pattern catalogue.

**Enforcement:** scripts/check-fail-closed-audit.mjs (L2 gate) — exits 1 when a new file outside the baseline violates the fail-closed contract; doctrine at docs/SYSTEM/FAIL_CLOSED.md

---

### INV-94: Script catalog cohesion — new gate scripts must justify their existence

Doctrine: the `scripts/check-*.mjs` namespace is a finite, human-readable catalog, not a graveyard. Every gate script added since the catalog baseline was frozen MUST carry a `// CATALOG:` header block (≥3 contiguous comment lines beginning with `// CATALOG:`) that (a) names what behaviour the script aggregates, (b) names which sibling scripts were considered and rejected as a fold-in target, and (c) cites a concrete reason the new file is preferable to extending an existing one. Pre-existing scripts are grandfathered through `scripts/data/script-catalog-baseline.json` — the baseline is a debt ledger captured once and only widened deliberately. The cohesion gate hard-fails when a script outside the baseline lacks the marker. It also emits a soft warning when the total `scripts/check-*.mjs` count exceeds the baseline by more than 5, signalling that a refactor pass is overdue before the next addition. The marker convention is paraphrased from the `// FAIL-OPEN-INTENT:` pattern used by INV-96 — both are intent-declaring comments enforced at gate time.

**Enforcement:** scripts/check-script-cohesion.mjs (L2 gate) — exits 1 when a new file outside the baseline lacks a `// CATALOG:` marker block; emits a warning (still exit 0) when the catalog grows by more than 5 scripts past the baseline; promoted from CANON-21

---

### INV-27: Evidence artifacts must be generated for all gate runs

Every gate run must emit its evidence artifacts (`.evidence/SUMMARY.json` and friends) so pass/fail decisions are auditable after the fact rather than asserted.

**Enforcement:** CI (evidence collection step)

---

### INV-28: SSOT documents must not contradict — run drift check before merge

Single-source-of-truth documents must agree; a drift check runs pre-merge so contradictory SSOT edits cannot land together.

**Enforcement:** CI (drift check / pre-merge hook)

---

### INV-33: L4 merges require valid evidence with obs_gate == PASS

At governance level L4 a merge is permitted only when the evidence summary validates and `obs_gate == PASS` — no green-by-assertion.

**Enforcement:** check-all.mjs L4 block (reads `.evidence/SUMMARY.json`) + nightly `evidence-collect.mjs` + `src/evidence/summary.ts` validator

---

### INV-72: File-lock semantics — process-bound exclusive lock with bootId + pid + cmd

Any `.arbiter/` mutator must take a process-bound exclusive lock keyed by bootId + pid + cmd, so a crashed process's stale lock is detectable and recoverable rather than wedging the repo.

**Enforcement:** doctor health check + code review for any new `.arbiter/` mutator

---

### INV-107: docs/ADR/ is the canonical ADR SSOT — numbers unique, canonical_id populated, README in sync

Every numbered ADR file in `docs/ADR/` must have a unique number and a populated `canonical_id`, and the README index must list it. `docs/ADR/` is the single source for architectural decisions.

**Enforcement:** scripts/check-adr-index.mjs (unique numbers, canonical_id match, README in sync)

---

### INV-108: SSOT core set exhaustiveness — every qualifying doc must be listed

Every document that qualifies for the SSOT core set (per the `selectSsotDocs` predicate) must be listed in the core index, so the index cannot silently omit a governing doc.

**Enforcement:** scripts/check-ssot-core.mjs

---

### INV-110: GLOBAL_INVARIANTS.md must document every always-active invariant — coverage parity

This document is the deep-reference companion to AGENTS.md. Every always-active invariant in the catalog must have a `### INV-NN` section here (no silent coverage gap), and every section here must point at a real catalog entry (no phantom). Mirrors the AGENTS.md↔catalog parity gate (CANON-08) for the companion doc.

**Enforcement:** scripts/check-global-invariants-parity.mjs (L1)

---
