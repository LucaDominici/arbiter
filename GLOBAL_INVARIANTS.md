---
title: 'arbiter — Global Invariants Reference'
doc_version: '1.0.0'
status: active
last_review: '2026-06-30'
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

**Enforcement:** CI dep-audit step per stack — TypeScript: `npm audit --omit=dev --audit-level=high`; Rust: rustsec/audit-check action; Java/Kotlin: trivy fs --scanners vuln --severity HIGH,CRITICAL --exit-code 1 (suppressions: .trivyignore); Go: golang/govulncheck-action; Python: pip-audit. Local gate (L2 block): same commands, soft: graceActive

**Minimum governance level:** L2+

---

### INV-14: No dynamic code execution with untrusted input

Dynamic code or shell execution using untrusted input is a critical injection vulnerability. Never pass user-controlled data to dynamic evaluation or shell-execution mechanisms without sanitization.

**Typescript guidance:** No dynamic code evaluation (`eval` function or `Function` constructor) with untrusted input

**Enforcement:** code review / SAST (semgrep / CodeQL)

**Minimum governance level:** L2+

---

### INV-15: Authentication required at every entry point

Every API endpoint, message consumer, and job scheduler must authenticate the caller unless explicitly designated as public. Default-deny authentication; explicit opt-out requires ADR approval.

**Enforcement:** code review / integration tests

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

### INV-44: SpotBugs security-category bugs MUST NEVER be suppressed or baselined

Java projects generated by arbiter receive scripts/verify-spotbugs.mjs which enforces a hard-block list of security bug types that fail the gate immediately, regardless of baseline state or --update-baseline flag. The hard-block list covers: SQL_INJECTION, SQL_INJECTION_SPRING_JDBC, XSS_REQUEST_WRAPPER, XSS_SERVLET, COMMAND_INJECTION, XXE_DOCUMENT, XXE_XMLREADER, LDAP_INJECTION, HARD_CODE_PASSWORD. Non-security findings may be baselined in spotbugs-baseline.json after review.

**Enforcement:** src/templates/scripts/verify-spotbugs.mjs.ejs (SECURITY_HARD_BLOCK set + exit 1) + src/templates/scripts/check-all.mjs.ejs (spotbugs baseline check at L2, Java)

**Minimum governance level:** L2+

---

### INV-74: Anti-bot human-approval gate — reviewer must be a human distinct from the PR author

The 03-human-approval.yml workflow applies the approved-by-human label only when three conditions pass: (1) reviewer is not the PR author, (2) reviewer is not a Bot, (3) review state is approved. The 01-pr-fast.yml human-approval-required sentinel job asserts this label is present before merge, blocking bot-only approvals.

**Enforcement:** generated: 03-human-approval.yml triple-check + 01-pr-fast.yml human-approval-required job

**Minimum governance level:** L2+

---

### INV-76: SHA-pinned actions only — all third-party GitHub Actions must be pinned to a full 40-char SHA

Tag-pinned or branch-pinned third-party actions (e.g. actions/checkout@v4) are a supply-chain attack vector: the tag can be moved after review. Every uses: reference to a non-local action must resolve to a full 40-character lowercase hex SHA. At L1: violations emit a warning. At L2+: violations are a hard gate failure.

**Enforcement:** self: scripts/check-action-pins.mjs (L1 — transition warn until W10 #886) + generated gate: check-action-pins.mjs.ejs (target projects: L1=warn, L2+=hard fail)

**Minimum governance level:** L2+

---

### INV-77: Top-level workflow permissions — every workflow file must declare explicit top-level permissions

Workflows without a top-level permissions: block inherit the repository default, which is often write-all. Declaring permissions: at the top of every workflow file enforces the principle of least privilege and satisfies the OSSF Scorecard Token-Permissions check.

**Enforcement:** generated gate: check-workflow-perms.mjs (L1)

**Minimum governance level:** L2+

---

### INV-78: SLSA provenance present at T3 — release workflow must emit signed build provenance

Every release workflow (05-release.yml) must invoke slsa-framework/slsa-github-generator to produce SLSA provenance. L2 governance targets SLSA Build L2 (signed provenance). L3 governance targets SLSA Build L3 (hermetic builder). Provenance is attached to the GitHub release as a verifiable attestation alongside the signed artifact.

**Enforcement:** generated: 05-release.yml slsa-github-generator reusable workflow call

**Minimum governance level:** L2+

---

### INV-79: Cosign sign-blob present for every release artifact

Every artifact published by the release workflow (jars, binaries, wheels, images, tarballs) must be signed with cosign sign-blob using keyless OIDC signing via Sigstore. Unsigned release artifacts cannot be verified by downstream consumers and fail supply-chain audits.

**Enforcement:** generated: 05-release.yml cosign sign-blob per archetype publish job

**Minimum governance level:** L2+

---

### INV-91: AI-PR human-approval gate

Bot-authored PRs (github.event.pull_request.user.type == "Bot") must be reviewed and approved by a human before merge. Approval is signaled by the "approved-by-human" label applied by \_label-on-approve.yml (idempotent, rejects bot reviewers and self-reviews). \_ai-draft-check.yml asserts the label presence on every label/sync event. Complements INV-74 which enforces the label requirement regardless of PR author type.

**Enforcement:** generated: \_ai-draft-check.yml workflow + \_label-on-approve.yml workflow

**Minimum governance level:** L2+

---

### INV-92: Supply chain — keyless signing, SBOM attestation, and Trivy CRITICAL block

Release artifacts must be signed with cosign keyless (OIDC via Sigstore) and attested with a CycloneDX SBOM via cosign attest --predicate. Trivy must scan the filesystem for CRITICAL vulnerabilities (exit-code: 1) before the signing step runs. HIGH vulnerabilities are reported but do not block (target projects may have legacy deps). A \_sigstore-retry-sign reusable workflow is also generated as opt-in scaffolding for retry-on-flake signing; the live 05-release cosign-sign job signs inline and does not yet delegate to it (#1663), so retry-on-flake is available to wire in, not yet active.

**Enforcement:** generated: 05-release.yml (trivy-fs-scan + cosign-sign + sbom jobs)

**Minimum governance level:** L2+

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

Every suppression entry — both file-based (.trivyignore, .gitleaksignore, pii-allowlist.json, archunit-baseline.json) and inline comment directives (arbiter-suppress(INV-NN, until=YYYY-MM-DD, reason=..., owner=@handle)) — must carry mandatory metadata: reason (≥10 chars), owner (@github-handle), and expiresAt/until (ISO date). Entries with a past expiry block the L1 gate. There are no permanent suppressions — waivers must be renewed or removed when the underlying issue is resolved.

**Enforcement:** CI gate (scripts/check-suppressions.mjs + scripts/check-inline-suppressions.mjs — L1) + pre-commit hook

---

### INV-32: Every 'proven' language must have a nightly real-project fixture

Arbiter's cross-language-matrix.json tracks tool maturity per language. A 'proven' rating implies the tool chain works end-to-end on real projects. Every language that carries at least one 'proven' cell must have a corresponding fixture under **tests**/fixtures/real-projects/ so the nightly real-project-matrix workflow can exercise the full arbiter pipeline (init → verify → check-all) against it. Promoting a language to 'proven' without a fixture is rejected by the L1 gate.

**Enforcement:** CI gate (scripts/check-matrix-fixtures.mjs — L1) + nightly real-project-matrix workflow

---

### INV-36: Hook hardness manifest — every hook must declare intent; HARD hooks must empirically block

Every hook in src/templates/claude/hooks/ must be declared in .arbiter/hooks-manifest.json, and every hook in the project's own materialized .claude/hooks/ in .arbiter/self-hooks-manifest.json, with an explicit classification (HARD | ADVISORY). HARD hooks must empirically exit 2 — the only blocking code under the Claude Code hook protocol — on a canonical violation fixture. Any hook file without a manifest entry, or any HARD hook that fails to block, fails CI. This prevents silent ceremony regression — where a hook is declared hard but silently exits 0 (or exits 1, which prints without blocking). Both surfaces are required: #2324 was a defect present ONLY in the materialized copy, invisible to every template-scoped check (#2326).

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

**Enforcement:** scripts/check-self-dogfood.mjs (L1 gate check, promoted from L2 by #1744) — exits 1 on unexpected drift

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

Every file listed in docs/internal/METHOD/SSOT_CORE_SET.md must exist on disk. The gate exits 1 if any listed file is missing. Bootstrap mode: if SSOT_CORE_SET.md itself is absent, the gate exits 0 and skips.

**Enforcement:** scripts/check-ssot-core.mjs (L1 gate, #255)

---

### INV-55: Doc-links integrity — all markdown links must resolve

Every local markdown link in docs/ must resolve to an existing file. Before failing, the gate checks CANONICAL_PATHS.md for a redirect alias. Links in .docs-links-ignore are exempt. Bootstrap mode: if no docs/ files are found, the gate exits 0.

**Enforcement:** scripts/check-doc-links.mjs (L1 gate, #255)

---

### INV-56: Knowledge-map freshness — line counts must not drift beyond tolerance

RETIRED (#1244): the bespoke knowledge-map (its index doc, updater, and freshness gate) was removed; Obsidian now reads the generated wiki. No line-count tolerance is enforced any longer. The ID is preserved as a tombstone per ID-STABILITY (never deleted or reused).

**Enforcement:** none — retired invariant; no successor.

---

### INV-57: Canonical-paths integrity — all redirect targets must exist

Every redirect target in docs/internal/METHOD/CANONICAL_PATHS.md must exist on disk. A dangling alias (target missing) causes the gate to exit 1. Bootstrap mode: if CANONICAL_PATHS.md is absent, the gate exits 0.

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

Doctrine: arbiter's gates default to block-on-uncertainty, never skip-on-uncertainty. Every script under scripts/, .githooks/, and .claude/hooks/ (and their EJS templates under src/templates/) must: (a) translate unhandled errors into a non-zero exit — node scripts wrap their entry block in try/catch with process.exit(1) or consume runCheck/runWarnCheck/runToolCheck from scripts/lib/run-helpers.mjs; bash scripts start with `set -euo pipefail`; (b) treat missing required inputs as failure with a diagnostic line; (c) reject silent bypass — any opt-out must be a loud env var with a logged reason (see Port #10 loud-bypass contract); (d) avoid the documented anti-patterns: `|| true` on critical paths, swallowed `catch {}` blocks, default-true booleans without explicit fallback. Legitimate fail-open paths must carry a `# FAIL-OPEN-INTENT: <reason>` (bash) or `// FAIL-OPEN-INTENT: <reason>` (node) comment on the line above the construct; reviewers must challenge the reason. Pre-existing non-conformant scripts are grandfathered in scripts/data/fail-closed-baseline.json — the baseline is a debt ledger, not a bypass. The gate hard-fails only when a NEW file (not in the baseline) violates the contract. See docs/internal/METHOD/ENGINEERING_DEFAULTS.md for the full doctrine, contract, and anti-pattern catalogue.

**Enforcement:** scripts/check-fail-closed-audit.mjs (L2 gate) — exits 1 when a new file outside the baseline violates the fail-closed contract; doctrine at docs/internal/METHOD/ENGINEERING_DEFAULTS.md

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

**Enforcement:** check-all.mjs L3+ evidence-gate block (reads `.evidence/SUMMARY.json`) + generated `scripts/evidence-collect.mjs` producer + `src/evidence/summary.ts` validator

---

### INV-72: File-lock semantics — process-bound exclusive lock with bootId + pid + cmd

Any `.arbiter/` mutator must take a process-bound exclusive lock keyed by bootId + pid + cmd, so a crashed process's stale lock is detectable and recoverable rather than wedging the repo.

**Enforcement:** doctor health check + code review for any new `.arbiter/` mutator

---

### INV-73: CI tier presence — all 8 workflow files must exist under .github/workflows/

Every GitHub-enabled project must contain exactly the canonical 8 CI tier files: 01-pr-fast.yml, 02-pr-extended.yml, 03-human-approval.yml, 05-release.yml, 06-nightly.yml, 07-weekly.yml, 08-monthly.yml, 09-heartbeat.yml. Missing tiers degrade the deployment pipeline and break branch-protection required checks.

**Enforcement:** scripts/check-ci-tiers.mjs (L1 gate)

---

### INV-107: docs/internal/ADR/ is the canonical ADR SSOT — numbers unique, canonical_id populated, README in sync

Every numbered ADR file in `docs/internal/ADR/` must have a unique number and a populated `canonical_id`, and the README index must list it. `docs/internal/ADR/` is the single source for architectural decisions.

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

### INV-111: CLI reference must document every registered command — no phantom, no missing

`website/reference/cli.md` hosts a machine-generated command-reference region (between `<!-- BEGIN GENERATED:cli -->` / `<!-- END GENERATED:cli -->` markers). Every top-level command registered in `src/cli.ts` must have a section in that region, and every section must correspond to a registered command (bidirectional). Hand-written prose outside the markers is preserved on every regeneration. Drift is caught at L1 by the gate. Applies to arbiter-self only (`selfOnly`).

**Enforcement:** scripts/gen-cli-ref.mjs --check (L1)

---

### INV-112: RTM/FEATURE_MATRIX required at L2+; serious-test DoD at L3+; 21CFR audit-trail at L4

Every project at L2+ must ship and maintain a `docs/FEATURE_MATRIX.md` (RTM) covering 100% of its KIT catalog dimensions. The matrix uses a fail-closed status ladder: `Missing` (issue_ref required) → `Partial` (code_ref required) → `Done` (code_ref+test_ref+doc_ref required) → `Verified` (all four refs + test title parsed). At L3+, every Done/Verified row must reference a real test title (serious-test DoD proxy). At L4, `audit_trail`-category rows must carry code_ref+test_ref. The generator (`src/generators/feature-matrix.ts`) scaffolds the initial matrix; the committed doc is the authoritative Product-Truth source.

**Enforcement:** scripts/check-feature-matrix.mjs (L1, fail-closed): validates status ladder, KIT-dim coverage, counter integrity, ref existence, and level-gated DoD rules. Generated for target projects at L2+ by `src/generators/feature-matrix.ts` (CANON-23).

---

### INV-113: Single authoritative task-phase document — no split-brain dotfiles

Task lifecycle state is sourced from ONE authoritative document pair: `.claude/.task/status.json` (structured phase + step-cursor + metadata) and `.claude/.task/log.md` (append-only digest). The legacy split-brain — flat `.claude/.task-*` dotfiles plus a per-id status.json that froze at `phase:red` — is abolished. All phase writes route through one atomic read-modify-write so the document can never diverge, and every reader (engine, generated hooks, shell consumers) reads the unified document. No source or template code may read or write the legacy flat dotfiles; only the migration shim `src/commands/task-state.ts` may name them (to consume-and-delete during migration).

**Enforcement:** scripts/check-phase-doc-consistency.mjs (L1): scans `src/**` for legacy `.task-*` dotfile-name literals (allowlisting the migration shim) and validates `.claude/.task/status.json` well-formedness when present. Wired into scripts/check-all.mjs L1.

---

### INV-114: Fail-closed Stop gate — completion claims require correlated evidence

On a `task/` or `ship/` branch whose phase is not yet `complete`, an agent may not end its turn claiming completion (task complete / ready to merge / pr merged …) unless three evidence artifacts exist AND correlate to the current branch and HEAD sha: (1) the plan-review `latest.json` with verdict PASS, recorded on this branch at a commit that is an ancestor of HEAD; (2) the agents-dispatched sidecar (`.arbiter/agents-dispatched.json`) on this branch at an ancestor commit; (3) the gate-pass marker (`.arbiter/gate-pass.json`) on this branch with `head_sha` STRICTLY equal to HEAD (the exact tree was verified). A claim with any missing or stale artifact is blocked. Every other path — no claim, unreadable transcript, non-task branch, phase complete, hook re-entry — stands down. This is the backstop the soft UserPromptSubmit completion guard cannot be: it observes the agent's own stop, not the next user prompt.

**Enforcement:** `.claude/hooks/stop-evidence-guard.mjs` (Claude Code `Stop` event, exit 2 = block-the-stop and return stderr to the model). Generated for target projects at L2+ by `src/generators/claude.ts` and dogfooded in arbiter's own `.claude/` (CANON-01/14). Evidence writers (`scripts/check-all.mjs` for the gate-pass marker; the `/task`/`/ship` command playbooks in `.claude/commands/` for the plan-review and agents-dispatched sidecars) stamp branch+sha so correlation is possible. Empirical coverage: `__tests__/hooks/empirical/stop-evidence-guard.test.ts`.

---

### INV-115: Free-text governance prohibitions must resolve to a verified enforcer, live scan, or explicit triage

Every hard prohibition declared in free-text governance (AGENTS.md, CANON.md, CLAUDE.md) via a directive marker (NEVER / MUST NOT / DO NOT / 🛑 / `No <tok>` / `never <tok>`) must resolve to exactly one honest state — it may not be merely asserted in prose. (1) **COVERED**: mapped in `scripts/constraint-map.json` to an enforcer whose existence is verified at scan time (gate→referenced in check-all.mjs, hook→file under .claude/hooks, inv→id in catalog.ts, lint→rule in an eslint config, template→path under src/templates); a map entry naming a missing enforcer is MAP-FICTION and fails the gate (the CANON-23 fiction guard). (2) **ENFORCED-BY-SCAN**: a derivable code token, live-grepped against source every run — the scan itself is the wiring. (3) **UNENFORCEABLE**: prose / path / non-code token surfaced for human triage. Extends CANON-09 (claimed-enforcement = wired-gate) from invariant citations to free-text prohibitions.

**Enforcement:** `scripts/check-constraint-scan.mjs` (L1 gate, wired in scripts/check-all.mjs): extracts directive prohibitions, classifies via `scripts/constraint-map.json` with enforcer-existence verification, hard-fails on a live un-covered derivable violation or a map-fiction entry. Emitted for target projects as `src/templates/scripts/check-constraint-scan.mjs.ejs` (warn-default, `--enforce` to promote) and dogfooded on arbiter's own governance (CANON-01/14). Empirical coverage: `__tests__/scripts/check-constraint-scan.test.ts`. Note: COVERED asserts enforcer-existence at scan-time (the enforcer file/gate/hook/rule exists), not gate-time absence-of-violation — a mapping like `child_process` → `hook:check-no-direct-spawn.mjs` is valid because the hook fires on every write; the scan verifies the hook exists.

---

### INV-116: wiki/ must be free of broken wikilinks, orphan pages, stale source hashes, and missing citations

The generated LLM-wiki (wiki/) must pass four lint dimensions: broken-link (every [[WikiPage]] reference resolves to an existing wiki/{page}.md), orphan (every page reachable from INDEX.md via wikilinks; INDEX.md itself exempt as root), stale (page source_sha matches current git hash of its source file), and citation (every page has a non-empty source: frontmatter field pointing to a git-tracked path). Exit 0 on bootstrap (wiki/ absent or empty). Karpathy LLM-Wiki pattern: static compiler from existing docs, citations mandatory, non-authoritative (SSOT/invariants/ADR win on conflict). selfOnly: true because target projects may not generate wiki/ pages (#1241).

**Enforcement:** `scripts/check-wiki-lint.mjs` (L2 gate, wired in scripts/check-all.mjs): validates all 4 lint dimensions; exits 0 on bootstrap. Emitted for target projects as `src/templates/scripts/check-wiki-lint.mjs.ejs` (CANON-01/14). Empirical coverage: `__tests__/gates/wiki-lint-fixture.test.ts` (planted-break per dimension).

---

### INV-117: arbiter self-repo must not track binary build artifacts

The arbiter repository must not commit binary build artifacts. npm pack outputs (.tgz) bloat git history permanently and are unreproducible from source. selfOnly: true because consumer projects use diverse packaging (maven jars, python wheels, Go binaries, Docker images) — a blanket .tgz prohibition would incorrectly block legitimate non-JS packaging workflows (#1217).

**Enforcement:** `scripts/check-no-tracked-artifacts.mjs` (L1 gate, selfOnly — arbiter self-governance only). Uses `git ls-files` to detect tracked .tgz and .tar.gz files. Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR. Wired in `scripts/check-all.mjs`.

---

### INV-118: Anti-proforma test gate — every test must carry a real assertion

Test methods (it(), test(), @Test, @ParameterizedTest, @RepeatedTest) must contain at least one recognized assertion. Proforma tests (no assertions) provide false confidence — they always pass regardless of the code under test (§R-41). JVM: enforced via ArchUnit bytecode scan (AntiProformaTest.java, L2+). TypeScript/other: enforced via source-text regex scan (check-anti-proforma.mjs, L1+, warn-default). Bypass: @AntiProformaExempt("rationale") (JVM) or `// anti-proforma-exempt: rationale` (other stacks). Bypass ratio >5% triggers EXEMPT-THRESHOLD alarm (#1249).

**Enforcement:** `scripts/check-anti-proforma.mjs` (L1+ gate, warn-default; `--enforce` promotes to hard-block). JVM: `src/templates/archunit/AntiProformaTest.java.ejs` (L2+, hard-block via ArchUnit bytecode scan). Exit codes per INV-53: 0=PASS/WARN, 1=FAIL (--enforce), 2=ERROR. Wired in `scripts/check-all.mjs`.

---

### INV-119: Commit-footer audit evidence required for suppression/override/bypass commits

Commits that touch suppression/bypass files (\*.trivyignore, owasp-suppressions.xml, pitest-override configs, sigstore-bypass configs, suppressions/\*\*) in the origin/main..HEAD range must carry at least one recognized immutable commit-footer trailer (§11.10(e)). Recognized trailers: Suppression-Rationale:, Pitest-Override-Rationale:, Trivy-Expiry-Extension:, Sigstore-Bypass:. Evidence artifact written to .arbiter/evidence/commit-footer-audit/<timestamp>.json. Hard-blocks on missing trailer (exit 1). Git failure → exit 0 with WARN (fail-open when origin/main unavailable) (#1249).

**Enforcement:** `scripts/check-commit-footer-rationale.mjs` (L2+ gate, hard-block). Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR. Wired in `scripts/check-all.mjs` (gate block, not check block).

---

### INV-120: Workflow needs-chain depth must not exceed the configured limit (parallelism regression gate)

CI workflow job dependency chains (critical path depth, measured as edge count in the needs: DAG) must not regress beyond per-workflow thresholds. Default limit: 3 edges. Per-file overrides: 01-pr-fast ≤3 (Java Maven path uses 3 edges), 05-release ≤4 (cosign/sbom-attest chain), nightly/weekly/monthly ≤5. Aggregator sinks (jobs with `if: always()`) are excluded — they are pure status barriers, not wall-clock critical-path contributors. selfOnly: prevents arbiter's own generated CI from undetected chain regression (#1231).

**Enforcement:** `scripts/check-workflow-parallelism.mjs` (L1 gate, selfOnly). Configurable via `ARBITER_MAX_NEEDS_CHAIN` env. Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR. Wired in `scripts/check-all.mjs` (check block, L1).

---

### INV-129: No tracked data/state files or compiled binaries in the index

Neither the arbiter repo nor any governed target project may track data/state files (`*.sqlite`, `*.sqlite3`, `*.db`, `*.db-shm`, `*.db-wal`) or compiled binaries (ELF / Mach-O / PE, detected by MAGIC BYTES) in the git index. Distinct from INV-117 (which is the selfOnly `*.tgz` build-artifact axis, kept unchanged): INV-129 is the DATA/STATE axis and applies downstream too. It is load-bearing because of the three-way security split — a committed `finance.sqlite` trips **neither** gitleaks (no secret pattern) **nor** the PII scan (which skips binaries by extension), so without this gate a database of records sits in history undetected. Binary detection is magic-byte-primary (a renamed Go/Rust binary cannot evade it); go.mod / cargo names are a secondary hint only. Allowlist for intentional binaries: `__tests__/fixtures/**` path prefixes plus font/image/`.wasm`/`.pdf` extensions. Fail-closed: a non-git tree is an ERROR (exit 2), never a silent NO-DATA pass (#1407/#1408).

**Enforcement:** `scripts/check-no-tracked-artifacts.mjs` (L1 gate, self — extended for data/state globs + magic-byte binary detection). Downstream: emitted for governed targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-no-tracked-artifacts.mjs.ejs` (CANON-01/04/11), wired at L1 in the generated `scripts/check-all.mjs`. Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR.

---

### INV-133: TODO max-age — a linked TODO whose issue is older than the max age ages out

A `TODO(#NNN)` linked to an issue created more than the max age ago (default 180 days, `TODO_MAX_AGE_DAYS` override) is reported as over-age. Age derives from the issue `created_at` (resolved via `gh api`, cached per issue), so re-touching the TODO line leaves its age unchanged. Complements INV-21: INV-21 keeps a TODO traceable, INV-133 ages a traceable TODO out. Graceful skip (exit 0) when gh is absent, the token is missing, the host is offline, or `created_at` is unresolvable — a genuinely over-age issue is the only failing condition.

**Enforcement:** `scripts/check-todo-max-age.mjs` (L2, self) + emitted for governed targets via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS from `src/templates/scripts/check-todo-max-age.mjs.ejs` (CANON-01/04/11), wired at L2 in the generated and self `scripts/check-all.mjs`. Exit codes per INV-53: 0=PASS/SKIP, 1=FAIL, 2=ERROR.

---

### INV-138: Acceptance-criteria anchor — plans freeze issue AC; fit is evidenced per criterion

A green gate certifies mechanics (tests pass, lint clean), never intent — rework lives in the gap between "green" and "what was asked". The anchor closes that gap in three steps. (1) **Entry gate:** an issue enters a wave / ship preflight only when its body carries explicit `AC-N:` acceptance criteria (beyond template stock lines and unreplaced placeholders), a Non-goals section, and the files/contracts it touches; otherwise it is labeled `needs-clarification` with a generated checklist comment and excluded (`issue-readiness.mjs`, orchestration-time, gh allowed — deliberately not a gate step). (2) **External DoD anchor:** during implementation phases the active task plan freezes the issue AC verbatim under `## Acceptance Criteria` (stable explicit `AC-N` ids) plus `## Non-Goals`, so acceptance tests derive from the issue rather than the implementing agent grading its own interpretation; test titles cite the ids. (3) **Fit evidence:** at verification/close the reviewer-written `.arbiter/evidence/ac-fit/<task>.json` (schema `arbiter-ac-fit-v1`, committed) must cover every criterion with verdict PASS and a cited `file:line` — the mechanical form of "unproven criterion = REJECT". Rework telemetry (`rework-log.mjs`, committed `.arbiter/rework/ledger.jsonl`, merge=union) tags every redone PR with why × where-caught, so the issue template self-corrects. Flag-gated (`features.acceptanceAnchor` / `ARBITER_ACCEPTANCE_ANCHOR`) and vacuous without an active task; the AC↔test-title mapping stays a reviewer rubric, deliberately not a grep gate (CANON-22).

**Enforcement:** `scripts/check-acceptance.mjs` (L1, flag-gated, `--plan` mode for wave integrate; selfOnly — the orchestration tools are emitted to targets via UNCONDITIONAL_EMISSIONS, the gate wiring in generated check-all is the tracked ADR-110 follow-up) — wired `runCheck` in `scripts/check-all.mjs`. Pure core: `scripts/lib/acceptance-criteria.mjs`. Exit codes per INV-53: 0=PASS/SKIP, 1=FAIL, 2=ERROR.

---

### INV-139: Fixture and smoke output must never land in real evidence directories

A smoke or fixture run must never write into a real evidence root (`.arbiter/evidence`, `.evidence`). The origin is the #2176 `/ship-v2` study, where two contaminated runs carrying `fake-*` finding ids reached the real result set, passed every mechanical guard, and were caught only by the semantic judge. Detection is ANCHORED-SCALAR over parsed `.json`/`.jsonl`: whitespace-free string values and object keys matching `/^fake-/` or containing `STUDY_FAKE`, deliberately NOT a substring grep, because the live corpus legitimately carries 158 `fake-green`/`fake-db` occurrences inside multi-line diff and log blobs and a naive grep would be born red.

Unparseable documents are skipped, non-JSON artifacts are out of scope, and NO-DATA (no evidence roots) is a PASS so fresh clones and ungoverned repos never false-fail. The guard scans the FILESYSTEM rather than the git index so contamination is caught before it is committed; it is also enrolled in the anti-fake-green aggregate roster (class `file-scan`, so a broken guard fails the aggregate) with a planted bad/clean discrimination proof. selfOnly because `STUDY_FAKE` and bare `fake-` are arbiter-study vocabulary that would false-positive in an arbitrary target project — the Track-B mirror waits on a project-configurable marker set.

**Enforcement:** `scripts/check-fixture-isolation.mjs` (L1, self) — wired in `scripts/check-all.mjs` and enrolled in the anti-fake-green aggregate roster (`scripts/lib/anti-fake-green-guards.mjs`, class `file-scan`) with a discrimination proof in `scripts/lib/guard-flip-registry.mjs`. Verified by `__tests__/scripts/check-fixture-isolation.test.ts` (red→green). Exit codes per INV-53: 0=PASS/NO-DATA, 1=contamination, 2=ERROR.

---

### INV-140: Every identifier scheme is registered, collision-free, and its citations resolve

An identifier scheme that lives only in the heads of the people using it drifts into two schemes wearing one prefix. That happened twice here: `MN` meant both a product milestone and an agent-orchestration methodology measure, and `E1`–`E7` meant both an anti-context-rot enforcer and a gold-registry enforcement dimension — so a bare citation was ambiguous and no mechanism could say so. Worse, `OD-NN` was cited in a hook, two empirical tests and the advisory ledger with **no file defining it**, which makes an invented decision id indistinguishable from a real one.

`docs/internal/SYSTEM/ID-REGISTRY.md` declares every scheme in one machine-parsed block — prefix, anchored pattern, SSOT, gate, track, tool, hook, status. The gate proves no two schemes can match the same identifier (each pattern is expanded into a canonical sample and cross-matched against every other regex), that every declared SSOT resolves on disk, and that every `OD-NN` in the tree resolves to a row in `docs/internal/SYSTEM/OD-REGISTRY.md`. A `staged` row is a **dated** obligation: it names the wave that wires it and fails the gate once its `expires` passes — the dated-debt discipline of INV-31 applied to the ontology itself.

**Enforcement:** `scripts/check-id-registry.mjs` (L1, self) — wired in `scripts/check-all.mjs`, validating against `schemas/id-registry.schema.json` through the shared validator in `scripts/lib/agent-return-validate.mjs` (no second validator, CANON-16). Verified by `__tests__/scripts/check-id-registry.test.ts`. Exit codes per INV-53: 0=PASS, 1=violation, 2=ERROR.

---

### INV-141: No artifact type exists as documentation alone — every active scheme is wired

The failure this closes is the one every governance framework dies of: a rule is written, nothing runs it, and the document reads like coverage in an audit. For each `active` row in the ID registry the gate proves three legs are real — the gate script is registered on the side its `track` names (`scripts/check-all.mjs` for self, the declarative Track-B roster `src/templates/scripts/gate-registry.yml.ejs` for target, so a correctly-declined gate is never mistaken for an unwired one), the `tool` verb resolves to a `.command()` in `src/cli.ts`, and the `hook` file exists **and** is registered in `.claude/settings.json`, because an unregistered hook never fires.

`staged` rows are exempt by design — a stage is a dated obligation enforced by INV-140, not a second copy of the same failure — and are counted instead, against a monotone ratchet over the unwired legs. There is deliberately no `--allow-increase`: the count may fall freely, and raising it means hand-editing `scripts/data/ontology-baseline.json` in the same PR as the row that needs it, where the number lands in the diff beside its justification.

**Enforcement:** `scripts/check-ontology-wired.mjs` (L1, self) — wired in `scripts/check-all.mjs`, with the ratchet in `scripts/data/ontology-baseline.json`. Verified by `__tests__/scripts/check-ontology-wired.test.ts`. Exit codes per INV-53: 0=PASS, 1=violation, 2=ERROR.

---

### INV-142: An edited ontology artifact is schema-valid at edit time, not at merge time

A schema checked only in CI teaches the agent an hour late, after a commit and a push, when the cheapest moment to learn was the edit itself. One `PostToolUse` hook carries a table of registered instances — a path or directory prefix, the schema, and how to extract the document (the whole file, or a fenced JSON block between sentinels) — and validates whatever was just written, blocking with exit 2.

One hook rather than one per artifact is the point: each wave that lands an artifact type adds a single line to the table and that type becomes edit-time enforced for free. The hook fails **open** on its own infrastructure — if the validator or the schema cannot be loaded it exits 0 — because a guard that blocks an unrelated edit when its own dependency moved is a worse failure than the one it prevents; the CI gate remains the backstop.

**Enforcement:** `.claude/hooks/post-edit-artifact-schema.mjs` (`PostToolUse` → `Edit|Write`, self) — registered in `.claude/settings.json`. Exit 2 is the only blocking code under the hook protocol; exit 1 prints and the agent never sees it, which would make the guard decoration. Verified by `__tests__/hooks/post-edit-artifact-schema.test.ts`.

---

### INV-143: The arbiter <-> forma schema contract is pinned and gated on both sides

arbiter owns the governance ontology; forma owns the stack-agnostic C4 model shape and renders what arbiter defines. Two repositories sharing schemas by good intentions drift the first time either ships a change alone, and the drift surfaces as a visualiser silently rendering a model it half-understands.

`schemas/CONTRACT.json` names, for each shared schema, the owning repository, the path inside it, a sha256, and which repos vendor a pinned copy. Both repositories hold a byte-identical copy and each gates its own half: the owner re-hashes what it owns, the consumer re-hashes what it vendored. Editing a shared shape without re-pinning turns the owning repo red at once; a stale vendored copy turns the consuming repo red. When both checkouts sit side by side the gate also proves the two manifests are byte-identical and the sibling's live files still hash to the pin — and when they do not, that half **skips out loud** rather than passing in silence, because a cross-repo check that quietly does nothing is the exact failure the contract exists to prevent.

**Enforcement:** `scripts/check-forma-contract.mjs` (L1, self) — wired in `scripts/check-all.mjs`; forma runs the mirror `scripts/check-arbiter-contract.mjs` in its own CI and `npm test`. Verified by `__tests__/scripts/check-forma-contract.test.ts`. Exit codes per INV-53: 0=PASS, 1=violation, 2=ERROR.

---

### INV-144: The architecture document is a filled structure, not a surviving skeleton

arc42 is twelve enumerable slots, and a project that scaffolds one and never fills it has a document that answers no question while satisfying every presence check. Presence gates cannot see this: the file exists, it is fresh, and every section heading is there. What is missing is the content.

This invariant makes the structure addressable. `ARC-01`..`ARC-12` are parsed out of the architecture document, and every slot the arc42 skeleton for that project's tier column provides must be present in it — a section **deleted** from the document is a structural gap, not a simplification. The required set is **read** from the skeleton (`arc42-canvas` for the solo/small columns, `arc42-full` for enterprise, exactly as `src/generators/doc-set.ts` already decides) rather than restated in the gate, so the two can never hold different opinions about what a tier owes, and adding a section to a skeleton automatically makes it required of the projects that receive it. The converse is guarded by a second ratchet over the skeleton's **own** gaps against canonical arc42: without it, deleting a section from a skeleton would quietly lower the bar for every project downstream and the gate would report the weakened bar as a pass.

A hollow slot — a body that is nothing but the skeleton's prompt comment, or exactly one placeholder token — is **counted, not forbidden**. The count may fall freely and may never rise, so a section may be left unfilled but a new unfilled one may not be added; `--update-baseline` refuses a rise, which is the load-bearing property. With no baseline file at all the current count is recorded rather than failed: a freshly generated arc42 is hollow by construction, and a gate that made `arbiter init` produce a red repo would only teach people to delete the gate.

A stub is recognised **structurally**, not by keyword. The first design scanned for `TODO`/`TBD` markers; run over arbiter's own arc42 it produced three false positives, every one of them prose _about_ todo gates and a technical-debt count. Emptiness after stripping comments is the honest signal.

An adversarial review of the first implementation refuted its own Track-B claim, and the corrections are the substance of this invariant. Four of them are worth stating because each was a way the gate could have looked green while enforcing nothing:

- The engine was **not in `package.json` `files[]`**, so an installed arbiter resolved a path that did not exist and reported `MODULE_NOT_FOUND` as an arc42 _slot violation_. This had already happened once (#2335) and the guard written then was a hand-maintained list of literal paths, which is why it did not ratchet. `scripts/check-tarball-contents.mjs` now **derives** the required engines from the `scripts/*.mjs` literals in the files that call `packageRoot()`, so a new route to `engineFor()` cannot be added without shipping its script.
- Skeletons resolved from `src/templates/`, which exists only in a dev checkout; the package ships `dist/`. Resolution now probes source first, shipped second — correct in both layouts.
- The baseline was tolerated **in memory only**, so no governed project ever grew one and `allowed` was recomputed as "whatever it is today" on every run. The first clean run now writes it.
- `skeletonGaps` was a single scalar measured on the enterprise column, leaving the Canvas skeleton — the one solo and small projects receive, and the one arbiter's own CI never resolves — entirely unguarded. It is keyed per column now.

A counter that is present but not a number is an **ERROR**, not a bootstrap: `"stubs": "0"` is a two-character diff that reads as a formatting nit and would otherwise disable the ratchet permanently while `--json` kept reporting `baseline == stubs`, i.e. health.

**Enforcement:** `scripts/check-arc42-slots.mjs`. Self: L1, `runCheck`, unconditional, wired in `scripts/check-all.mjs`; ratchet in `scripts/data/arc42-baseline.json`. Track B is deliberately weaker and says so: the `gate-registry.yml.ejs` row is L2, `runWarnCheck`, gated on `enableDebtGates`, because a freshly generated arc42 is hollow by construction. Verified by `__tests__/scripts/check-arc42-slots.test.ts` (43 cases), which reads the real skeletons and a package-shaped `dist`-only layout rather than fixtures alone — a fixture that grades itself is what let the nine-vs-ten `CANVAS_SLOTS` drift go unnoticed. Exit codes per INV-53: 0=PASS, 1=violation, 2=ERROR.

### INV-145: Adversarial review closes only when nothing above low severity survives

One pass of review finds what one reader happened to look for. A high-stakes change is therefore attacked by independent skeptics carrying a REFUTE mandate, and the loop **repeats** — each hop attacking the fixes the previous hop forced — until no finding above `low` is left unaddressed.

This is the complement of the refutation-majority rule (E2 #1943, M13), not a duplicate of it. That rule stops a **phantom** finding being acted on; this one stops the loop **ending while something real is still open**. Both read the same skeptic envelopes, so the second axis needs no new artifact — only the obligation to keep hopping.

Three properties are load-bearing, and each was chosen against a specific failure:

- **Severity is the highest any skeptic assigned.** When two disagree, the loop clears the worse reading. Taking the kinder one would let a second opinion lower the bar.
- **Below quorum or majority-REFUTED never blocks.** Fixing the false negative must not reintroduce the false positive the majority rule exists to prevent: one skeptic's false alarm cannot hold a wave hostage.
- **The floor runs even when nothing was acted on.** A round that addressed nothing while the skeptics upheld a `high` is exactly what this catches — an early return there made it unreachable for its own subject, a bug found by its own tests rather than by review.

A hop that cannot reach an independent reviewer (model unavailable, rate limit, the cross-model seat offline) may be self-probed, but the marker carries `degraded: true`, the gate reports DEGRADED on every run, and the round never counts as independent. A self-review filed as an independent one is the fake-green this catalog exists to prevent. The strongest skeptic remains a **different model** (`crossModelReview`); the same-model fan-out is a declared fallback, weaker because its blind spots are correlated with the author's — see ADR-119.

**Enforcement:** `scripts/check-refutation-verdicts.mjs`, wired on both tracks as `refutation majority (E2 #1943)` — `runWarnCheck` in `scripts/check-all.mjs`, a row in `src/templates/scripts/gate-registry.yml.ejs`, and the engine itself emitted via `src/templates/scripts/check-refutation-verdicts.mjs.ejs` (kept byte-identical). Marker-gated. Verified by `__tests__/scripts/check-refutation-verdicts.test.ts` (15 cases, tamper-proven in both directions). Exit codes per INV-53: 0=PASS, 1=violation, 2=ERROR. CANON-24.

---

### INV-146: A milestone is done only when its exit criteria carry evidence

A roadmap in prose cannot be wrong, because nothing reads it. Milestones are therefore a typed SSOT — `docs/internal/PRODUCT/MILESTONES.yml` — where each entry carries a GSN goal (the claim, plus the strategy by which its exit criteria are argued to establish that claim), exit criteria, dependencies and a Now/Next/Later horizon.

Three properties are enforced that a document cannot hold, and each was chosen against a specific failure:

- **The dependency graph is acyclic.** A plan that quietly requires itself is unschedulable, and no reader of a prose roadmap has ever caught one. The gate reports the cycle **as its path** (`MS-01 -> MS-02 -> MS-01`), because "a cycle exists" is a puzzle rather than a defect report.
- **Granularity decays with distance.** `due` is required for `now`, optional for `next`, and **forbidden** for `later`. A date on a milestone nobody has scoped is false precision, so the schema refuses it rather than trusting a convention readers are expected to follow. This rule is enforceable only since #2509 taught the shared validator `if`/`then`/`not` — before that it was a schema keyword that never ran, which is the failure mode this whole programme exists to eliminate.
- **`done` is fail-closed on evidence.** Every exit criterion of a `done` or `verified` milestone must cite a resolvable artifact, and `verified` requires those citations to actually resolve. This is the reason the gate exists: a roadmap whose `done` means "someone typed done" is not a weaker roadmap — it is a false claim with a schema around it.

The migration is **forward-only** by owner decision. The 33 historical `## MN` headings stay in the prose archive rather than having exit-criteria evidence reconstructed after the fact to satisfy the gate; inventing that evidence is exactly the fake-green the rule is built to stop. Accepted cost: no plan history before the SSOT existed.

A missing `MILESTONES.yml` **skips out loud** — a project need not have codified a roadmap, but a skip must never be mistakable for a pass, so it prints `[SKIP]` and surfaces as `verdict: "skip"` under `--json`.

**Enforcement:** `scripts/check-milestones.mjs`, wired on the self track as `milestones (INV-146)` via `runCheck` in `scripts/check-all.mjs`. Self-only for now, declared rather than left to be found: the `MS` scheme is `staged` in the ID registry with a dated expiry and the Track-B emission lands with it — claiming both tracks before that exists is the error INV-144 was caught making. Verified by `__tests__/scripts/check-milestones.test.ts` (42 cases), tamper-proven in both directions on every rule: a cycle, a dangling `depends_on`, a duplicate id, a `later` carrying a `due`, `done` without evidence and `verified` citing an unresolvable ref each fail, and the same tree with the defect removed passes. Exit codes per INV-53: 0=PASS or SKIP, 1=violation, 2=ERROR.

---
