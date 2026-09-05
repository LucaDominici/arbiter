// SPDX-License-Identifier: Apache-2.0
import type { Invariant } from './types.js'

export const INVARIANT_CATALOG: readonly Invariant[] = [
  // ─── Tier 1: Architectural Integrity (6) ─────────────────────────────────

  {
    id: 'INV-01',
    tier: 'architectural',
    title: 'No circular dependencies between modules',
    description:
      'Circular imports create tight coupling and make modules impossible to test in isolation. ' +
      'Every module must have a clear single direction of dependency. Detected by static analysis in CI.',
    alwaysActive: true,
    enforcement: 'CI (madge / go vet / cargo check / pylint)',
  },

  {
    id: 'INV-02',
    tier: 'architectural',
    title: 'Public API surface must be intentional — no accidental exports',
    description:
      'Every publicly exported symbol is a commitment to callers. Exporting by default leaks ' +
      'implementation details and makes refactoring costly. Only intentionally designed symbols ' +
      'may be public.',
    alwaysActive: true,
    enforcement: 'CI (Knip / cargo doc / PMD / unused linters)',
  },

  {
    id: 'INV-03',
    tier: 'architectural',
    title: 'Architecture boundary enforcement',
    description:
      'Layers must respect their dependency direction. Domain/business logic must not import ' +
      'from infrastructure or adapters. Boundary violations break testability and portability.',
    languageDetail: {
      typescript:
        'Layer boundaries enforced — domain code must not import from infrastructure layers',
      java: 'Hexagonal architecture — domain must not import from adapters or infrastructure',
      rust: 'Module visibility enforced — `pub(crate)` preferred over `pub` for internal APIs',
      go: 'Package boundaries enforced — minimize `internal/` escapes and cross-layer imports',
      python: 'Module boundaries enforced — no circular imports, layered architecture respected',
      unknown: 'Architecture boundary enforcement — layers must respect their dependency direction',
    },
    alwaysActive: true,
    enforcement: 'CI (ArchUnit / architecture linters / manual)',
  },

  {
    id: 'INV-04',
    tier: 'architectural',
    title: 'Language-specific type safety',
    description:
      'Each language has idioms for expressing and enforcing type safety at compile or lint time. ' +
      'Bypassing these mechanisms removes the safety net and allows runtime errors that the type ' +
      'system was designed to prevent.',
    languages: ['typescript', 'java', 'rust', 'go', 'python'],
    languageDetail: {
      typescript: 'No `any` type in TypeScript — use `unknown` and narrow, or create proper types',
      java: 'No raw types — generics must be parameterized (e.g. `List<String>` not `List`)',
      rust: 'No `.unwrap()` calls in library code — use `?` or explicit error handling',
      go: 'Explicit error handling required — no silenced errors with blank identifier',
      python: 'Type annotations required on all public function signatures',
    },
    alwaysActive: true,
    enforcement: 'hook + CI (ESLint no-explicit-any / cargo clippy / ruff / golangci-lint)',
  },

  {
    id: 'INV-05',
    tier: 'architectural',
    title: 'Complexity limits enforced',
    description:
      'High cyclomatic complexity correlates with defect density and makes code harder to test. ' +
      'Functions and methods must stay within complexity bounds to ensure readability and testability.',
    languages: ['typescript', 'java', 'rust', 'go', 'python'],
    languageDetail: {
      typescript: 'Cyclomatic complexity ≤ 15 (ESLint `complexity` rule)',
      java: 'Cyclomatic complexity ≤ 15, method length ≤ 65 LOC (PMD CyclomaticComplexity)',
      rust: 'Cognitive complexity enforced via `clippy::pedantic` lint level',
      go: 'Cyclomatic complexity ≤ 15 (`gocyclo` via golangci-lint)',
      python: 'Cyclomatic complexity ≤ 15 (`ruff C901` rule)',
    },
    alwaysActive: true,
    enforcement: 'CI (ESLint / PMD / clippy / golangci-lint / ruff)',
  },

  {
    id: 'INV-06',
    tier: 'architectural',
    title: 'No unused or dead code',
    description:
      'Dead code is a maintenance liability — it misleads readers, bloats binaries, and may ' +
      'hide latent bugs. All exported symbols and dependencies must be actively used.',
    languages: ['typescript', 'java', 'rust', 'go', 'python'],
    languageDetail: {
      typescript: 'No unused exports (Knip dead code analysis, zero findings)',
      java: 'No unused code (PMD UnusedCode rules, zero violations)',
      rust: 'No dead code (`#[warn(dead_code)]` via clippy, zero warnings)',
      go: 'No unused code (`deadcode,unused` via golangci-lint, zero findings)',
      python: 'No unused imports or variables (ruff `F401,F811`, zero findings)',
    },
    alwaysActive: true,
    enforcement: 'CI (Knip / PMD / clippy / golangci-lint / ruff)',
  },

  // ─── Tier 2: Data Integrity (4) ──────────────────────────────────────────

  {
    id: 'INV-07',
    tier: 'data',
    title: 'Schema changes via versioned migrations only — no manual DDL',
    description:
      'Database schema must evolve through versioned migration files (e.g. Flyway, Alembic, ' +
      'golang-migrate). Direct ALTER TABLE in application code, ORM auto-schema, or manual ' +
      'production changes are forbidden. Every schema state must be reproducible from migration history.',
    alwaysActive: false,
    enforcement: 'CI (migration lint / manual review)',
  },

  {
    id: 'INV-08',
    tier: 'data',
    title: 'Input validation at system boundaries',
    description:
      'All data entering the system from external sources (HTTP requests, message queues, ' +
      'files, user input) must be validated and rejected if malformed before reaching domain ' +
      'logic. Never trust external input.',
    alwaysActive: false,
    enforcement: 'code review / integration tests',
  },

  {
    id: 'INV-09',
    tier: 'data',
    title: 'Audit trail for mutable entities',
    description:
      'Every create, update, or delete on business-critical entities must be auditable. ' +
      'Changes must be traceable to the acting user, timestamp, and prior state.',
    alwaysActive: false,
    minGovernanceLevel: 'L2',
    enforcement: 'code review / integration tests',
  },

  {
    id: 'INV-10',
    tier: 'data',
    title: 'Soft delete preferred over hard delete',
    description:
      'Business data should be logically deleted (e.g. `deleted_at` timestamp, `is_active` flag) ' +
      'rather than physically removed. Hard delete is permitted only for explicit GDPR erasure ' +
      'flows. Queries must exclude soft-deleted records by default.',
    alwaysActive: false,
    enforcement: 'code review / ArchUnit or equivalent',
  },

  // ─── Tier 3: Security & Compliance (5) ───────────────────────────────────

  {
    id: 'INV-11',
    tier: 'security',
    title: 'No secrets in source code',
    description:
      'API keys, passwords, tokens, and other secrets must never appear in source files, ' +
      'configuration files committed to version control, or log output. Use environment ' +
      'variables or secret managers (Vault, AWS Secrets Manager, etc.).',
    alwaysActive: true,
    minGovernanceLevel: 'L1',
    enforcement:
      'CI (gitleaks secrets scan — security-early-fail job, runs before lint-and-test); ' +
      'local gate: `node scripts/check-secret-scan.mjs` (L1 baseline) + ' +
      '`gitleaks detect --source . --baseline-path suppressions/.gitleaksignore` (L2 block)',
  },

  {
    id: 'INV-12',
    tier: 'security',
    title: 'No PII in code, tests, or logs',
    description:
      'Personally identifiable information (emails, phone numbers, credit card numbers) must not ' +
      'appear in source code, test fixtures, or log output. Mask or redact PII before logging. ' +
      'Required for GDPR/NIS2 compliance. Enforced by static scan (pii-scan.mjs) as a HARD ' +
      'early-fail gate — no grace-period exception applies.',
    alwaysActive: true,
    minGovernanceLevel: 'L1',
    enforcement:
      'CI (pii-scan.mjs — security-early-fail job, HARD early-fail, no grace period); ' +
      'local gate: `node scripts/pii-scan.mjs` runs before all L1 checks; ' +
      'Claude hook: check-no-pii.mjs (PostToolUse, Edit|Write)',
  },

  {
    id: 'INV-13',
    tier: 'security',
    title: 'Dependencies scanned for known vulnerabilities',
    description:
      'All third-party dependencies must be scanned for CVEs before each release. ' +
      'High-severity vulnerabilities (CVSS ≥ 7.0) block deployment. Dependency updates must be ' +
      'reviewed for breaking changes.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement:
      'CI dep-audit step per stack — TypeScript: `npm audit --omit=dev --audit-level=high`; ' +
      'Rust: rustsec/audit-check action; ' +
      'Java/Kotlin: trivy fs --scanners vuln --severity HIGH,CRITICAL --exit-code 1 ' +
      '(suppressions: .trivyignore); ' +
      'Go: golang/govulncheck-action; ' +
      'Python: pip-audit. ' +
      'Local gate (L2 block): same commands, soft: graceActive',
  },

  {
    id: 'INV-14',
    tier: 'security',
    title: 'No dynamic code execution with untrusted input',
    description:
      'Dynamic code or shell execution using untrusted input is a critical injection vulnerability. ' +
      'Never pass user-controlled data to dynamic evaluation or shell-execution mechanisms without sanitization.',
    languages: ['typescript', 'java', 'rust', 'go', 'python'],
    languageDetail: {
      typescript:
        'No dynamic code evaluation (`eval` function or `Function` constructor) with untrusted input',
      java: 'No shell command execution (Runtime, ProcessBuilder) with unsanitized user input',
      rust: 'No unsafe FFI calls or shell execution with untrusted data',
      go: 'No shell execution with unsanitized user input',
      python:
        'No dynamic code evaluation (`eval`/`exec` builtins) or subprocess calls with untrusted input',
    },
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement: 'code review / SAST (semgrep / CodeQL)',
  },

  {
    id: 'INV-15',
    tier: 'security',
    title: 'Authentication required at every entry point',
    description:
      'Every API endpoint, message consumer, and job scheduler must authenticate the caller ' +
      'unless explicitly designated as public. Default-deny authentication; explicit opt-out ' +
      'requires ADR approval.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement: 'code review / integration tests',
  },

  // ─── Tier 4: Operational Excellence (5) ──────────────────────────────────

  {
    id: 'INV-16',
    tier: 'operational',
    title: 'Structured logging only — no raw print statements in production',
    description:
      'Production code must use a structured logging library that emits machine-parseable ' +
      'output (JSON). Raw print statements bypass log level filtering, structured fields, ' +
      'and correlation IDs. Every log entry should include `traceId` where applicable.',
    languages: ['typescript', 'java', 'rust', 'go', 'python'],
    languageDetail: {
      typescript: 'No `console.log/warn/error` in production code — use structured logger',
      java: 'No `System.out.println()` in production code — use SLF4J with structured output',
      rust: 'No `println!` or `eprintln!` in library code — use `tracing` or `log` crate',
      go: 'No `fmt.Print*` in production code — use `slog` or structured logger',
      python: 'No `print()` in production code — use `logging` module with structured formatter',
    },
    alwaysActive: false,
    enforcement: 'hook + CI (lint rules / grep / ESLint no-console)',
  },

  {
    id: 'INV-17',
    tier: 'operational',
    title: 'Explicit error handling — panics and unhandled errors are forbidden',
    description:
      'Unhandled errors and unexpected panics cause silent data corruption or opaque crashes. ' +
      'Every error path must be explicitly handled, logged, or propagated with context.',
    languages: ['typescript', 'java', 'rust', 'go', 'python'],
    languageDetail: {
      typescript:
        'Unhandled Promise rejections forbidden — always `.catch()` or `await` in `try/catch`',
      java: 'Empty catch blocks forbidden — exceptions must be handled or rethrown with context',
      rust: '`panic!` forbidden in library code — use `Result<T, E>` for error propagation',
      go: '`recover()` must log and reraise, never silently discard panics',
      python: 'Bare `except:` clause forbidden — always specify exception type and log the error',
    },
    alwaysActive: false,
    enforcement: 'hook + CI (lint rules / clippy)',
  },

  {
    id: 'INV-18',
    tier: 'operational',
    title: 'No hardcoded environment values',
    description:
      'Configuration values that differ between environments (URLs, ports, timeouts, feature ' +
      'flags) must be externalized via environment variables or configuration files, never ' +
      'hardcoded in source. This enables environment parity and safe deployments.',
    alwaysActive: false,
    enforcement: 'code review / SAST',
  },

  {
    id: 'INV-19',
    tier: 'operational',
    title: 'Resilient external calls — circuit breaker or retry required',
    description:
      'Every outbound call to an external service (HTTP, database, queue) must be wrapped in ' +
      'a resilience pattern: retry with exponential backoff and/or circuit breaker. ' +
      'Unbounded blocking calls and missing timeouts cause cascading failures.',
    alwaysActive: false,
    minGovernanceLevel: 'L2',
    enforcement: 'code review / integration tests',
  },

  {
    id: 'INV-20',
    tier: 'operational',
    title: 'Health and readiness endpoints required for deployed services',
    description:
      'Every deployed service must expose `/health` (liveness) and `/ready` (readiness) ' +
      'endpoints that orchestrators (Kubernetes, ECS, etc.) can probe. These endpoints must ' +
      'reflect actual dependency health, not just process uptime.',
    alwaysActive: false,
    minGovernanceLevel: 'L2',
    enforcement: 'integration tests / deployment checks',
  },

  // ─── Tier 5: Governance (10) ──────────────────────────────────────────────

  {
    id: 'INV-21',
    tier: 'governance',
    title: 'Every TODO comment must reference a task ID: `TODO(#NNN)`',
    description:
      'Orphan TODOs without a task ID cannot be tracked or prioritized and accumulate as ' +
      'invisible tech debt. Every TODO must link to a trackable issue so it can be scheduled ' +
      'or explicitly deferred.',
    alwaysActive: true,
    enforcement: 'hook (check-no-orphan-todo.mjs) + CI',
  },

  {
    id: 'INV-22',
    tier: 'governance',
    title: 'Branch naming: `task/#NNN-description`',
    description:
      'Consistent branch naming enables automatic linking between code and issue trackers, ' +
      'makes CI filtering predictable, and allows automated branch cleanup.',
    alwaysActive: true,
    enforcement: 'pre-push hook / CI branch name check',
  },

  {
    id: 'INV-23',
    tier: 'governance',
    title: 'No direct commits to `main` — all changes via task branches + PR',
    description:
      'Direct commits to the main branch bypass code review, CI validation, and the PR ' +
      'discussion record. All changes must flow through a PR from a task branch.',
    alwaysActive: true,
    enforcement: 'branch protection (GitHub) / pre-push hook',
  },

  {
    id: 'INV-24',
    tier: 'governance',
    title: 'Gate must pass before commit: `node scripts/check-all.mjs L1`',
    description:
      'The L1 gate (lint + unit tests) is the minimum bar for any commit. Committing broken ' +
      "code wastes reviewer time and breaks other developers' workflows.",
    alwaysActive: true,
    enforcement: 'pre-commit hook / CI',
  },

  {
    id: 'INV-25',
    tier: 'governance',
    title: 'Gate must pass before push: `node scripts/check-all.mjs L2`',
    description:
      'The L2 gate (L1 + coverage + integration tests) verifies that the feature works end-to-end ' +
      'before others are affected. Pushing broken code blocks the team.',
    alwaysActive: true,
    enforcement: 'pre-push hook / CI',
  },

  {
    id: 'INV-26',
    tier: 'governance',
    title: 'TDD mandatory — test first, then implement',
    description:
      'Test-driven development forces explicit design thinking before coding and produces code ' +
      'that is testable by construction. Writing tests after the fact often results in tests ' +
      'written to pass rather than tests that document expected behavior. ' +
      'Evidence is recorded via `arbiter task record-red` and verified via `arbiter verify tdd`.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement:
      'gate (scripts/check-all.mjs L2 — arbiter verify tdd) + task advance --to green gate',
  },

  {
    id: 'INV-27',
    tier: 'governance',
    title: 'Evidence artifacts must be generated for all gate runs',
    description:
      'At L4 (compliance grade), every gate execution must produce machine-readable evidence ' +
      'artifacts (coverage reports, lint results, test output) that can be archived and ' +
      'reviewed by auditors. Gate runs without artifacts are non-compliant.',
    alwaysActive: true,
    minGovernanceLevel: 'L4',
    enforcement: 'CI (evidence collection step)',
  },

  {
    id: 'INV-28',
    tier: 'governance',
    title: 'SSOT documents must not contradict — run drift check before merge',
    description:
      'At L3, SSOT (Single Source of Truth) documents (AGENTS.md, architecture docs, ' +
      'API contracts) must stay consistent. Contradictions between governance documents ' +
      'create ambiguity for agents and humans alike.',
    alwaysActive: true,
    minGovernanceLevel: 'L3',
    enforcement: 'CI (drift check / pre-merge hook)',
  },

  // ─── Java-specific: Test Architecture ────────────────────────────────────────

  {
    id: 'INV-29',
    tier: 'architectural',
    title: 'No MockMvc — use RestAssured for integration tests (Java)',
    description:
      'MockMvc tests the controller layer through a mock servlet container, bypassing real HTTP ' +
      'serialization, filter chains, exception handlers, and content negotiation. Bugs in those ' +
      'layers pass MockMvc and break in production. RestAssured tests the full HTTP stack with a ' +
      'real embedded server, providing genuine end-to-end confidence.',
    languages: ['java'],
    alwaysActive: true,
    enforcement: 'hook (check-no-mockmvc.mjs) + ArchUnit (NoMockMvcTest.java) + policy',
  },

  {
    id: 'INV-30',
    tier: 'operational',
    title: 'Mutation testing required — PIT/pitest (Java, L2+)',
    description:
      'Line coverage measures which lines execute but not whether tests verify behavior. ' +
      'A suite can reach 90% coverage with assertions that check nothing meaningful. ' +
      'Mutation testing (PIT/pitest) injects faults into production code and verifies tests fail — ' +
      'proving genuine fault-detection power. Thresholds: 80% mutation score, 85% line coverage. ' +
      'Scope: domain and application layers only (not adapters/controllers).',
    languages: ['java'],
    alwaysActive: false,
    minGovernanceLevel: 'L2',
    enforcement: 'generated: 05-release.yml mutation-blocking job + generated pitest config',
  },

  // ─── Governance: Suppression Expiry ─────────────────────────────────────────

  {
    id: 'INV-31',
    tier: 'governance',
    title: 'Suppressions must have mandatory expiry',
    description:
      'Every suppression entry — both file-based (.trivyignore, .gitleaksignore, ' +
      'pii-allowlist.json, archunit-baseline.json) and inline comment directives ' +
      '(arbiter-suppress(INV-NN, until=YYYY-MM-DD, reason=..., owner=@handle)) — must carry ' +
      'mandatory metadata: reason (≥10 chars), owner (@github-handle), and expiresAt/until (ISO date). ' +
      'Entries with a past expiry block the L1 gate. There are no permanent suppressions — ' +
      'waivers must be renewed or removed when the underlying issue is resolved.',
    alwaysActive: true,
    enforcement:
      'CI gate (scripts/check-suppressions.mjs + scripts/check-inline-suppressions.mjs — L1) + pre-commit hook',
  },

  // ─── Governance: Real-Project Matrix Coverage ───────────────────────────────

  {
    id: 'INV-32',
    tier: 'governance',
    title: "Every 'proven' language must have a nightly real-project fixture",
    description:
      "Arbiter's cross-language-matrix.json tracks tool maturity per language. A 'proven' " +
      'rating implies the tool chain works end-to-end on real projects. Every language that ' +
      "carries at least one 'proven' cell must have a corresponding fixture under " +
      '__tests__/fixtures/real-projects/ so the nightly real-project-matrix workflow can ' +
      'exercise the full arbiter pipeline (init → verify → check-all) against it. ' +
      "Promoting a language to 'proven' without a fixture is rejected by the L1 gate.",
    alwaysActive: true,
    selfOnly: true,
    enforcement:
      'CI gate (scripts/check-matrix-fixtures.mjs — L1) + nightly real-project-matrix workflow',
  },

  // ─── Governance: L3 Evidence Gate ────────────────────────────────────────────

  {
    id: 'INV-33',
    tier: 'governance',
    title: 'L4 merges require valid evidence with obs_gate == PASS',
    description:
      'L4 governance mandates structured, machine-checkable evidence of deep validation ' +
      'before merging. The evidence harness (scripts/evidence-collect.mjs) writes ' +
      '.evidence/SUMMARY.json carrying the required schema ' +
      '{head_sha, head_sha_short, obs_gate, tests, coverage, mutation, security} ' +
      "plus a canonical sha field. A merge is blocked when obs_gate !== 'PASS', which " +
      'indicates that tests failed, coverage dropped below threshold, mutation score is ' +
      'insufficient, or critical security findings exist. The L4 gate runs ' +
      '`arbiter verify evidence` which: (1) validates the schema via src/evidence/summary.ts, ' +
      '(2) verifies the embedded sha, (3) confirms head_sha matches `git rev-parse HEAD`, ' +
      "and (4) requires obs_gate === 'PASS'. Any failure blocks merge.",
    alwaysActive: true,
    minGovernanceLevel: 'L4',
    enforcement:
      'check-all.mjs L3+ evidence-gate block (reads .evidence/SUMMARY.json) + ' +
      'generated scripts/evidence-collect.mjs producer (#2278) + src/evidence/summary.ts validator',
  },

  // ─── Data: Real Database Enforcement ─────────────────────────────────────────

  {
    id: 'INV-34',
    tier: 'data',
    title: 'Integration tests must use real database (L2+)',
    description:
      'Integration tests must execute against a real database via Testcontainers at L2+. ' +
      'In-memory databases (H2, SQLite in-memory mode) are forbidden as a substitute for a ' +
      'real database engine. Tests that pass against an in-memory store may fail against the ' +
      'production database due to SQL dialect differences, constraint handling, and index behaviour.',
    alwaysActive: false,
    minGovernanceLevel: 'L2',
    enforcement:
      'check-all.mjs integration test step (L2+ when hasDatabase=true); ' +
      'anti-fake-DB gates: ArchUnit NoH2ArchTest (Java), ESLint no-restricted-imports (TypeScript), ' +
      'ruff F401-style check (Python); generated by src/generators/integration-testing.ts',
  },

  // ─── Operational: Contract Testing Enforcement ───────────────────────────────

  {
    id: 'INV-35',
    tier: 'operational',
    title: 'Contract testing enforced when contractType is active',
    description:
      "When contractType !== 'none', contract tests must run in CI at L2+ and are a HARD gate. " +
      'Failures block merge. Supported contract types: rest-owned, rest-public, graphql, grpc, message-queue. ' +
      'Each type generates the appropriate tooling (Pact, graphql-inspector, buf) and CI job.',
    alwaysActive: false,
    minGovernanceLevel: 'L2',
    enforcement:
      'check-all.mjs L2 contract gate + CI contract-verify job; generated by src/generators/contract-testing.ts',
  },

  // ─── Operational: Hook Hardness Manifest ─────────────────────────────────────

  {
    id: 'INV-36',
    tier: 'governance',
    title:
      'Hook hardness manifest — every hook must declare intent; HARD hooks must empirically block',
    description:
      'Every hook in src/templates/claude/hooks/ must be declared in .arbiter/hooks-manifest.json, ' +
      'and every hook in the project\u2019s own materialized .claude/hooks/ in ' +
      '.arbiter/self-hooks-manifest.json, with an explicit classification (HARD | ADVISORY). ' +
      'HARD hooks must empirically exit 2 \u2014 the only blocking code under the Claude Code hook ' +
      'protocol \u2014 on a canonical violation fixture. Any hook file without a manifest entry, or any ' +
      'HARD hook that fails to block, fails CI. This prevents silent ceremony regression \u2014 where a ' +
      'hook is declared hard but silently exits 0 (or exits 1, which prints without blocking). ' +
      'Both surfaces are required: #2324 was a defect present ONLY in the materialized copy, ' +
      'invisible to every template-scoped check (#2326).',
    alwaysActive: true,
    selfOnly: true,
    enforcement:
      'L1 gate (scripts/check-hardness-inventory.mjs) — drift and empirical exit-code assertions on every CI run',
  },

  // ─── Operational: Generated Githooks ─────────────────────────────────────────

  {
    id: 'INV-37',
    tier: 'governance',
    title: 'Generated githooks',
    description:
      'generateGithooks emits executable .githooks/{pre-commit,pre-push,commit-msg} for every ' +
      'supported language stack. Hooks must run L1/L2 gates respectively.',
    alwaysActive: true,
    enforcement:
      'src/generators/githooks.ts (generator) + ' +
      '__tests__/generators/githooks.test.ts + ' +
      '__tests__/integration/githooks-generation.test.ts',
  },

  {
    id: 'INV-38',
    tier: 'governance',
    title: 'Phase-tracked lifecycle enforcement',
    description:
      'Task lifecycle phase transitions are validated mechanically: completion guard exits 2 on ' +
      'premature claim (returns stderr to Claude as error context), pre-commit blocks commits during ' +
      'preflight/plan phases, and arbiter task advance validates forward-only transitions with audit log. ' +
      'Evidence guard (guard-done-evidence.mjs.ejs) additionally blocks done claims until SHA-pinned ' +
      'evidence (.claude/.last-done-evidence.json) is present, all_green, and SHAs match current tree. ' +
      'Evidence is captured by running node scripts/done-evidence.mjs (runs L2 gate + pins source SHAs). ' +
      'For archetypes that produce a running artifact (#1368): backend-web-db requires a reality_contact block ' +
      'with suite="live-api-e2e" and passed=true; frontend-spa requires suite in [render-smoke, visual-regression] ' +
      'with passed=true. A done/release claim without this archetype-appropriate reality-contact proof is blocked ' +
      '(exit 2) -- green unit tests alone are insufficient proof of working software for these archetypes.',
    alwaysActive: true,
    enforcement:
      'src/templates/claude/hooks/guard-task-completion.mjs.ejs (exit 2) + ' +
      'src/templates/claude/hooks/guard-done-evidence.mjs.ejs (exit 2, SHA-pin + reality-contact validation) + ' +
      'src/templates/scripts/done-evidence.mjs.ejs (evidence capture CLI) + ' +
      'src/templates/githooks/pre-commit.ejs (phase guard) + ' +
      'src/commands/task.ts (advance validator)',
  },

  {
    id: 'INV-39',
    tier: 'governance',
    title: 'Hook templates require empirical fire-tests',
    description:
      'Every Claude Code hook template in src/templates/claude/hooks/ must have at least one ' +
      'empirical fire-test in __tests__/hooks/empirical/. Adding a hook template without a ' +
      'corresponding test is a gate violation.',
    alwaysActive: true,
    selfOnly: true,
    enforcement:
      '__tests__/hooks/empirical/hook-fires.test.ts (22 tests covering all 14 hook templates)',
  },

  {
    id: 'INV-40',
    tier: 'operational',
    title: 'BDD scenarios with @ignore tag are HARD-fail',
    description:
      'Generated check-all.mjs must scan feature files for the @ignore tag before running BDD ' +
      'scenarios. Any @ignore-tagged scenario causes the gate to exit non-zero immediately ' +
      '(soft: false), regardless of grace period. Ignored scenarios are dead specs — they ' +
      'silently pass and give false confidence about coverage.',
    alwaysActive: false,
    enforcement:
      'src/templates/scripts/check-all.mjs.ejs (@ignore grep block, soft: false) + ' +
      'src/templates/behavioral-tests/bdd/example.feature.ejs (no @ignore in shipped example)',
  },

  {
    id: 'INV-41',
    tier: 'operational',
    title: 'Message-queue contract tests must call Schema Registry testCompatibility',
    description:
      'Schema Registry contract tests must invoke testCompatibility() against the registered schema, ' +
      'not merely check reachability (HTTP-200 on /subjects). The compatibility level must be BACKWARD ' +
      'or FULL. A test that only GETs /subjects is not a contract test — it is a health check.',
    alwaysActive: false,
    enforcement:
      'src/templates/contract-testing/message-queue/schema-registry-check.ts.ejs + ' +
      'src/templates/contract-testing/message-queue/SchemaRegistryCheckIT.java.ejs + ' +
      'src/templates/contract-testing/message-queue/schema_registry_test.go.ejs + ' +
      'src/templates/contract-testing/message-queue/test_schema_registry.py.ejs + ' +
      'src/templates/contract-testing/message-queue/schema_registry_test.rs.ejs',
  },

  {
    id: 'INV-42',
    tier: 'operational',
    title: 'Pact broker glue must be env-gated; no silent runs against default URL',
    description:
      'Generated Pact contract gates in check-all.mjs and CI workflows must be wrapped in a ' +
      'PACT_BROKER_BASE_URL environment check. When the variable is unset the step skips with a ' +
      'visible log line. When set, PACT_BROKER_TOKEN is forwarded to the Gradle/Maven/npx process ' +
      'as a system property or env var. No hardcoded broker URL is permitted.',
    alwaysActive: false,
    enforcement:
      'src/templates/scripts/check-all.mjs.ejs (env-gate block around Pact runCheck calls) + ' +
      "src/templates/github/workflows/01-pr-fast.yml.ejs (if: vars.PACT_BROKER_BASE_URL != '' + env: block) + " +
      'src/templates/contract-testing/rest-owned/pact-deps.gradle.ejs (conditional system props)',
  },

  {
    id: 'INV-43',
    tier: 'operational',
    title: 'OpenAPI exporter must run before diff; missing reference is HARD-fail',
    description:
      'Generated OpenAPI diff tests must not silently skip when spec files are missing. ' +
      'If contracts/openapi-current.yaml is absent, the test fails HARD (exporter was not run). ' +
      'If contracts/openapi-reference.yaml is absent, the test fails HARD unless ' +
      'ALLOW_OPENAPI_BOOTSTRAP=1 is set (first-run escape hatch). ' +
      'A test that silently passes with missing files is not a contract test — it is dead code.',
    alwaysActive: false,
    enforcement:
      'src/templates/contract-testing/rest-public/openapi-diff.ts.ejs + ' +
      'src/templates/contract-testing/rest-public/OpenApiDiffIT.java.ejs + ' +
      'src/templates/contract-testing/rest-public/openapi_diff_test.go.ejs + ' +
      'src/templates/contract-testing/rest-public/test_openapi_diff.py.ejs + ' +
      'src/templates/contract-testing/rest-public/openapi_diff_test.rs.ejs',
  },

  {
    id: 'INV-44',
    tier: 'security',
    languages: ['java'],
    title: 'SpotBugs security-category bugs MUST NEVER be suppressed or baselined',
    description:
      'Java projects generated by arbiter receive scripts/verify-spotbugs.mjs which ' +
      'enforces a hard-block list of security bug types that fail the gate immediately, ' +
      'regardless of baseline state or --update-baseline flag. The hard-block list covers: ' +
      'SQL_INJECTION, SQL_INJECTION_SPRING_JDBC, XSS_REQUEST_WRAPPER, XSS_SERVLET, ' +
      'COMMAND_INJECTION, XXE_DOCUMENT, XXE_XMLREADER, LDAP_INJECTION, HARD_CODE_PASSWORD. ' +
      'Non-security findings may be baselined in spotbugs-baseline.json after review.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement:
      'src/templates/scripts/verify-spotbugs.mjs.ejs (SECURITY_HARD_BLOCK set + exit 1) + ' +
      'src/templates/scripts/check-all.mjs.ejs (spotbugs baseline check at L2, Java)',
  },

  {
    id: 'INV-45',
    tier: 'governance',
    title:
      'Self-dogfood check — every EJS template must render to match its materialized self-repo file',
    description:
      'Every EJS template under src/templates/claude/ or src/templates/ship/ must render (with ' +
      "arbiter's own config) to content that matches the corresponding materialized .claude/ or " +
      '.arbiter/ship file (fail-closed: a template with no materialized counterpart is drift, not a ' +
      'skip). Additionally, for src/templates/github/workflows/*.ejs vs .github/workflows/*.yml and ' +
      'src/templates/scripts/check-*.mjs.ejs vs scripts/check-*.mjs (R-02, #1900), every basename ' +
      'present on BOTH sides is diffed — these two families are emitted conditionally (archetype × ' +
      'governanceLevel × collaborationMode) so basename presence on only one side is not drift. ' +
      'Files listed in .dogfood-divergences.json are explicitly exempted (intentional arbiter-internal ' +
      'extensions not appropriate for target projects) — CANON-14: the entry pins the exact approved ' +
      'diff hash, so NEW drift inside an allowlisted file still fails. Config-gated templates are ' +
      'skipped when the relevant feature flag is disabled in arbiter.json. ' +
      'This invariant prevents arbiter from shipping stale template skeletons — or a stale self-CI — ' +
      'that diverge from its own governance without an explicit documented reason (the #1877/#1894 ' +
      'drift class).',
    alwaysActive: true,
    selfOnly: true,
    enforcement:
      'scripts/check-self-dogfood.mjs (L1 gate check, promoted from L2 by #1744) — exits 1 on unexpected drift',
  },

  {
    id: 'INV-46',
    tier: 'architectural',
    title: 'Anti-bloat enforcement — Survey gate + duplication detector + LOC ratchet',
    description:
      'Before any new file is written under src/, a valid Existing Code Survey block must exist ' +
      'in the active plan (Target anchor, Decision keyword, ≥3 evidence rows, ≥200-char Rationale). ' +
      'The pre-edit hook hard-blocks (exit 2) any Write that lacks the survey. ' +
      'L2: jscpd detects code duplication above 5% threshold. ' +
      'L1: check-bloat-ratchet.mjs enforces file-count and LOC ceilings per src/ bucket ' +
      '(default +10%/+5 files; src/templates tighter at +5%/+3 files). ' +
      'Bypass surfaces: ARBITER_PLAN_BYPASS=1 (Survey gate) and ALLOW_BLOAT=1 (ratchet), ' +
      'both session-scoped and documented in CONTRIBUTING.md.',
    alwaysActive: true,
    selfOnly: true,
    enforcement:
      '.claude/hooks/pre-edit-plan-anchor.mjs (CANON-16 Survey gate, exit 2) + ' +
      'scripts/check-bloat-ratchet.mjs (L1 ratchet) + ' +
      'scripts/check-duplication.mjs (L2 duplication, fail-closed jscpd v5 wrapper, see .jscpd.json) + ' +
      'scripts/debt-report.mjs duplicationPercentage ratchet (CANON-22, see INV-109)',
  },

  {
    id: 'INV-47',
    tier: 'governance',
    title: 'Matrix proven cell requires a gate invocation in check-all.mjs.ejs',
    description:
      "Every tool cell marked 'proven' in src/compatibility/cross-language-matrix.json must " +
      'produce a concrete invocation step in src/templates/scripts/check-all.mjs.ejs at the ' +
      'correct gate level (L1, L2, or L3). Pre-existing gaps (e.g. mutation testing) are tracked ' +
      'in .matrix-proven-cells-exceptions.json with TODO references to the wiring issue.',
    alwaysActive: true,
    selfOnly: true,
    enforcement: 'scripts/check-matrix-proven-cells.mjs (L1 gate)',
  },

  {
    id: 'INV-48',
    tier: 'governance',
    title: 'EJS template render-test coverage must not regress',
    description:
      'Every template file under src/templates/ should be asserted by at least one test in ' +
      '__tests__/templates/ that renders the template and checks concrete output strings. ' +
      'Enforced via ratchet: the count of untested EJS files must not exceed the committed ' +
      'baseline (.template-tests-baseline.txt). Run with --update-baseline when adding tests.',
    alwaysActive: true,
    selfOnly: true,
    enforcement: 'scripts/check-template-tests.mjs (L1 ratchet gate)',
  },

  {
    id: 'INV-49',
    tier: 'governance',
    title: 'Every generator in src/generators/ must have a unit test',
    description:
      'Every file under src/generators/ requires a corresponding __tests__/generators/*.test.ts ' +
      'covering the happy path, idempotency, and at least one negative case. ' +
      'Untested generators can silently emit wrong governance content into target projects.',
    alwaysActive: true,
    selfOnly: true,
    enforcement: 'scripts/check-generator-tests.mjs (L1 gate)',
  },

  {
    id: 'INV-50',
    tier: 'governance',
    title: 'Every command in src/commands/ must have a test',
    description:
      'Every file under src/commands/ requires at least one corresponding ' +
      '__tests__/commands/*.test.ts (prefix-match: review.ts is covered by review-code.test.ts). ' +
      'CLI commands are the user entry point; untested commands cannot be refactored safely.',
    alwaysActive: true,
    selfOnly: true,
    enforcement: 'scripts/check-command-tests.mjs (L1 gate)',
  },

  {
    id: 'INV-51',
    tier: 'governance',
    title: 'Every catalog invariant must appear in AGENTS.md §Invariants',
    description:
      'Every invariant in src/invariants/catalog.ts must have a matching entry in ' +
      'AGENTS.md §Invariants. AGENTS.md is the canonical governance document read by all ' +
      'AI agents and new contributors. Invariants that exist only in code are invisible ' +
      'to the governance layer.',
    alwaysActive: true,
    selfOnly: true,
    enforcement: 'scripts/check-catalog-agents-parity.mjs (L1 gate)',
  },

  {
    id: 'INV-52',
    tier: 'governance',
    title: 'Catalog enforcement script citations must be wired in check-all.mjs',
    description:
      'If the enforcement field of a catalog invariant references a scripts/*.mjs file, ' +
      'that script must be called in scripts/check-all.mjs. Claimed enforcement that is ' +
      'not wired is a false guarantee — callers of the gate will believe it checks ' +
      'something it does not.',
    alwaysActive: true,
    selfOnly: true,
    enforcement: 'scripts/check-inv-enforcement-wired.mjs (L1 gate)',
  },

  {
    id: 'INV-53',
    tier: 'governance',
    title:
      'Exit-code universal contract — every Arbiter-emitted script exits 0=PASS / 1=FAIL / 2=ERROR',
    description:
      'Every script emitted by Arbiter (scripts/*.mjs, src/templates/scripts/*.ejs) must use ' +
      'exactly three exit codes: 0=PASS, 1=FAIL, 2=ERROR. ' +
      'That is: 0 for success, 1 for detected failure, 2 for invocation error ' +
      '(bad arguments, missing required inputs, environment not ready). ' +
      'Any other exit code is a violation. ' +
      'This contract makes every gate composable: callers can distinguish a clean run (0), ' +
      'a caught violation (1), and an unconfigured/broken environment (2) without parsing output. ' +
      'Enforced by scripts/check-exit-code-contract.mjs (L1 gate) which scans all emitted scripts ' +
      'and fails on any process.exit(N) where N ∉ {0, 1, 2}. ' +
      'The self-validation drill (scripts/self-validation.mjs, L2) proves the contract holds ' +
      'by running each gate against clean, drift, and error fixtures and asserting the expected exit.',
    alwaysActive: true,
    enforcement:
      'scripts/check-exit-code-contract.mjs (L1 gate) — exits 1 on violation; ' +
      'scripts/self-validation.mjs (L2 A/B/C drill) — exits 1 if any gate fails its proof',
  },

  {
    id: 'INV-54',
    tier: 'governance',
    title: 'SSOT core set integrity — all listed files must exist',
    description:
      'Every file listed in docs/METHOD/SSOT_CORE_SET.md must exist on disk. ' +
      'The gate exits 1 if any listed file is missing. ' +
      'Bootstrap mode: if SSOT_CORE_SET.md itself is absent, the gate exits 0 and skips.',
    alwaysActive: true,
    enforcement: 'scripts/check-ssot-core.mjs (L1 gate, #255)',
  },

  {
    id: 'INV-55',
    tier: 'governance',
    title: 'Doc-links integrity — all markdown links must resolve',
    description:
      'Every local markdown link in docs/ must resolve to an existing file. ' +
      'Before failing, the gate checks CANONICAL_PATHS.md for a redirect alias. ' +
      'Links in .docs-links-ignore are exempt. ' +
      'Bootstrap mode: if no docs/ files are found, the gate exits 0.',
    alwaysActive: true,
    enforcement: 'scripts/check-doc-links.mjs (L1 gate, #255)',
  },

  {
    // Retired (#1244) per ID-STABILITY: the ID is preserved as a tombstone (never
    // deleted/reused) because the bespoke knowledge-map it governed — KNOWLEDGE_MAP.md
    // plus its updater and freshness gate — was removed; Obsidian now reads the
    // generated wiki/. No replacement invariant.
    id: 'INV-56',
    tier: 'governance',
    title: 'Knowledge-map freshness — line counts must not drift beyond tolerance',
    description:
      'RETIRED (#1244): the bespoke knowledge-map (its index doc, updater, and freshness ' +
      'gate) was removed; Obsidian now reads the generated wiki. No line-count tolerance ' +
      'is enforced any longer.',
    alwaysActive: true,
    status: 'retired',
    retiredReason:
      'Bespoke knowledge-map deleted in #1244 (index doc + updater + freshness gate); ' +
      'the generated wiki replaces it. No successor invariant.',
  },

  {
    id: 'INV-57',
    tier: 'governance',
    title: 'Canonical-paths integrity — all redirect targets must exist',
    description:
      'Every redirect target in docs/METHOD/CANONICAL_PATHS.md must exist on disk. ' +
      'A dangling alias (target missing) causes the gate to exit 1. ' +
      'Bootstrap mode: if CANONICAL_PATHS.md is absent, the gate exits 0.',
    alwaysActive: true,
    enforcement: 'scripts/check-canonical-paths.mjs (L1 gate, #255)',
  },

  {
    id: 'INV-58',
    tier: 'governance',
    title: 'Node version SSOT — .nvmrc is canonical; all CI jobs use node-version-file',
    description:
      '.nvmrc at the repo root is the single source of truth for the Node.js version. ' +
      "All GitHub Actions workflows must use `node-version-file: '.nvmrc'` — never a literal version pin. " +
      'The same applies to all EJS templates that emit CI workflows. ' +
      'process.version major at runtime must match .nvmrc major. ' +
      'Enforced by scripts/check-node-version-ssot.mjs (L1 gate, #470).',
    alwaysActive: true,
    enforcement: 'scripts/check-node-version-ssot.mjs (L1 gate, #470)',
  },

  {
    id: 'INV-59',
    tier: 'governance',
    title:
      'Gate result parity — local L1 static gates must produce the same pass/fail pattern as CI',
    description:
      'check-all.mjs emits a gate result JSON to .arbiter/gate/local-result.json on every run ' +
      '(schema: arbiter-gate-v1). The parityContentHash field is a sha256 of the static L1 ' +
      'gate subset (27 gates, sorted by name; excludes commitlint, docs, unit tests which differ ' +
      'structurally between local and CI environments). ' +
      'The CI gate-aggregation job runs check-all.mjs L1 --json gate-result.json and uploads it ' +
      'as an artifact named gate-result. ' +
      'scripts/check-local-ci-parity.mjs (L2 gate) downloads the latest CI artifact via gh CLI ' +
      'and compares parityContentHash. A mismatch means local and CI disagree on a static check — ' +
      'a prerequisite violation for features.soloDevMode (#470). ' +
      'Skip (exit 0) when gh CLI is unavailable or no CI artifact exists.',
    alwaysActive: true,
    enforcement:
      'scripts/check-local-ci-parity.mjs (L2 gate, #470) — exits 1 on hash mismatch; ' +
      'scripts/check-all.mjs --json flag emits the artifact that check-local-ci-parity.mjs reads',
  },

  {
    id: 'INV-60',
    tier: 'operational',
    languages: ['rust'],
    minGovernanceLevel: 'L2',
    title: 'Release binary size capped at archetype default',
    description:
      'For Rust archetypes that emit an executable (cli, embedded), the release ' +
      'binary at target/release/<name> must stay under the archetype-default size ' +
      'budget: cli → 10 MB, embedded → 5 MB. Defaults are inlined in the ' +
      'src/generators/coverage.ts and src/generators/check-all.ts generators and ' +
      'are passed to the generated check-all.mjs via the binarySizeBytes data field. ' +
      'The generated script runs the size assertion in the L2 Rust block and skips ' +
      'gracefully when the release binary has not been built (e.g. on a freshly-cloned repo).',
    alwaysActive: false,
    enforcement:
      'Generated scripts/check-all.mjs L2 step (#359, Phase 7G); ' +
      'generated docs/coverage/Cargo.toml.profile.release block (opt-level=s, lto, ' +
      'codegen-units=1, strip=symbols, panic=abort) keeps binaries within the cap',
  },

  {
    id: 'INV-61',
    tier: 'operational',
    languages: ['typescript', 'python'],
    minGovernanceLevel: 'L2',
    // #1127: upgraded from WCAG 2.1 AA to WCAG 2.2 AA. Title deliberately unchanged
    // to preserve AGENTS.md parity — the enforcement description carries the version detail.
    // #1149: extended to Python — axe-playwright-python wrapper generated for
    // Python web archetypes (frontend-spa, backend-web-db).
    title: 'a11y critical violations are HARD-fail at L2',
    description:
      'For web archetypes (frontend-spa, backend-web-db) the generated a11y wrapper ' +
      'runs the full WCAG 2.2 AA tag set (wcag2a + wcag2aa + wcag21a + wcag21aa + wcag22aa) ' +
      'and raises/throws on any violation whose impact is `critical` OR unclassified ' +
      '(impact === null/undefined/None). serious / moderate / minor violations are logged ' +
      'without raising — they remain evidence but do not block the gate. ' +
      'WCAG 2.2 AA adds: target-size (2.5.8 ≥24×24px), focus-appearance (2.4.11), ' +
      'accessible-auth (3.3.8 no cognitive test). Downstream projects can ratchet ' +
      'stricter by extending the wrapper (#1127). ' +
      'TypeScript: generated tests/e2e/a11y/run-axe.ts (@axe-core/playwright, #349). ' +
      'Python: generated tests/e2e/a11y/run_axe.py (axe-playwright-python>=0.1.7, ' +
      'resultTypes=[violations], #1149). ' +
      'Matrix: a11y × typescript = proven; a11y × python = beta. ' +
      'Other languages have no browser surface (unavailable).',
    alwaysActive: false,
    enforcement:
      'TypeScript: generated tests/e2e/a11y/run-axe.ts throws on critical/unclassified ' +
      '— Playwright surfaces as failed spec, fails L2 playwright-e2e gate in scripts/check-all.mjs. ' +
      'Python: generated tests/e2e/a11y/run_axe.py raises on critical/unclassified ' +
      '— pytest collects tests/e2e/test_a11y.py, fails the L2 pytest-playwright e2e ' +
      'gate step in scripts/check-all.mjs (#1149).',
  },

  // --- Extended opt-in set (INV-62..INV-71) ---
  // Enabled via arbiter.json governance.invariants_catalog = 'extended'.
  // Excluded from default generated AGENTS.md/GLOBAL_INVARIANTS.md.

  {
    id: 'INV-62',
    tier: 'architectural',
    title: 'Frontend state separation — async (server) and sync (UI) state in distinct stores',
    description:
      'Async state fetched from a server (API responses, remote queries) must live ' +
      'in a dedicated async-state layer (e.g. TanStack Query, SWR, RTK Query). ' +
      'Synchronous UI state (modal open, selected tab, form draft) must live in a ' +
      'separate sync-state store (e.g. Zustand, Redux slice, React context). ' +
      'Mixing both in a single store conflates cache invalidation with UI transitions ' +
      'and makes optimistic updates error-prone.',
    alwaysActive: false,
    optInGroup: 'extended',
    enforcement: 'code review / manual',
  },

  {
    id: 'INV-63',
    tier: 'governance',
    title: 'SSOT atomic update — code and SSOT documentation land in the same commit',
    description:
      'When a code change alters an invariant, decision, or process rule, the ' +
      'corresponding SSOT document (AGENTS.md, docs/ADR/, docs/SYSTEM/CANON.md, ' +
      'docs/METHOD/) must be updated in the same commit. Split commits where code ' +
      'lands first and docs follow later create a window where the SSOT is stale ' +
      'and misleads reviewers and future agents.',
    alwaysActive: false,
    optInGroup: 'extended',
    enforcement: 'code review / manual',
  },

  {
    id: 'INV-64',
    tier: 'governance',
    title: 'No magic code — non-trivial idioms documented in a pattern catalog',
    description:
      'Any non-obvious pattern, workaround, or architectural idiom introduced into ' +
      'the codebase must be documented in a project-level pattern catalog ' +
      '(e.g. docs/PATTERNS/ or docs/METHOD/). "Magic" code that works for unclear ' +
      'reasons and is not documented creates maintenance risk when the original ' +
      'author is unavailable.',
    alwaysActive: false,
    optInGroup: 'extended',
    enforcement: 'code review / manual',
  },

  {
    id: 'INV-65',
    tier: 'architectural',
    title: 'Platform abstraction — env-specific APIs accessed only via adapter',
    description:
      'APIs that differ across deployment environments (browser vs. Node, ' +
      'local vs. cloud, test vs. prod) must be accessed through an adapter ' +
      'layer, not called directly in business logic. Direct calls to ' +
      'env-specific APIs (window, process.env, cloud SDKs) in domain code ' +
      'make testing harder and limit portability.',
    alwaysActive: false,
    optInGroup: 'extended',
    enforcement: 'code review / manual',
  },

  {
    id: 'INV-66',
    tier: 'governance',
    title: 'Process self-documentation — docs/METHOD/ is canonical for process rules',
    description:
      'All process rules, workflow conventions, and team agreements must be ' +
      'persisted under docs/METHOD/ as the authoritative source. Ad-hoc rules ' +
      'communicated only in PRs, Slack, or verbal agreements are not canonical ' +
      'and will be lost. The docs/METHOD/ directory is the single source of ' +
      'truth for how the team works.',
    alwaysActive: false,
    optInGroup: 'extended',
    enforcement: 'code review / manual',
  },

  {
    id: 'INV-67',
    tier: 'data',
    title: 'No internal mocking in E2E — backend endpoints are exercised against the real service',
    description:
      'End-to-end tests must exercise backend endpoints against a real running ' +
      'service (local or staging), not an internal mock or stub. Mocking the ' +
      'server within the E2E layer defeats the purpose of integration testing ' +
      'and hides contract mismatches. Use contract tests or test-doubles at the ' +
      'unit level; keep E2E real.',
    alwaysActive: false,
    optInGroup: 'extended',
    enforcement: 'code review / manual',
  },

  {
    id: 'INV-68',
    tier: 'operational',
    title: 'MCP-first forensic inspection — debug via MCP tools before raw shell',
    description:
      'When investigating a running system (querying state, inspecting logs, ' +
      'reading metrics), prefer MCP tool invocations over raw shell commands. ' +
      'MCP tools are auditable, repeatable, and safe by design. Raw shell ' +
      'commands issued ad-hoc during an incident bypass audit trails and ' +
      'increase the risk of accidental state mutation.',
    alwaysActive: false,
    optInGroup: 'extended',
    enforcement: 'code review / manual',
  },

  {
    id: 'INV-69',
    tier: 'governance',
    title: 'Design rationale traceability — new abstractions cite their motivating ADR',
    description:
      'Every new module, interface, or architectural abstraction introduced into ' +
      'the codebase must cite the ADR (Architecture Decision Record) that motivated ' +
      'it, either in a code comment, the PR description, or a linked docs/ADR/ entry. ' +
      'Abstractions without traceable rationale accumulate as unexplained complexity ' +
      'over time.',
    alwaysActive: false,
    optInGroup: 'extended',
    enforcement: 'code review / manual',
  },

  {
    id: 'INV-70',
    tier: 'architectural',
    title: 'Reuse before new — canonical registry search precedes creating a new module',
    description:
      'Before creating a new utility, helper, or module, the author must search ' +
      'the canonical registry (src/utils/, src/generators/, shared libs) for an ' +
      'existing equivalent. The search must be documented in the PR or plan. ' +
      'Creating a new module when an equivalent already exists produces duplication ' +
      'that diverges over time.',
    alwaysActive: false,
    optInGroup: 'extended',
    enforcement: 'code review / manual',
  },

  {
    id: 'INV-71',
    tier: 'governance',
    title: 'Track D task completion — docs-only changes follow the documented completion rules',
    description:
      'Documentation-only changes (Track D tasks) must follow the completion ' +
      'checklist defined in docs/METHOD/: update the relevant SSOT, verify no ' +
      'dangling references, and confirm the docs gate passes. Treating docs PRs ' +
      'as lower-ceremony than code PRs leads to stale documentation and ' +
      'broken cross-references.',
    alwaysActive: false,
    optInGroup: 'extended',
    enforcement: 'code review / manual',
  },

  {
    id: 'INV-72',
    tier: 'governance',
    title: 'File-lock semantics — process-bound exclusive lock with bootId + pid + cmd',
    description:
      'Long-running commands that mutate `.arbiter/` MUST acquire `.arbiter/.lock` ' +
      'via `src/utils/file-lock.ts` (acquireLock) before any state mutation, ' +
      'and release it on completion or crash. The lock records pid, hostname, ' +
      'bootId, cmd, startedAt, and a nonce. Same-host, same-boot live pids are ' +
      'never stale regardless of age; dead pids are stale immediately; and an ' +
      'unprobeable EPERM pid uses the configured age as a backstop. A changed ' +
      'bootId is stale immediately. Cross-host coordination ' +
      'is out of scope. Force-release MUST go through `forceReleaseLock` which ' +
      'always enforces path and symlink guards and requires a matching expectedPid ' +
      'except for explicit corrupt-lock recovery. Bypassing the lock (direct unlink, ' +
      'parallel mutators, ignoring the stale signal) corrupts the project ' +
      'snapshot and the file-stability log. Stale locks are surfaced by ' +
      '`doctor health` and auto-released by `doctor health --repair` (#824); ' +
      'a corrupt lock is recoverable through `doctor recover-lock`.',
    alwaysActive: true,
    selfOnly: true,
    enforcement: 'doctor health check + code review for any new `.arbiter/` mutator',
  },

  // ─── GitHub CI Tier Invariants (INV-73..INV-82) ──────────────────────────────
  // Applies when useGitHub: true. Generated gate scripts enforce at L1/L2.

  {
    id: 'INV-73',
    tier: 'operational',
    title: 'CI tier presence — all 8 workflow files must exist under .github/workflows/',
    description:
      'Every GitHub-enabled project must contain exactly the canonical 8 CI tier files: ' +
      '01-pr-fast.yml, 02-pr-extended.yml, 03-human-approval.yml, 05-release.yml, ' +
      '06-nightly.yml, 07-weekly.yml, 08-monthly.yml, 09-heartbeat.yml. Missing tiers ' +
      'degrade the deployment pipeline and break branch-protection required checks.',
    alwaysActive: false,
    enforcement: 'scripts/check-ci-tiers.mjs (L1 gate)',
    minPresent: 8,
  },

  {
    id: 'INV-74',
    tier: 'security',
    title: 'Anti-bot human-approval gate — reviewer must be a human distinct from the PR author',
    description:
      'The 03-human-approval.yml workflow applies the approved-by-human label only when ' +
      'three conditions pass: (1) reviewer is not the PR author, (2) reviewer is not a Bot, ' +
      '(3) review state is approved. The 01-pr-fast.yml human-approval-required sentinel job ' +
      'asserts this label is present before merge, blocking bot-only approvals.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement:
      'generated: 03-human-approval.yml triple-check + 01-pr-fast.yml human-approval-required job',
  },

  {
    id: 'INV-75',
    tier: 'operational',
    title: 'Heartbeat watchdog — T4 nightly ≤26 h, T5 weekly ≤8 d, T5b monthly ≤35 d',
    description:
      'The 09-heartbeat.yml workflow runs daily at 06:00 UTC and asserts that 06-nightly.yml ' +
      'completed within the last 26 hours, 07-weekly.yml within the last 8 days, and ' +
      '08-monthly.yml within the last 35 days. A missing heartbeat result triggers an ' +
      'auto-filed GitHub issue. Silent CI failures are treated as production incidents.',
    alwaysActive: false,
    enforcement: 'generated: 09-heartbeat.yml cron content',
  },

  {
    id: 'INV-76',
    tier: 'security',
    title:
      'SHA-pinned actions only — all third-party GitHub Actions must be pinned to a full 40-char SHA',
    description:
      'Tag-pinned or branch-pinned third-party actions (e.g. actions/checkout@v4) are a ' +
      'supply-chain attack vector: the tag can be moved after review. Every uses: reference ' +
      'to a non-local action must resolve to a full 40-character lowercase hex SHA. ' +
      'At L1: violations emit a warning. At L2+: violations are a hard gate failure.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement:
      'self: scripts/check-action-pins.mjs (L1 — transition warn until W10 #886) + generated gate: check-action-pins.mjs.ejs (target projects: L1=warn, L2+=hard fail)',
  },

  {
    id: 'INV-77',
    tier: 'security',
    title:
      'Top-level workflow permissions — every workflow file must declare explicit top-level permissions',
    description:
      'Workflows without a top-level permissions: block inherit the repository default, which ' +
      'is often write-all. Declaring permissions: at the top of every workflow file enforces ' +
      'the principle of least privilege and satisfies the OSSF Scorecard Token-Permissions check.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement: 'generated gate: check-workflow-perms.mjs (L1)',
  },

  {
    id: 'INV-78',
    tier: 'security',
    title: 'SLSA provenance present at T3 — release workflow must emit signed build provenance',
    description:
      'Every release workflow (05-release.yml) must invoke slsa-framework/slsa-github-generator ' +
      'to produce SLSA provenance. L2 governance targets SLSA Build L2 (signed provenance). ' +
      'L3 governance targets SLSA Build L3 (hermetic builder). Provenance is attached to the ' +
      'GitHub release as a verifiable attestation alongside the signed artifact.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement: 'generated: 05-release.yml slsa-github-generator reusable workflow call',
  },

  {
    id: 'INV-79',
    tier: 'security',
    title: 'Cosign sign-blob present for every release artifact',
    description:
      'Every artifact published by the release workflow (jars, binaries, wheels, images, tarballs) ' +
      'must be signed with cosign sign-blob using keyless OIDC signing via Sigstore. ' +
      'Unsigned release artifacts cannot be verified by downstream consumers and fail ' +
      'supply-chain audits.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement: 'generated: 05-release.yml cosign sign-blob per archetype publish job',
  },

  {
    id: 'INV-80',
    tier: 'operational',
    title: 'No continue-on-error on test or build steps — failures must propagate immediately',
    description:
      'Setting continue-on-error: true on a test, build, or security scan step masks failures ' +
      'and allows broken code to merge. This is a primary cause of non-deterministic CI. ' +
      'Only informational/alerting jobs (nightly, weekly, heartbeat) may use continue-on-error, ' +
      'and only at the job level, never on individual steps.',
    alwaysActive: false,
    enforcement: 'generated: workflow-integrity hook regex (post-edit)',
  },

  {
    id: 'INV-81',
    tier: 'operational',
    title:
      'Tier-hash local↔CI parity — check-all.mjs subcommand hashes must match CI workflow steps',
    description:
      'Each check-all.mjs subcommand (check, gate, full) publishes a tier-hash that is verified ' +
      'by the corresponding CI workflow in a parity-check step. If the local runner and the CI ' +
      'workflow diverge, a merge is blocked. This extends INV-59 to cover all T1..T5 gates.',
    alwaysActive: false,
    enforcement: 'generated: check-all.mjs tier-hash output + 01-pr-fast.yml parity-check step',
  },

  {
    id: 'INV-85',
    tier: 'operational',
    title: 'No kit source leakage — committed kit files must not contain employer-specific tokens',
    description:
      'Files authored by the kit catalog PR (src/kit/**, .github/ISSUE_TEMPLATE/epic-kit-gold-standard.md) ' +
      'must not contain employer-identifying tokens defined in scripts/data/redaction-lexicon.json. ' +
      'Tokens include service names, internal identifiers, and regulatory/proprietary markers. ' +
      'Enforced by check-no-redacted-tokens.mjs at L1. ' +
      'Keycloak is allowed when the line also contains "Keycloak-compatible IdP" (open-source framing).',
    alwaysActive: false,
    selfOnly: true,
    enforcement: 'scripts/check-no-redacted-tokens.mjs (L1 gate)',
  },

  {
    id: 'INV-86',
    tier: 'operational',
    title: 'Kit catalog parity',
    description:
      'src/kit/catalog.json and src/kit/canonical-mapping.json must stay in sync: ' +
      'every canonical_id in mapping must match a catalog id (N01..N78); names, tml_source, and ' +
      'gate_type must match after NFC-normalize and suffix-strip; every BLOCKING dim must have ' +
      'at least one enforcement artifact or a valid disposition exemption (adopt-framework or ' +
      'stack-adapter with implementing_wave in W3-W11, or disposition=done). ' +
      'Neither file may contain tokens from scripts/data/redaction-lexicon.json. ' +
      '(R-08 hardening) Rows carrying import_source must have an import_name that alnum-prefix-matches ' +
      'their framework_realization.docs pointer; every framework_realization.{template,generator,' +
      'validator} path must be prefixed "planned:" or exist on disk; every original import dim ' +
      '(1..76) must appear exactly once across mapping.dimensions[].import_source and ' +
      'unmapped_import_dims — no import payload may be silently dropped or double-attached.',
    alwaysActive: false,
    selfOnly: true,
    enforcement: 'scripts/check-kit-catalog-parity.mjs (L1 gate)',
  },

  {
    id: 'INV-87',
    tier: 'operational',
    title: 'Local-wrapper ↔ CI parity façade',
    description:
      'The local Makefile/run.sh targets must match CI workflow job names so contributors ' +
      'running `make ci` invoke the same surface as CI. Static check compares Makefile .PHONY ' +
      'targets (excluding local-only targets) with .github/workflows/ job names. Runtime check ' +
      'compares parityContentHash across local and CI gate results. Both checks are skip-neutral ' +
      'when sources are absent (pre-W4 state). Enforced by check-local-ci-parity.mjs at L1.',
    alwaysActive: false,
    selfOnly: true,
    enforcement:
      'scripts/check-local-ci-parity.mjs — static Makefile↔workflow check at L1 (PARITY_STATIC_CHECK_ONLY=1), ' +
      'full static + runtime parityContentHash check at L2',
  },

  {
    // Retired (#1837) per ID-STABILITY: the ID is preserved as a tombstone (never
    // deleted/reused). src/adapters/ was a test-only scaffold — its own registry
    // comment admitted "no runtime generator or command calls resolveAdapter/
    // listAdapters" — so the file-presence gate enforced coverage of a directory
    // with zero runtime callers. Deleted along with its gate script and the
    // doctor.ts `stack-adapter` health check. No replacement invariant.
    id: 'INV-88',
    tier: 'operational',
    selfOnly: true,
    alwaysActive: false,
    title: 'Stack adapter coverage',
    description:
      'RETIRED (#1837): src/adapters/ (8 files, self-admitted test-only, zero runtime callers) ' +
      'and its file-presence gate were removed. No successor invariant.',
    status: 'retired',
    retiredReason:
      'src/adapters/ was a test-only scaffold with zero runtime callers (self-admitted in ' +
      'its registry module); deleted in #1837 along with its gate script. No replacement.',
  },

  {
    id: 'INV-89',
    tier: 'operational',
    title: 'Anti-drift validator family — W6+F4 validators must be present and wired',
    description:
      'The anti-drift validator family (W6+F4) consists of 20 check-*.mjs scripts emitted for ' +
      'target projects via src/generators/anti-drift-validators.ts (Track B). ' +
      "11 of those 20 are also wired in arbiter's own L1 gate (dual-track): the 9 W6 core " +
      'validators plus check-validator-helptext and check-tier-coverage. ' +
      '2 scripts (check-workflow-sha-pinning.mjs, check-workflow-job-naming.mjs) are Track B only. ' +
      'The F4 batch adds 9 additional validators completing the agnostic anti-drift set. ' +
      'See docs/REFERENCE/anti-drift-family.md for the full family reference.',
    alwaysActive: false,
    selfOnly: false,
    enforcement:
      'scripts/check-suppression-rationale.mjs (L1) + ' +
      'scripts/check-suppression-expiry.mjs (L1) + ' +
      'scripts/pii-scan.mjs (L1) + ' +
      'scripts/check-secret-scan.mjs (L1) + ' +
      'scripts/check-drift.mjs (L1) + ' +
      'scripts/check-workflow-runners.mjs (L1) + ' +
      'scripts/check-workflow-docs-sync.mjs (L1) + ' +
      'scripts/check-workflow-test-integrity.mjs (L1) + ' +
      'scripts/check-pr-size-gate.mjs (L1) + ' +
      'scripts/check-unwired-guards.mjs (L1) + ' +
      'scripts/check-validator-helptext.mjs (L1) + ' +
      'scripts/check-tier-coverage.mjs (L1) + ' +
      'src/generators/anti-drift-validators.ts (Track B, 20 scripts)',
  },

  {
    id: 'INV-90',
    tier: 'operational',
    selfOnly: true,
    alwaysActive: false,
    title: 'Evidence bundle schema compliance',
    description:
      'Every task evidence bundle in .evidence/task-NNN/ must conform to schemas/evidence-bundle.schema.json. ' +
      'Ensures audit trail completeness by requiring taskId, timestamp, gateResult (pass|fail), ' +
      'redTestPath, greenTestPath, and an artifacts array. ' +
      'Exit 0 when no bundles are present (vacuous pass for new projects).',
    enforcement: 'scripts/check-evidence-bundle.mjs',
  },

  {
    id: 'INV-91',
    tier: 'security',
    title: 'AI-PR human-approval gate',
    description:
      'Bot-authored PRs (github.event.pull_request.user.type == "Bot") must be reviewed and ' +
      'approved by a human before merge. Approval is signaled by the "approved-by-human" label ' +
      'applied by _label-on-approve.yml (idempotent, rejects bot reviewers and self-reviews). ' +
      '_ai-draft-check.yml asserts the label presence on every label/sync event. ' +
      'Complements INV-74 which enforces the label requirement regardless of PR author type.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    selfOnly: false,
    enforcement: 'generated: _ai-draft-check.yml workflow + _label-on-approve.yml workflow',
  },

  // ─── Supply Chain (INV-92, W9) ────────────────────────────────────────────────
  {
    id: 'INV-92',
    tier: 'security',
    title: 'Supply chain — keyless signing, SBOM attestation, and Trivy CRITICAL block',
    description:
      'Release artifacts must be signed with cosign keyless (OIDC via Sigstore) and attested ' +
      'with a CycloneDX SBOM via cosign attest --predicate. Trivy must scan the filesystem for ' +
      'CRITICAL vulnerabilities (exit-code: 1) before the signing step runs. HIGH vulnerabilities ' +
      'are reported but do not block (target projects may have legacy deps). ' +
      'A _sigstore-retry-sign reusable workflow is also generated as opt-in scaffolding for ' +
      'retry-on-flake signing; the live 05-release cosign-sign job signs inline and does not ' +
      'yet delegate to it (#1663), so retry-on-flake is available to wire in, not yet active.',
    alwaysActive: true,
    selfOnly: false,
    minGovernanceLevel: 'L2',
    enforcement: 'generated: 05-release.yml (trivy-fs-scan + cosign-sign + sbom jobs)',
  },

  {
    // Retired (#2520) per ID-STABILITY: the ID is preserved as a tombstone (never
    // deleted/reused). The stamp-file gate had no writer anywhere in the repo — nothing
    // ever produced its nightly stamp artifact — and exited 0 vacuously whenever the
    // artifact was absent, BY DESIGN, per this entry's own prior description. Absent
    // writer + vacuous-on-absent means it was structurally incapable of ever failing.
    // 09-heartbeat.yml's assert-nightly-freshness job already enforces the real property
    // via the GitHub Actions API, and does so strictly better: it also fails when the
    // nightly workflow has never run at all, the exact case the stamp gate reported as a
    // pass. Deleted along with its gate script and check-all.mjs wiring. No replacement
    // invariant — the heartbeat job is the enforcement, not a successor gate.
    id: 'INV-93',
    tier: 'operational',
    selfOnly: true,
    alwaysActive: false,
    title: 'Nightly freshness gate',
    description:
      'RETIRED (#2520): the local stamp-file gate had no writer for its artifact and passed ' +
      'vacuously whenever that artifact was absent, by design — structurally incapable of ever ' +
      'failing. 09-heartbeat.yml already enforces the real freshness property via the GitHub ' +
      'Actions API, and strictly better: it also fails when the nightly workflow never ran at ' +
      'all. No replacement invariant.',
    status: 'retired',
    retiredReason:
      'The stamp-file gate had no writer for its artifact anywhere in the repo and exited 0 ' +
      'vacuously whenever it was absent, by design (the entry itself documented this as ' +
      'intentional) — structurally incapable of ever failing. 09-heartbeat.yml already enforces ' +
      'the real freshness property via the Actions API and, unlike the stamp gate, fails when the ' +
      'workflow has never run. Deleted in #2520; no replacement invariant.',
  },

  {
    id: 'INV-94',
    tier: 'operational',
    selfOnly: true,
    alwaysActive: false,
    title: 'Script catalog cohesion — every new gate script must carry a CATALOG marker block',
    description:
      'Every scripts/check-*.mjs file added after the baseline freeze must carry a ' +
      '// CATALOG: marker block of >=3 contiguous comment lines declaring what behaviour ' +
      'the script aggregates and why it cannot fold into a sibling script. ' +
      'Pre-existing scripts are grandfathered via scripts/data/script-catalog-baseline.json — ' +
      'the baseline is a debt ledger, not a bypass. ' +
      'Exit 0 when no new files exist outside the baseline; exit 1 with violating filenames ' +
      'when the marker block is absent or fewer than 3 lines.',
    enforcement: 'scripts/check-script-cohesion.mjs',
  },

  {
    id: 'INV-96',
    tier: 'operational',
    selfOnly: true,
    alwaysActive: false,
    title: 'Fail-closed audit — every gate script must default to BLOCK on uncertainty',
    description:
      'Every gate, hook, check, and generator emitted by arbiter must default to BLOCK on ' +
      'uncertainty, never SKIP. The fail-closed audit script checks scripts/, .githooks/, and ' +
      '.claude/hooks/ for known fail-open anti-patterns: missing set -euo pipefail in Bash, ' +
      'bare || true clauses without // FAIL-OPEN-INTENT: annotation, Node scripts that do not ' +
      'wrap top-level work in try/catch exit(1) or consume run-helpers.mjs, and bare catch {} ' +
      'swallowing without // FAIL-OPEN-INTENT: annotation. ' +
      'New scripts outside the baseline must pass all checks; existing violations are frozen ' +
      'in scripts/data/fail-closed-baseline.json.',
    enforcement: 'scripts/check-fail-closed-audit.mjs',
  },

  {
    id: 'INV-82',
    tier: 'operational',
    title: 'Monthly (T5b) workflow present + heartbeat asserts ≤32d freshness',
    description:
      'The 08-monthly.yml workflow (T5b) must exist and the 09-heartbeat.yml cron must assert ' +
      'that it completed within the last 32 days. A monthly run older than 32 days is treated as ' +
      'a silent CI failure and triggers an auto-filed GitHub issue. ' +
      'Pairs with INV-75 (heartbeat watchdog, which sets the ≤35d outer bound).',
    alwaysActive: false,
    enforcement: 'generated: 09-heartbeat.yml (assert-monthly-freshness job)',
  },

  {
    id: 'INV-136',
    tier: 'operational',
    title:
      "Tier-assignment rule — a check lives at the fastest tier where its red changes the developer's immediate next action",
    description:
      'A check lives at the fastest tier where its red changes the developer’s immediate ' +
      'next action; a red tolerated more than 48h has to be fixed, demoted to a slower tier, or ' +
      'deleted. Codified as the collapsed 5-lane CI doctrine, emitted opt-in via ' +
      'enableFiveLaneCi (mutually exclusive with the standard github/ci-tier generators): ' +
      'pre-commit (<10s, local via githooks) / PR-blocking (ci.yml, ≤15min) / nightly ' +
      '(nightly.yml, ≤45min) / weekly (weekly.yml, unbounded) / release-seal (release.yml, ' +
      'on tag push). Each generated workflow states its own tier and time budget in a header ' +
      'comment. Pairs with the A6 sticky-failure-issue mechanism: nightly.yml/weekly.yml source ' +
      'one shared .github/scripts/sticky-failure-issue.sh instead of filing a new issue per red ' +
      'run.',
    alwaysActive: false,
    enforcement: 'src/generators/ci-five-lane.ts',
  },

  // ─── Smoke-Journey Acceptance Floor — login/CRUD/authz (#2080) ───────────────
  {
    id: 'INV-137',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: false,
    title: 'Declared smoke journeys must be covered — no aspirational acceptance floor',
    description:
      'A project that declares a smoke journey in smoke-journeys.json (machine-readable manifest ' +
      'at repo root, schema arbiter-smoke-journeys-v1) must COVER it with ≥1 real spec file ' +
      "matching that journey's globs. OR semantics: a required journey passes if ANY of its " +
      'globs matches ≥1 file. This is the synthesis of two precedents: the per-item ' +
      '{ id, name, globs, status, rationale } shape and auditable machinery of INV-124 ' +
      '(test-pyramid) — n/a needs a rationale ≥20 chars, all-n/a is a hard fail — but the ' +
      'FAIL-CLOSED default direction of INV-126 (api-e2e): applicability is archetype-computed, ' +
      'so a journey applicable to the archetype defaults to required (absent status ⇒ required, ' +
      'never silently n/a) and day-1-green comes from a REAL scaffolded starter, not a default ' +
      'flag. An archetype with no interactive login/CRUD/authz journeys declares a top-level ' +
      'applicable:false with a reason ⇒ gate SKIPs (mirrors INV-126 required:false); a missing ' +
      'manifest ⇒ SKIP (exit 0) so ungoverned repos never false-fail. Because applicability is ' +
      'genuine (archetype-computed) rather than human-asserted, a wired-but-dead CI job can never ' +
      'be laundered into a legitimate n/a here — that stays a defect to fix, not a skip. ' +
      'Path-traversal globs and a non-array journeys field ⇒ exit 2 (schema error). Boundary: ' +
      'file PRESENCE only — assertion quality is INV-118 (anti-proforma) and execution is the ' +
      'render-smoke/e2e CI lane. Introduced in #2080 (sub-issue of #2043).',
    enforcement:
      'scripts/check-smoke-journeys.mjs (L1) — self-gate wired in scripts/check-all.mjs; generated ' +
      'for targets via src/generators/check-all.ts UNCONDITIONAL_EMISSIONS from ' +
      'src/templates/scripts/check-smoke-journeys.mjs.ejs (imports the shared scripts/lib/glob-walk.mjs ' +
      'helper, also unconditionally emitted). Manifest smoke-journeys.json + the TS Playwright starter ' +
      '(tests/smoke/smoke-journeys.spec.ts, frontend-spa + TypeScript only) emitted by ' +
      'src/generators/smoke-journeys.ts (skipIfExists:true; applicability archetype×language-computed). ' +
      'Exit codes per INV-53: 0=PASS/SKIP, 1=policy violation, 2=schema/path-traversal error.',
  },

  // ─── Deploy Target Supply Chain (INV-95, INV-97..99, PR-B #1005) ────────────
  {
    id: 'INV-95',
    tier: 'security',
    title: 'release.yml must invoke cosign sign on container image builds',
    description:
      'When deployTarget is not "none", 05-release.yml must invoke cosign sign --yes ' +
      'after the container image build step, signing the image digest via keyless Sigstore OIDC. ' +
      'Ensures every release artifact entering the supply chain is signed before being promoted ' +
      'to TEST or PROD. ' +
      'Enforcement: static-grep confirms cosign sign invocation in generated 05-release.yml.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    selfOnly: false,
    enforcement: 'scripts/check-workflow-cosign.mjs (L1)',
  },

  {
    id: 'INV-97',
    tier: 'security',
    title: 'deploy-prod must cosign-verify before traffic shift',
    description:
      'When deployTarget is not "none", 10-deploy-prod.yml must execute a cosign verify step ' +
      'with --certificate-identity-regexp and --certificate-oidc-issuer ' +
      'https://token.actions.githubusercontent.com BEFORE any container-app update or service ' +
      'routing command. Prevents deploying an unverified image to production even if the registry ' +
      'was compromised between TEST sign and PROD deploy. ' +
      'Enforcement: static-grep on generated 10-deploy-prod.yml asserts cosign verify precedes deploy command.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    selfOnly: false,
    enforcement: 'scripts/check-workflow-cosign.mjs (L1)',
  },

  {
    id: 'INV-98',
    tier: 'security',
    title: 'release workflow trigger must be tag-only (no branch push)',
    description:
      'When deployTarget is not "none", 05-release.yml must trigger on push.tags matching ' +
      'a semver pattern (v*.*.*) and must NOT trigger on push.branches. ' +
      'Branch-push triggers on release workflows create unsigned pre-release artifacts in the ' +
      'registry, polluting the digest namespace used by cosign copy in deploy-prod. ' +
      'Enforcement: static-grep confirms only push.tags trigger in generated 05-release.yml.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    selfOnly: false,
    enforcement: 'scripts/check-workflow-cosign.mjs (L1)',
  },

  {
    id: 'INV-99',
    tier: 'architectural',
    title: 'deployTarget must be a known cloud or "none"',
    description:
      'The deployTarget field in arbiter.json must be one of: ' +
      '"ghcr" | "azure-container-app" | "aws-ecs" | "gcp-cloud-run" | "none". ' +
      'Unknown values cause EJS include() path traversal at render time (RT-7). ' +
      'Enforcement: Zod schema validation on config load (default "none" prevents undefined); ' +
      'EJS whitelist preamble in 04-deploy-test.yml.ejs and 10-deploy-prod.yml.ejs rejects unknown values.',
    alwaysActive: true,
    selfOnly: false,
    enforcement:
      'Zod schema (src/config/schema.ts deployTargetSchema) + ' +
      'EJS whitelist preamble in 04-deploy-test.yml.ejs + 10-deploy-prod.yml.ejs',
  },

  {
    id: 'INV-100',
    tier: 'architectural',
    title: 'collaborationMode must be set in arbiter.json',
    description:
      'Every arbiter-scaffolded project must declare a collaborationMode field in arbiter.json. ' +
      'Valid values: "trunk-solo" | "peer-review" | "gated-review". ' +
      'Absent collaborationMode means CI shape and branching strategy are inferred from deprecated ' +
      'soloDevMode, which will be removed in the next major release. ' +
      'Enforcement: scripts/check-collab-mode-wired.mjs reads arbiter.json and fails if ' +
      'collaborationMode is absent or not a known value.',
    alwaysActive: true,
    selfOnly: false,
    enforcement: 'scripts/check-collab-mode-wired.mjs (L1)',
    adr: 'ADR-051',
  },

  {
    id: 'INV-101',
    tier: 'architectural',
    title: 'exact-SHA non-force landing for evidence-bearing changes',
    description:
      'An evidence-bearing trunk-solo + pr-ff landing atomically advances main from the observed ' +
      'gated base to the exact gated head with updateRefs and force:false, while asserting the ' +
      'head ref in the same transaction. Success requires live-policy validation and post-read ' +
      'main == gatedHeadSha; GitHub PR merge methods are forbidden. Repo compatibility settings: ' +
      'allow_merge_commit:true, allow_squash_merge:false, allow_rebase_merge:false. Branch settings: ' +
      'required_linear_history:false, allow_force_pushes:false, allow_deletions:false.',
    alwaysActive: true,
    selfOnly: false,
    enforcement: 'scripts/check-merge-method.mjs (L1)',
    adr: 'ADR-052',
  },

  // arbiter:noscan-inv-reservation
  // RESERVED: INV-83 (audit-append-only), INV-84 (audit-trigger-presence) —
  // sibling epic #TBD-sibling-epic phases B/G.
  // INV-82 promoted to active entry in #869.
  // Do NOT claim these numbers before those PRs land.

  // ── Frontend governance family (#1127) ────────────────────────────────────
  {
    id: 'INV-106',
    tier: 'operational',
    languages: ['typescript'],
    minGovernanceLevel: 'L2',
    title: 'i18n parity — all locale files must have identical key sets',
    description:
      'In FE projects, all locale JSON files must contain the same set of translation keys. ' +
      'Missing keys in any locale cause runtime fallback rendering (often empty strings or ' +
      'key identifiers instead of translated text). Raw UI text literals in component ' +
      'source (unfixed hardcoded strings) are also flagged. ' +
      'Bidirectional diff: missing in reference → target AND missing in target → reference ' +
      'are both failures. Mirrors P6 (i18n governance) of the FE_DESIGN_PRINCIPLES.',
    alwaysActive: false,
    enforcement:
      'Generated scripts/verify-i18n-parity.mjs checks bidirectional key-set parity ' +
      'across all locale files. Generated scripts/i18n-literal-scanner.mjs scans component ' +
      'source for raw UI text not wrapped in t(). Both fail the L2 gate step in check-all.mjs.',
  },
  {
    id: 'INV-105',
    tier: 'operational',
    languages: ['typescript'],
    minGovernanceLevel: 'L2',
    title: 'design token discipline — no raw colors or phantom tokens in UI components',
    description:
      'In FE projects, UI component files MUST use semantic design tokens from ' +
      'design-tokens.json (W3C DTCG format). Raw hex/rgb/hsl color values in component ' +
      'source are FORBIDDEN. Foundation/primitive tokens (--f-* prefix) MUST NOT be ' +
      'referenced directly in components. Phantom tokens (CSS var references not in ' +
      'design-tokens.json) produce invisible elements and must be eliminated. ' +
      'Mirrors FE006 + P1 of the FRONTEND_CONSTITUTION and FE_DESIGN_PRINCIPLES.',
    alwaysActive: false,
    enforcement:
      'Generated scripts/verify-tokens.mjs scans component source files for raw ' +
      'hex/rgb/hsl values and phantom token references, then fails the L2 gate step ' +
      'in scripts/check-all.mjs on any violation.',
  },
  {
    id: 'INV-102',
    tier: 'operational',
    languages: ['typescript'],
    minGovernanceLevel: 'L2',
    title: 'API-layer isolation — no HTTP calls outside the adapter layer',
    description:
      'In FE projects (archetype frontend-spa or lanes:[frontend]), direct ' +
      'fetch()/axios.* calls MUST NOT appear in UI component files, composables/hooks, ' +
      'or state stores. All HTTP I/O must be confined to a dedicated adapter/api layer ' +
      '(FSD entities/shared api modules, or src/api/). Mirrors FE001 of the ' +
      'FRONTEND_CONSTITUTION. Framework-aware: scans .ts/.tsx/.jsx (react), ' +
      '.ts/.vue (vue), or .ts/.svelte (svelte) files as appropriate.',
    alwaysActive: false,
    enforcement:
      'Generated check-fe-boundaries.mjs (emitted by check-all generator, #1127) scans ' +
      'UI-layer component files for raw HTTP client calls (fetch, axios, XMLHttpRequest) ' +
      'and fails the L2 gate step in scripts/check-all.mjs on any violation.',
  },
  {
    id: 'INV-103',
    tier: 'operational',
    languages: ['typescript'],
    minGovernanceLevel: 'L2',
    title: 'Headless domain logic — no browser APIs in domain or store layer',
    description:
      'In FE projects, domain and store files MUST NOT import or reference browser APIs ' +
      '(window, document, localStorage, sessionStorage, matchMedia, navigator, location, ' +
      'history, IndexedDB). Browser coupling makes domain logic untestable in Node.js and ' +
      'prevents server-side rendering. Mirrors FE002 of the FRONTEND_CONSTITUTION.',
    alwaysActive: false,
    enforcement:
      'Generated check-fe-boundaries.mjs (emitted by check-all generator, #1127) scans ' +
      'store/domain-hinted files for browser-global references and fails the L2 gate step ' +
      'in scripts/check-all.mjs on any violation.',
  },
  {
    id: 'INV-104',
    tier: 'operational',
    languages: ['typescript'],
    minGovernanceLevel: 'L2',
    title: 'State-management discipline — stores are synchronous and client-only',
    description:
      'In FE projects, state store files MUST NOT contain async fetch calls or direct ' +
      'API caching. Server state MUST be delegated to a data-fetching library (TanStack Query, ' +
      'SWR, or equivalent). Store getters MUST NOT encode business logic. ' +
      'Mirrors FE003 of the FRONTEND_CONSTITUTION.',
    alwaysActive: false,
    enforcement:
      'Generated check-fe-boundaries.mjs (emitted by check-all generator, #1127) detects ' +
      '`await fetch` and `await axios` inside store/domain-hinted files and fails the L2 ' +
      'gate step in scripts/check-all.mjs on any violation.',
  },

  // ── ADR SSOT integrity (#1099) ─────────────────────────────────────────────
  {
    id: 'INV-107',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    selfOnly: true,
    alwaysActive: true,
    title:
      'docs/internal/ADR/ is the canonical ADR SSOT — numbers unique, canonical_id populated, README in sync',
    description:
      'Every numbered ADR file in docs/internal/ADR/ must have canonical_id set to its 3-digit ' +
      'filename prefix, ADR numbers must be unique across all files, and docs/internal/ADR/README.md ' +
      'must list every numbered ADR file. docs/internal/SYSTEM/DECISIONS.md is frozen legacy and ' +
      'must not receive new entries. Enforced at L1 to catch drift before commit.',
    adr: 'ADR-073',
    enforcement:
      'scripts/check-adr-index.mjs verifies unique numbers, canonical_id match, and ' +
      'README coverage. Wired into scripts/check-all.mjs L1 (#1099).',
  },
  {
    id: 'INV-108',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    selfOnly: true,
    alwaysActive: true,
    title: 'SSOT core set exhaustiveness — every qualifying doc must be listed',
    description:
      'docs/METHOD/SSOT_CORE_SET.md must list every doc that qualifies as a canonical SSOT ' +
      'doc (status: active AND its first kind/* tag is a backbone kind, or a non-empty ' +
      'canonical_id; excluding ADRs and generated dim-NN coverage stubs). The generated inventory region is the ' +
      'authoritative source; the gate exits 1 if a qualifying doc on disk is absent from the ' +
      'list. Complements INV-54 (listed→exists) with the reverse direction (qualifies→listed).',
    enforcement:
      'scripts/check-ssot-core.mjs verifies exhaustiveness using the selectSsotDocs predicate ' +
      'from scripts/gen-ssot-core.mjs (single source of the rule); the generator --check guards ' +
      'staleness. Wired into scripts/check-all.mjs L1 (#1100).',
  },

  {
    id: 'INV-109',
    tier: 'operational',
    minGovernanceLevel: 'L2',
    selfOnly: false,
    alwaysActive: false,
    languages: ['typescript'],
    title: 'Duplication (DRY) gate + ratchet — generated and dogfooded',
    description:
      'Code duplication is BOTH a hard gate (jscpd, fails above the governance-scaled threshold: ' +
      'L1 10% → L2 5% → L3/L4 3%) AND a debt-ratchet metric: a patch may not increase the ' +
      'duplicated-token percentage (Lehman entropy). CANON-22 Tier-1 — Juergens et al. ICSE 2009: ' +
      'inconsistent (diverged) clones are latent bugs. Dual-sided (CANON-01): arbiter dogfoods the ' +
      'gate at scripts/check-all.mjs and emits the same gate to TypeScript targets via ' +
      'src/generators/duplication.ts (.jscpd.json + jscpd devDep + scripts/check-duplication.mjs).',
    enforcement:
      'scripts/check-duplication.mjs (L2 gate, fail-closed jscpd v5 wrapper, see .jscpd.json) + ' +
      'scripts/debt-report.mjs --gate ' +
      '(duplicationPercentage metric collected in scripts/debt-lib.mjs); generated for target ' +
      'projects by src/generators/duplication.ts.',
  },

  {
    id: 'INV-110',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    selfOnly: true,
    alwaysActive: true,
    title: 'GLOBAL_INVARIANTS.md must document every always-active invariant — coverage parity',
    description:
      'GLOBAL_INVARIANTS.md is the deep-reference companion to AGENTS.md. Every alwaysActive ' +
      'invariant in the catalog must have a `### INV-NN` section there (no silent coverage gap — ' +
      'the drift this gate prevents), and every documented INV must exist in the catalog (no ' +
      'phantom row). Mirrors the AGENTS.md<->catalog parity gate (CANON-08) for the companion doc. ' +
      'selfOnly: target GLOBAL_INVARIANTS.md is generated from the catalog and is in parity by ' +
      'construction, so the gate guards only the hand-maintained arbiter-self doc.',
    enforcement:
      'scripts/check-global-invariants-parity.mjs verifies forward (alwaysActive->documented) and ' +
      'reverse (documented->catalog) parity. Wired into scripts/check-all.mjs L1.',
  },
  {
    id: 'INV-111',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    selfOnly: true,
    alwaysActive: true,
    title: 'CLI reference must document every registered command — no phantom, no missing',
    description:
      'website/reference/cli.md hosts a machine-generated command-reference region ' +
      '(between BEGIN/END GENERATED:cli markers). Every top-level command registered in ' +
      'src/cli.ts must have a section in that region, and every section must correspond to ' +
      'a registered command (bidirectional, no phantom). Drift is caught at L1 by the gate; ' +
      'the hand-written prose outside the markers is preserved on every regeneration. ' +
      'Extended by F2 (#1838): the no-phantom rule also covers hand-authored prose — every ' +
      '`arbiter <cmd>` cited in PRIVACY.md/docs/website (minus internal/ and changelog/ ' +
      'historical prose) must exist in cli.ts routing, aliases included. ' +
      "selfOnly: this guards arbiter's own CLI reference doc, not generated target projects.",
    enforcement:
      'scripts/gen-cli-ref.mjs --check verifies bidirectional parity (registered<->documented); ' +
      'scripts/check-phantom-command-scan.mjs verifies prose citations (#1838). ' +
      'Both wired into scripts/check-all.mjs L1.',
  },

  {
    id: 'INV-112',
    tier: 'governance',
    minGovernanceLevel: 'L2',
    selfOnly: false,
    alwaysActive: true,
    title: 'RTM/FEATURE_MATRIX required at L2+; serious-test DoD at L3+; 21CFR audit-trail at L4',
    description:
      'Every project at L2+ must ship and maintain a docs/FEATURE_MATRIX.md ' +
      '(RTM) covering 100% of its KIT catalog dimensions. The matrix uses a fail-closed ' +
      'status ladder: Missing (issue_ref required) → Partial (code_ref required) → Done ' +
      '(code_ref+test_ref+doc_ref required) → Verified (all four refs + test title parsed). ' +
      'At L3+ every Done/Verified row must reference a real test title (serious-test DoD). ' +
      'At L4 audit_trail-category rows must carry code_ref+test_ref. ' +
      'The matrix is machine-validated by scripts/check-feature-matrix.mjs on every gate run. ' +
      'The generator (src/generators/feature-matrix.ts) scaffolds the initial matrix for new ' +
      'projects; the committed doc is the authoritative Product-Truth source.',
    enforcement:
      'scripts/check-feature-matrix.mjs (L1 gate, fail-closed): validates status ladder, ' +
      'KIT-dim coverage, counter integrity, ref existence, and level-gated DoD rules. ' +
      'Wired into scripts/check-all.mjs L1. Generated for target projects at L2+ by ' +
      'src/generators/feature-matrix.ts (CANON-23).',
  },
  {
    id: 'INV-113',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    selfOnly: true,
    alwaysActive: true,
    title: 'Single authoritative task-phase document — no split-brain dotfiles',
    description:
      'Task lifecycle state is sourced from ONE authoritative document pair: ' +
      '.claude/.task/status.json (structured phase + step-cursor + metadata) and ' +
      '.claude/.task/log.md (append-only digest). The legacy split-brain — flat .claude/.task-* ' +
      'dotfiles plus a per-id status.json that froze at phase:red — is abolished. All phase writes ' +
      'route through one atomic read-modify-write so the document can never diverge, and every ' +
      'reader (engine, generated hooks, shell consumers) reads the unified document. No source or ' +
      'template code may read or write the legacy flat dotfiles; only the migration shim ' +
      'src/commands/task-state.ts may name them (to consume-and-delete during migration).',
    enforcement:
      'scripts/check-phase-doc-consistency.mjs (L1 gate): scans src/** for legacy .task-* ' +
      'dotfile-name literals (allowlisting the migration shim) and validates status.json ' +
      'well-formedness when present. Wired into scripts/check-all.mjs L1.',
  },
  {
    id: 'INV-114',
    tier: 'governance',
    minGovernanceLevel: 'L2',
    selfOnly: false,
    alwaysActive: true,
    title: 'Fail-closed Stop gate — completion claims require correlated evidence',
    description:
      'On a task/ or ship/ branch whose phase is not yet complete, an agent may not end its ' +
      'turn claiming completion (task complete / ready to merge / pr merged …) unless three ' +
      'evidence artifacts exist AND correlate to the current branch and HEAD sha: (1) the ' +
      'plan-review latest.json with verdict PASS, recorded on this branch at a commit that is an ' +
      'ancestor of HEAD; (2) the agents-dispatched sidecar (.arbiter/agents-dispatched.json) on ' +
      'this branch at an ancestor commit; (3) the gate-pass marker (.arbiter/gate-pass.json) that ' +
      'still BINDS this tree — schema arbiter-gate-pass-v2, head_sha equal to HEAD, matching ' +
      'branch and task id, plus the #2328 identity axes: working-tree content hash, checkout ' +
      'root, toolchain fingerprint, gate level and TTL. A missing or blank field is a ' +
      'rejection, never an unconstrained axis, so a pre-v2 marker is refused. A claim ' +
      'with any missing or stale artifact is blocked. Every other path — no claim, unreadable ' +
      'transcript, non-task branch, phase complete, hook re-entry — stands down. This is the ' +
      "backstop the soft UserPromptSubmit completion guard cannot be: it observes the agent's own " +
      'stop, not the next user prompt.',
    enforcement:
      '.claude/hooks/stop-evidence-guard.mjs (Claude Code Stop event, exit 2 = block-the-stop ' +
      'and return stderr to the model). Generated for target projects at L2+ by ' +
      "src/generators/claude.ts and dogfooded in arbiter's own .claude/ (CANON-01/14). Evidence " +
      'writers (scripts/check-all.mjs for the gate-pass marker; the /task and /ship command ' +
      'playbooks in .claude/commands/ for the plan-review and agents-dispatched sidecars) stamp ' +
      'branch+sha so correlation is possible; the marker binding itself lives in the shared ' +
      'scripts/lib/gate-evidence.mjs (#2328). Empirical coverage: ' +
      '__tests__/hooks/empirical/stop-evidence-guard.test.ts, ' +
      '__tests__/evidence/gate-evidence-consumers.test.ts.',
  },
  {
    id: 'INV-115',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: true,
    adr: 'ADR-109',
    title:
      'Free-text governance prohibitions must resolve to a verified enforcer, live scan, or explicit triage',
    description:
      'Every hard prohibition declared in free-text governance (AGENTS.md, CANON.md, ' +
      'CLAUDE.md) via a directive marker (NEVER / MUST NOT / DO NOT / 🛑 / `No <tok>` / ' +
      '`never <tok>`) must resolve to exactly one honest state — it may not be merely asserted ' +
      'in prose. (1) COVERED: mapped in scripts/constraint-map.json to an enforcer whose ' +
      'existence is verified at scan time (gate→referenced in check-all.mjs, hook→file under ' +
      '.claude/hooks, inv→id in catalog.ts, lint→rule in an eslint config, template→path under ' +
      'src/templates); a map entry naming a missing enforcer is MAP-FICTION and fails the gate ' +
      '(the CANON-23 fiction guard). (2) ENFORCED-BY-SCAN: a derivable code token, live-grepped ' +
      'against source every run — the scan itself is the wiring. (3) UNENFORCEABLE: prose / ' +
      'path / non-code token surfaced for human triage. Extends CANON-09 (claimed-enforcement = ' +
      'wired-gate) from invariant citations to free-text prohibitions. A MISSING map file (#2037, ' +
      'ADR-109) fails the gate closed — a project declaring this gate must supply linking data, ' +
      'not silently scan against nothing; a present-but-empty map still warns (fresh project, ' +
      'curated over time). Escape: governance.constraintScan:"off" in arbiter.json.',
    enforcement:
      'scripts/check-constraint-scan.mjs (L1 gate, wired in scripts/check-all.mjs): extracts ' +
      'directive prohibitions, classifies via scripts/constraint-map.json, hard-fails on a live ' +
      'un-covered derivable violation, a map-fiction entry, or a MISSING map file (ADR-109). ' +
      'scripts/constraint-map.json is scaffolded unconditionally alongside the gate (#2037) so ' +
      'the missing-file case only arises from deletion/retrofit, never a fresh project. Emitted ' +
      'for target projects as src/templates/scripts/check-constraint-scan.mjs.ejs (warn-default ' +
      'on ENFORCED-BY-SCAN, --enforce to promote; the missing-map fail-closed applies regardless) ' +
      "and dogfooded on arbiter's own governance (CANON-01/14). Empirical coverage: " +
      '__tests__/scripts/check-constraint-scan.test.ts.',
  },
  {
    id: 'INV-116',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    selfOnly: true,
    alwaysActive: true,
    title:
      'wiki/ must be free of broken wikilinks, orphan pages, stale source hashes, and missing citations',
    description:
      'The generated LLM-wiki (wiki/) must pass four lint dimensions: ' +
      'broken-link (every [[WikiPage]] ref resolves to wiki/{page}.md), ' +
      'orphan (every page reachable from INDEX.md; INDEX.md exempt), ' +
      'stale (source_sha matches current git hash), ' +
      'and citation (source: field present and git-tracked). ' +
      'Exit 0 on bootstrap (wiki/ absent). Non-authoritative (SSOT wins on conflict). ' +
      'selfOnly: true because target projects may not generate wiki/ (#1241).',
    enforcement:
      'scripts/check-wiki-lint.mjs (L2 gate, wired in check-all.mjs): validates ' +
      'all 4 dimensions; exits 0 on bootstrap. Emitted for targets as ' +
      'check-wiki-lint.mjs.ejs (CANON-01/14). Tests: tests/gates/wiki-lint-fixture.test.ts.',
  },
  {
    id: 'INV-117',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    selfOnly: true,
    alwaysActive: true,
    title: 'arbiter self-repo must not track binary build artifacts',
    description:
      'The arbiter repository must not commit binary build artifacts. ' +
      'npm pack outputs (*.tgz) bloat git history permanently and are unreproducible ' +
      'from source. selfOnly: true because consumer projects use diverse packaging ' +
      '(maven jars, python wheels, Go binaries, Docker images) — a blanket *.tgz ' +
      'prohibition would incorrectly block legitimate non-JS packaging workflows (#1217).',
    enforcement:
      'scripts/check-no-tracked-artifacts.mjs (L1, selfOnly — arbiter self-governance only). ' +
      'Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR.',
  },
  {
    id: 'INV-118',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    alwaysActive: true,
    title: 'Anti-proforma test gate — every test must carry a real assertion',
    description:
      'Test methods (it(), test(), @Test, @ParameterizedTest, @RepeatedTest) must contain ' +
      'at least one recognized assertion. Proforma tests (no assertions) provide false ' +
      'confidence — they always pass regardless of the code under test (§R-41). ' +
      'JVM: enforced via ArchUnit bytecode scan (AntiProformaTest.java, L2+). ' +
      'TypeScript/other: enforced via source-text regex scan (check-anti-proforma.mjs, L1+, warn-default). ' +
      'Bypass: @AntiProformaExempt("rationale") (JVM) or // anti-proforma-exempt: rationale (other). ' +
      'Bypass ratio > 5% triggers EXEMPT-THRESHOLD alarm (#1249).',
    enforcement:
      'scripts/check-anti-proforma.mjs (L1+, warn-default; --enforce promotes to hard-block). ' +
      'JVM: src/templates/archunit/AntiProformaTest.java.ejs (L2+, hard-block via ArchUnit). ' +
      'Exit codes per INV-53: 0=PASS/WARN, 1=FAIL (--enforce), 2=ERROR.',
  },
  {
    id: 'INV-119',
    tier: 'governance',
    minGovernanceLevel: 'L2',
    alwaysActive: true,
    title: 'Commit-footer audit evidence required for suppression/override/bypass commits',
    description:
      'Commits that touch suppression/bypass files (*.trivyignore, owasp-suppressions.xml, ' +
      'pitest-override configs, sigstore-bypass configs, suppressions/**) in the ' +
      'origin/main..HEAD range must carry at least one recognized immutable commit-footer ' +
      'trailer (§11.10(e)). Recognized trailers: Suppression-Rationale:, ' +
      'Pitest-Override-Rationale:, Trivy-Expiry-Extension:, Sigstore-Bypass:. ' +
      'Evidence artifact written to .arbiter/evidence/commit-footer-audit/<timestamp>.json. ' +
      'Hard-blocks on missing trailer (exit 1). Git failure → exit 0 with WARN (fail-open ' +
      'when origin/main unavailable) (#1249).',
    enforcement:
      'scripts/check-commit-footer-rationale.mjs (L2+, hard-block; exit 1 on violation). ' +
      'Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR.',
  },
  {
    id: 'INV-120',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    selfOnly: true,
    alwaysActive: true,
    title:
      'Workflow needs-chain depth must not exceed the configured limit (parallelism regression gate)',
    description:
      'CI workflow job dependency chains (critical path depth, measured as edge count in the ' +
      'needs: DAG) must not regress beyond per-workflow thresholds. Default limit: 3 edges. ' +
      'Per-file overrides: 01-pr-fast ≤3 (Java Maven path uses 3 edges), 05-release ≤4 ' +
      '(cosign/sbom-attest chain), nightly/weekly/monthly ≤5. ' +
      'Aggregator sinks (jobs with `if: always()`) are excluded — they are pure status ' +
      'barriers, not wall-clock critical-path contributors. ' +
      'selfOnly: true because consumer projects generate their own workflows from templates; ' +
      "this gate protects arbiter's own generated CI from undetected chain regression (#1231).",
    enforcement:
      'scripts/check-workflow-parallelism.mjs (L1, selfOnly — arbiter self-governance only). ' +
      'Configurable via ARBITER_MAX_NEEDS_CHAIN env. ' +
      'Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR.',
  },
  {
    id: 'INV-121',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: false,
    title: 'Stack conformity — the repo-root manifest must not contradict declared axes',
    description:
      'A governed project must not declare a language/databaseEngine in arbiter.json that the ' +
      'repo-ROOT manifest contradicts. Declared language="go" with a root package.json and no ' +
      'go.mod (a Node project masquerading), or declared databaseEngine="sqlite" while the root ' +
      'manifest pulls a postgres/mysql/mongo driver, is configuration drift that silently ' +
      'mis-governs the project. Fail-closed self-safety is RUNTIME-resident in the emitted gate ' +
      '(not render-time EJS, which check-self-dogfood defaults to typescript): the script re-reads ' +
      'the TARGET arbiter.json — absent language ⇒ exit 0 (undeclared never fails); absent/none ' +
      'databaseEngine ⇒ DB conformity skipped. Root-scope ONLY (./go.mod, ./package.json, ./*.lock) ' +
      '— never recurses, so monorepo subdir manifests and fixtures do not false-fail (#1312).',
    enforcement:
      'scripts/check-stack-conformity.mjs (L1 gate, wired in check-all.mjs when a language is ' +
      'declared). Emitted for target projects by src/generators/check-stack-conformity.ts and ' +
      'rendered from src/templates/scripts/check-stack-conformity.mjs.ejs (CANON-01). ' +
      'Exit codes per INV-53: 0=PASS/SKIP, 1=FAIL (contradiction), 2=ERROR.',
  },
  {
    id: 'INV-122',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: false,
    title:
      'Update propagates template fixes to pristine generated files; user-modified files are preserved',
    description:
      '`arbiter update` must rewrite a skipIfExists-emitted file whose on-disk content is byte-' +
      "identical to arbiter's last recorded render (pristine, unmodified since generation) so upstream " +
      'template fixes reach the governed fleet; it must preserve a user-modified file (on-disk hash ≠ ' +
      'recorded baseline) and warn that the fix was withheld; and `arbiter diff` must report a pristine-' +
      'stale file as changed, never as a lying "unchanged". Provenance is a committed per-file content-' +
      'hash manifest (.arbiter-generated-manifest.json at the repo root, sibling of .arbiter-generated.' +
      'json), not config alone. A corrupt manifest fails closed (exit 2); a missing one is a legitimate ' +
      'first run that conservatively skips (#1328).',
    enforcement:
      'Integration tests (__tests__/integration/update-propagates-fixes.test.ts) + unit tests for the ' +
      'generation session and manifest (fs-generation-session, generated-manifest). Runtime-resident in ' +
      'the arbiter CLI engine (init/update/diff) and inherited by the fleet via the CLI — not a render-' +
      'time gate. Exit codes per INV-53: corrupt manifest ⇒ 2=ERROR.',
  },
  {
    id: 'INV-123',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: false,
    title: 'Emission coherence — every referenced emission must exist or be a declared optional',
    description:
      'A generated tree must contain every file it references. Every scripts/*.mjs invoked by ' +
      'check-all.mjs, every handler registered in .claude/hooks/hooks.mjs, every node script run by ' +
      'a .githook or a workflow, every command in .claude/settings.json, every script referenced by a ' +
      'Makefile recipe, and every script/hook named in a .claude/commands/*.md playbook must resolve ' +
      'to an emitted file. An UNGUARDED-missing reference is a crash-class ghost and ALWAYS fails. A GUARDED-missing ' +
      'reference (behind an existsSync()/shell [ -f ] guard — a legitimately-optional industry or ' +
      'frontend overlay script) fails UNLESS it is declared in scripts/optional-emissions.json with a ' +
      'non-empty rationale; the manifest can never silence an unguarded reference (strictly weaker than ' +
      'a suppression). Workflows must additionally SHA-pin every uses: ref (local ./ and docker:// ' +
      'excepted) and name every top-level job. Makefile-recipe and command-playbook references are ' +
      'UNGUARDED by construction and so can never be silenced. Caught the fleet-wide ci-classify-changes / ' +
      'exitplanmode-banner / build-kit ghosts (#1331) and the done-evidence / route-auditors ' +
      'Makefile/command-doc ghosts (#1345).',
    enforcement:
      "scripts/check-emission-coherence.mjs (pure checkEmissionCoherence(dir)) — wired into arbiter's " +
      'own check-all.mjs self-gate against the repo tree, and run across the FULL (language × level × ' +
      'mode) matrix by __tests__/integration/e2e/emission-coherence-matrix.test.ts (static, in-process, ' +
      'no toolchains, affordable per-PR). The optional manifest is emitted for target projects by ' +
      'src/generators/check-all.ts from src/templates/scripts/optional-emissions.json.ejs (CANON-01). ' +
      'Exit codes per INV-53: 0=PASS, 1=FAIL (ghost), 2=ERROR (no dir arg).',
  },

  // ─── Testing: Non-Empty Pyramid Levels ──────────────────────────────────────

  {
    id: 'INV-124',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: false,
    title: 'Declared test levels must be non-empty — no aspirational pyramid',
    description:
      'A project that declares a test level in test-pyramid.json (machine-readable manifest at ' +
      "repo root) must have ≥1 real test file matching that level's globs. OR semantics: a " +
      'required level passes if ANY of its declared globs matches ≥1 file. A level legitimately ' +
      'not needed must be explicitly marked status:"n/a" with a rationale ≥20 chars (auditable, ' +
      'mirrors the suppression-rationale gate). A fully-skipped pyramid (all levels n/a) is itself ' +
      'a hard fail — it defeats the gate. Manifest absent → gate SKIPS (exit 0), so ungoverned ' +
      'repos never false-fail; fail-closed is provided by generator emission (Track B) and the ' +
      'SSOT completeness test (Track A). Path-traversal globs and non-array levels.fields → exit 2 ' +
      '(schema error). Boundary: file PRESENCE only — assertion quality is INV-118 (anti-proforma). ' +
      'Rust L1 Unit is auto-emitted as n/a (inline #[test] annotations are undetectable by glob). ' +
      'Introduced in #1364 as child of epic #1363 ("proof must touch reality").',
    enforcement:
      'scripts/check-test-pyramid.mjs (L1) — self-gate wired in scripts/check-all.mjs; generated ' +
      'for targets via src/generators/check-all.ts UNCONDITIONAL_EMISSIONS from ' +
      'src/templates/scripts/check-test-pyramid.mjs.ejs (CANON-01/04/11). Manifest ' +
      'test-pyramid.json emitted for targets by src/generators/test-pyramid-manifest.ts ' +
      '(skipIfExists:true; archetype-mismatch guard at gate time). Exit codes per INV-53: ' +
      '0=PASS/SKIP, 1=policy violation, 2=schema/path-traversal error.',
  },
  // Domain<->API Surface Completeness (#1367)
  {
    id: 'INV-125',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: false,
    title: 'Persisted domain fields must be reachable through the public HTTP API',
    description:
      'A persisted domain field absent from both request and response schemas is inaccessible. ' +
      'The manifest domain-api-surface.json (schema: arbiter-domain-api-surface-v1) declares ' +
      'resources with per-field inRequestSchema/inResponseSchema flags. ' +
      'Gate fails when any persisted:true field has both flags false. Manifest absent => SKIP.',
    enforcement:
      'scripts/check-domain-api-surface.mjs (L1) — wired in check-all.mjs; ' +
      'generated for targets where config.hasPublicApi is true via emitDomainApiSurface helper (skipIfExists:true). ' +
      'Exit codes per INV-53: 0=PASS/SKIP, 1=surface gap, 2=schema/parse error.',
  },
  {
    id: 'INV-126',
    tier: 'operational',
    minGovernanceLevel: 'L2',
    selfOnly: false,
    alwaysActive: false,
    title: 'Service archetypes must ship a non-mocked live-API e2e suite',
    description:
      'A service archetype (backend-web-db) must exercise the RUNNING binary over real HTTP, ' +
      'not just mocked unit/integration tests. The manifest api-e2e.json declares ' +
      '{ archetype, required, suiteDir, framework, glob }; required:true (service) means the ' +
      'glob must match >=1 non-empty suite file under tests/api/ that boots the real binary and ' +
      'asserts on live responses. This is the INVERTED absent-semantics vs INV-124: a declared ' +
      'service with an absent or empty suite is a hard fail (exit 1), closing the "domain green, ' +
      'HTTP wiring broken" gap (a field in domain/DB never wired into the HTTP input => 400). ' +
      'required:false (non-service) or absent manifest => SKIP (exit 0). Boundary: file presence + ' +
      'non-emptiness only — the live run is CI/L2 via tests/api/run.sh; assertion quality is ' +
      'INV-118 (anti-proforma). Introduced in #1365 as a child of epic #1363 ("proof must touch ' +
      'reality").',
    enforcement:
      'scripts/check-api-e2e.mjs (L1) — self-gate wired in scripts/check-all.mjs; generated for ' +
      'targets via src/generators/check-all.ts UNCONDITIONAL_EMISSIONS from ' +
      'src/templates/scripts/check-api-e2e.mjs.ejs (CANON-01/04/11). Manifest api-e2e.json and the ' +
      'starter suite + tests/api/run.sh (chmod 0o755) emitted by src/generators/api-e2e.ts ' +
      '(skipIfExists:true; suite scaffolded only for service archetypes). Exit codes per INV-53: ' +
      '0=PASS/SKIP, 1=absent/empty suite, 2=schema/path-traversal error.',
  },

  // ─── Frontend Behavioural/Visual Gate — Render Smoke (#1366) ─────────────────

  {
    id: 'INV-127',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: false,
    title: 'Frontend archetypes must carry a render-smoke behavioural test',
    description:
      'A token-purity pass (no raw hex/px) does not prove the screen renders — a prior internal ' +
      'project shipped green while its UI was broken empty boxes. Any project whose archetype is frontend-spa, ' +
      'OR that declares a "frontend" lane, MUST carry a render-smoke behavioural test: a ' +
      'headless-browser (Playwright) spec that boots the built SPA and asserts the app shell + ' +
      'key screens mount with real content and ZERO console errors / uncaught page errors. The ' +
      'gate is PRESENCE-based (≥1 spec matching the render-smoke globs: tests/e2e/render-smoke.spec.ts, ' +
      '**/*.render-smoke.{spec,test}.ts, frontend/tests/e2e/render-smoke.spec.ts) — assertion quality ' +
      "is the spec author's job, executed by the CI render-smoke lane (16-frontend-quality.yml). " +
      'Non-frontend archetypes and ungoverned repos (no arbiter.json) SKIP, so they never false-fail. ' +
      'arbiter init scaffolds a starter spec for TS frontends; VRT against a committed baseline ' +
      'remains the stronger optional bar (VRT_SETUP.md). Introduced in #1366 as child of epic #1363 ' +
      '("proof must touch reality").',
    enforcement:
      'scripts/check-render-smoke.mjs (L1) — self-gate wired in scripts/check-all.mjs; generated ' +
      'for targets via src/generators/check-all.ts UNCONDITIONAL_EMISSIONS from ' +
      'src/templates/scripts/check-render-smoke.mjs.ejs (imports the shared scripts/lib/glob-walk.mjs ' +
      'helper, also unconditionally emitted). The starter spec is scaffolded for TS frontends by ' +
      'src/generators/frontend-quality.ts from src/templates/e2e/playwright-ts/render-smoke.spec.ts.ejs ' +
      '(skipIfExists:true). Exit codes per INV-53: 0=PASS/SKIP, 1=missing render-smoke spec, ' +
      '2=schema/parse error.',
  },

  // ─── Conformance Scorecard Script (#1398) ────────────────────────────────────

  {
    id: 'INV-128',
    tier: 'operational',
    title: 'Conformance script generated',
    description:
      'Every arbiter-governed project must ship a conformance scorecard runner ' +
      '(`scripts/conformance.mjs`). The runner is SELF-CONTAINED: the standalone ' +
      '`arbiter conformance` command was retired, so it no longer shells out to it — it ' +
      'points at `arbiter gold-audit` (the surviving governance scorecard: level band + ' +
      'missing items) and exits 0. Enforced by the conformance generator ' +
      '(UNCONDITIONAL_EMISSIONS entry in check-all.ts); wired as an advisory ' +
      '(runWarnCheck) in check-all.mjs L2 — informational, never hard-fails the gate.',
    selfOnly: false,
    alwaysActive: false,
    minGovernanceLevel: 'L1',
    enforcement:
      'scripts/conformance.mjs — emitted unconditionally for all governed targets via ' +
      'src/generators/check-all.ts UNCONDITIONAL_EMISSIONS from ' +
      'src/templates/scripts/conformance.mjs.ejs (CANON-01/04/11). Invoked as advisory ' +
      '(runWarnCheck) in generated scripts/check-all.mjs L2 behind existsSync guard ' +
      '(#1398/C6). Self-contained fail-closed runner (INV-96): a top-level catch exits ' +
      'non-zero on unexpected error. Exit codes per INV-53: 0=advisory OK, 2=ERROR.',
  },
  {
    id: 'INV-129',
    tier: 'governance',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: true,
    title: 'No tracked data/state files or compiled binaries in the index',
    description:
      'Neither the arbiter repo NOR any governed target project may track data/state ' +
      'files (*.sqlite, *.sqlite3, *.db, *.db-shm, *.db-wal) or compiled binaries ' +
      '(ELF / Mach-O / PE, detected by MAGIC BYTES) in the git index. This is distinct ' +
      'from INV-117 (selfOnly *.tgz build-artifact hygiene, kept unchanged): INV-129 is ' +
      'the DATA/STATE axis and applies downstream too. The three-way security split makes ' +
      'this gate load-bearing — a committed finance.sqlite trips NEITHER gitleaks (no ' +
      'secret pattern) NOR pii-scan (which skips binaries by extension), so without this ' +
      'gate a database full of records sits in history undetected. Binary detection is ' +
      'magic-byte-primary (a renamed Go/Rust binary cannot evade it); go.mod / cargo names ' +
      'are a secondary hint only. Allowlist for intentional binaries: __tests__/fixtures/** ' +
      'path prefixes + font/image/.wasm/.pdf extensions. Fail-closed: a non-git tree is an ' +
      'ERROR (exit 2), never a silent NO-DATA pass.',
    enforcement:
      'scripts/check-no-tracked-artifacts.mjs (L1, self — extended for data/state globs + ' +
      'magic-byte binary detection). Downstream: emitted for governed targets via ' +
      'src/generators/check-all.ts UNCONDITIONAL_EMISSIONS from ' +
      'src/templates/scripts/check-no-tracked-artifacts.mjs.ejs (CANON-01/04/11), wired at ' +
      'L1 in generated scripts/check-all.mjs. Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR.',
  },
  {
    id: 'INV-130',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: false,
    title: 'E2E flaky-test quarantine annotates but never suppresses, and cannot rot',
    description:
      'Every arbiter-governed project ships a stack-agnostic E2E reliability subsystem: a ' +
      'library (scripts/lib/e2e-reliability.mjs — deterministic failure fingerprint, ' +
      'INFRA/FLAKE/REGRESSION classify, initial→single-test→spec retry ladder, R0–R4 risk ' +
      'tier that fail-closes to R4, append-only JSONL ledger, quarantine schema) plus a ' +
      'fail-closed quarantine hygiene gate (scripts/check-e2e-quarantine.mjs). A quarantine ' +
      'entry ANNOTATES a known-unstable test but NEVER suppresses it — quarantined tests ' +
      'still run and still report, and CI exit codes are unchanged by membership. The gate ' +
      'enforces that the registry (.arbiter/e2e/quarantine.json) cannot ROT into a permanent ' +
      'silent mute: every entry must carry the full required-field set AND a FUTURE expires ' +
      'date; an expired, incomplete, or malformed entry fails closed (exit 1). Self-SKIPs ' +
      '(exit 0) when no registry is present (vacuous pass). This closes the #1 fake-green ' +
      'source for a prompt-only operator — a flake re-run green that masks a real regression. ' +
      '#1817 (A3): retries hide races, so the @smoke tier gets ZERO retries — ' +
      'retryLadder({ tier: "smoke" }) force-truncates the ladder to a single ["initial"] ' +
      'attempt, overriding any caller-supplied opts.scopes (non-bypassable). Quarantine rot ' +
      'is additionally surfaced as a conformance dimension (DISC-e2e-quarantine, tier-1 ' +
      'must-pass): a registry with an expired, incomplete, or malformed entry fails ' +
      '`arbiter conformance`, not just the local CI gate. ' +
      '#1817 (A4): this subsystem is one enforced slice of a broader, installable ~10-rule ' +
      'E2E determinism standard — docs/GOVERNANCE/E2E_CONSTITUTION.md, generated by ' +
      'generateE2eConstitution for any project with a Playwright harness (frontend-spa or ' +
      'backend-web-db). The installed file is customizable: arbiter never overwrites it once ' +
      'present (skipIfExists). DISC-e2e-quarantine evidence links back to it.',
    enforcement:
      'scripts/check-e2e-quarantine.mjs — emitted unconditionally for all governed targets ' +
      'via src/generators/check-all.ts UNCONDITIONAL_EMISSIONS from ' +
      'src/templates/scripts/check-e2e-quarantine.mjs.ejs (CANON-01/04/11), alongside the ' +
      'library src/templates/scripts/lib/e2e-reliability.mjs.ejs it imports; wired HARD ' +
      '(runCheck) at L1 in generated scripts/check-all.mjs. Track-B (not an arbiter ' +
      'self-gate). Exit codes per INV-53: 0=PASS/absent, 1=FAIL (expired/malformed), 2=ERROR. ' +
      '#1817 (A3): smoke-tier zero-retry contract lives in retryLadder() (same library, same ' +
      'template); quarantine-TTL rot is also probed by src/conformance/dimensions.ts ' +
      'probeE2eQuarantine (DISC-e2e-quarantine), wired in src/commands/conformance.ts ' +
      'collectDimensions() — an arbiter self-gate (Track-A), distinct from the emitted ' +
      'Track-B script above.',
  },
  {
    id: 'INV-131',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: false,
    title: 'TDD red→green evidence is re-verified on a fresh checkout in CI',
    description:
      'The rigor arbiter applies to itself (scripts/check-tdd-evidence.mjs re-verifies its ' +
      'own red→green evidence in CI) is shipped to governed targets: a generated, ' +
      'self-contained gate (scripts/check-tdd-evidence.mjs) re-verifies, on a FRESH CI ' +
      'checkout, that every task-ID commit on the branch carries valid TDD evidence — ' +
      'evidence file present + schema-valid, task_id matches, a recognised test-runner ' +
      'FAILURE signature present (proves RED), test_commit_sha exists in history, test_path ' +
      'exists in that commit. The emitted gate INLINES the schema + git checks so a target ' +
      'needs no local arbiter install. The ARBITER-SKIP-TDD commit trailer is forbidden. ' +
      'Self-SKIPs (exit 0) when origin/main is unavailable or no task-ID commits exist. ' +
      'Without this, a governed target never re-verifies its own evidence on a clean CI ' +
      'machine — the rigor stops at arbiter and is not delivered to its users.',
    enforcement:
      'scripts/check-tdd-evidence.mjs — emitted unconditionally for all governed targets via ' +
      'src/generators/check-all.ts UNCONDITIONAL_EMISSIONS from ' +
      'src/templates/scripts/check-tdd-evidence.mjs.ejs (CANON-01/04/11); wired HARD ' +
      '(runCheck) at L2 in generated scripts/check-all.mjs (independent of debt gates). ' +
      'Track-B (not an arbiter self-gate; arbiter dogfoods its own ' +
      'scripts/check-tdd-evidence.mjs which delegates to the CLI). Exit codes per INV-53: ' +
      '0=PASS/vacuous, 1=FAIL (missing/inconsistent evidence or forbidden skip trailer), 2=ERROR.',
  },
  {
    id: 'INV-132',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: true,
    alwaysActive: false,
    adr: 'ADR-098',
    title: 'arbiter init exposes a progressive-adoption tier on-ramp (bootstrap → L4)',
    description:
      '`arbiter init --tier <bootstrap|L1|L2|L3|L4>` is a progressive-adoption on-ramp so ' +
      'brownfield/startup teams are not forced into all-or-nothing governance. `bootstrap` ' +
      'is the gentlest Day-1 entry — it desugars to governance L1 (the minimal runnable ' +
      'gate) plus brownfield baseline lock-in, so a messy repo gets a gate that runs and ' +
      'passes (pre-existing debt is captured as a baseline, not thrown as day-1 red); ' +
      '`L1`–`L4` are governance-level aliases. The tier adds NO new persisted config field — ' +
      'it is a view over (governanceLevel, brownfield, grace) and desugars into the existing ' +
      '`--level` + `--brownfield` settings. The adoption ladder bootstrap→L1→L2→L3→L4 has ' +
      'documented entry/exit criteria; graduation uses the existing `arbiter upgrade-level` ' +
      '(grace-softened, ADR-028) and `arbiter configure` flows. selfOnly: this governs ' +
      "arbiter's own init CLI behaviour, not a gate emitted into target projects.",
    enforcement:
      'src/commands/init.ts (resolveAdoptionTier desugars --tier into governanceLevel + ' +
      'brownfield; runInit applies it before level resolution) + the --tier CLI option in ' +
      'src/cli.ts. Verified by __tests__/commands/init-tier.test.ts (red→green: bootstrap → ' +
      'L1 + brownfield, L1–L4 pass-through, invalid rejected, bootstrap config emits a ' +
      'runnable check-all.mjs). Documented in ADR-098. No runtime gate script (selfOnly CLI ' +
      'behaviour); not emitted to target projects.',
  },
  {
    id: 'INV-133',
    tier: 'governance',
    minGovernanceLevel: 'L2',
    selfOnly: false,
    alwaysActive: true,
    title: 'TODO max-age enforced via linked-issue creation date',
    description:
      'A TODO(#NNN) whose LINKED ISSUE was created more than MAX_AGE_DAYS (default 180) ' +
      'ago FAILS the gate. Age is derived from the issue `created_at` ONLY — never from ' +
      'line/blame/git metadata — so a TODO cannot be silently kept alive by re-touching ' +
      'its line. This complements INV-21 (orphan-TODO: every TODO must carry an issue ID): ' +
      'INV-21 makes a TODO traceable, INV-133 makes a traceable TODO age out. The gate ' +
      'walks source for TODO(#NNN), resolves OWNER/REPO from the git origin remote, and ' +
      'for each issue calls `gh api repos/OWNER/REPO/issues/NNN --jq .created_at` (cached ' +
      'per issue number to avoid rate limits). It GRACEFULLY SKIPS (exit 0) — never ' +
      'false-fails — when gh is missing, no token is present, the repo is offline, or no ' +
      'created_at could be resolved; only a genuinely over-age issue produces a FAIL. The ' +
      'age decision is a PURE function (isOverAge / classifyOverAge over an injected ' +
      '{issueNumber→created_at} map) so it is unit-tested without any live gh.',
    enforcement:
      'scripts/check-todo-max-age.mjs (L2, self) — emitted unconditionally for governed ' +
      'targets via src/generators/check-all.ts UNCONDITIONAL_EMISSIONS from ' +
      'src/templates/scripts/check-todo-max-age.mjs.ejs (CANON-01/04/11), wired at L2 in ' +
      'the generated scripts/check-all.mjs (behind the standard runCheck path) and in the ' +
      'self scripts/check-all.mjs. Graceful-skip: gh missing / token absent / offline → ' +
      'SKIP (exit 0), never a false-fail. Verified by __tests__/scripts/check-todo-max-age.test.ts ' +
      '(pure red→green: over-age map → FAIL classification, empty/offline map → SKIP) and ' +
      '__tests__/templates/check-todo-max-age-render.test.ts (CANON-04 render + cross-stack ' +
      'L2 wiring). Exit codes per INV-53: 0=PASS/SKIP, 1=FAIL (over-age), 2=ERROR.',
  },
  {
    id: 'INV-135',
    tier: 'operational',
    minGovernanceLevel: 'L1',
    selfOnly: false,
    alwaysActive: false,
    title: 'doc-set + anti-fake-green runners generated',
    description:
      'Every arbiter-governed project ships TWO Track-B thin runners that delegate to arbiter ' +
      'via npx so a consumer needs NO local `yaml` dep: scripts/check-doc-set.mjs (delegates to ' +
      '`arbiter doc-set` — the deterministic doc-set presence audit) and ' +
      'scripts/check-anti-fake-green.mjs (delegates to `arbiter anti-fake-green` — the ' +
      'disarm-proof guard aggregate). Both follow the gold-audit thin-runner shape (#1419, ' +
      'INV-128): a STATIC `spawnSync("npx", ["--no-install", "arbiter", "<cmd>", ...args])` ' +
      'delegation. Wired ADVISORY (runWarnCheck) at L2 in generated check-all.mjs so a fresh ' +
      'consumer passes with no day-1 redness — doc-set is advisory unless --strict, and the ' +
      'anti-fake-green gh-audit guards fail OPEN when `gh` is absent. The engine + its `yaml` ' +
      "parse run inside arbiter's own environment, never in the consumer.",
    enforcement:
      'scripts/check-doc-set.mjs + scripts/check-anti-fake-green.mjs — emitted unconditionally ' +
      'for all governed targets via src/generators/check-all.ts UNCONDITIONAL_EMISSIONS from ' +
      'src/templates/scripts/check-doc-set.mjs.ejs and ' +
      'src/templates/scripts/check-anti-fake-green.mjs.ejs (CANON-01/04/11). Both wired as ' +
      'advisory (runWarnCheck) in generated scripts/check-all.mjs L2 behind existsSync guards ' +
      '(#1428). Exit codes per INV-53: 0=PASS/advisory, 1=FAIL, 2=ERROR.',
  },
  {
    id: 'INV-134',
    tier: 'operational',
    minGovernanceLevel: 'L2',
    selfOnly: false,
    alwaysActive: false,
    title: 'per-module coverage non-regression ratchet',
    description:
      'Per-MODULE (per-file/package) test coverage is held to an upward-only ratchet with a ' +
      '±0.5pp slack: a module whose line coverage drops more than 0.5 percentage points below ' +
      'module-coverage-baseline.json is a regression. All-languages, greenfield-aware (a module ' +
      'with zero executable lines contributes nothing and never false-fails). ADVISORY at L2 ' +
      '(start-warn, promote-later) to bound false positives while the per-module baseline beds ' +
      'in. Complements — does not duplicate — the FE per-layer coverage ratchet (INV, FSD ' +
      'layers, frontend-only), the total-coverage greenfield gate (INV-30), and the bloat/debt ' +
      'ratchets (those gate size and debt, not per-module coverage erosion).',
    enforcement:
      'scripts/verify-module-coverage.mjs (Track-B — emitted to governed targets, not an ' +
      'arbiter self-gate) — emitted unconditionally via src/generators/check-all.ts ' +
      'UNCONDITIONAL_EMISSIONS from src/templates/scripts/verify-module-coverage.mjs.ejs ' +
      '(CANON-01/04/11). Reads the per-language coverage summary (TypeScript/JavaScript ' +
      'coverage/coverage-summary.json robustly; Java/Python/Rust/Go scaffolded to SKIP when ' +
      'their summary is absent/unsupported — never a false-fail), computes per-module line pct, ' +
      'and compares each module vs module-coverage-baseline.json via the pure exported ' +
      'compareModuleCoverage (±0.5pp slack, upward-only). First run with coverage and no ' +
      'baseline seeds the baseline (exit 0); no coverage artifact → SKIP; --update-baseline ' +
      'advances it (never auto-updated in CI). Wired ADVISORY (runWarnCheck) at L2 in the ' +
      'generated scripts/check-all.mjs behind existsSync. Verified by ' +
      '__tests__/generators/module-coverage-ratchet.test.ts (pure ratchet red→green: within ' +
      'slack PASS, drop >0.5pp VIOLATION, greenfield/first-run seed) + ' +
      '__tests__/templates/module-coverage-render.test.ts (render across archetypes). exit ' +
      '0=PASS/SKIP/seed, 1=regression (#1457).',
  },
  {
    id: 'INV-138',
    tier: 'governance',
    selfOnly: true,
    alwaysActive: true,
    title: 'Acceptance-criteria anchor — plans freeze issue AC; fit is evidenced per criterion',
    description:
      'A green gate certifies mechanics, not intent; rework lives in the gap between "green" ' +
      'and "what was asked". The anchor closes it in three steps. (1) Entry gate: an issue ' +
      'enters a wave / ship preflight only when its body carries explicit `AC-N:` acceptance ' +
      'criteria (beyond template stock lines), a Non-goals section, and the files/contracts it ' +
      'touches — otherwise it is labeled needs-clarification and excluded ' +
      '(issue-readiness.mjs, orchestration-time, gh allowed, deliberately not a gate step). ' +
      '(2) External DoD anchor: ' +
      'during implementation phases the active task plan freezes the issue AC verbatim under ' +
      '"## Acceptance Criteria" (explicit AC-N ids) plus "## Non-Goals", so acceptance tests ' +
      'derive from the issue, not from the implementing agent self-grading its own ' +
      'interpretation. (3) Fit evidence: at verification/close the reviewer-written ' +
      '.arbiter/evidence/ac-fit/<task>.json must cover every AC-N with verdict PASS and a cited ' +
      'file:line — the mechanical form of "unproven criterion = REJECT". Rework telemetry ' +
      '(rework-log.mjs, committed .arbiter/rework/ledger.jsonl) tags every redone PR ' +
      'with why + where-caught, making the issue template self-correcting. Flag-gated ' +
      '(features.acceptanceAnchor / ARBITER_ACCEPTANCE_ANCHOR) and vacuous without an active ' +
      'task, so main, CI and fresh clones stay green. AC↔test-title mapping stays a reviewer ' +
      'rubric, deliberately not a grep gate (CANON-22: contested heuristics advise).',
    enforcement:
      'scripts/check-acceptance.mjs (L1, flag-gated features.acceptanceAnchor; --plan mode for ' +
      'wave integrate) — wired runCheck in scripts/check-all.mjs. Pure parsing/validation core ' +
      'in scripts/lib/acceptance-criteria.mjs. Verified by ' +
      '__tests__/scripts/acceptance-criteria-lib.test.ts + ' +
      '__tests__/scripts/check-acceptance.test.ts + __tests__/scripts/issue-readiness.test.ts + ' +
      '__tests__/scripts/rework-log.test.ts (red→green). The orchestration tools ' +
      '(issue-readiness.mjs, rework-log.mjs, lib/acceptance-criteria.mjs) ARE emitted to ' +
      'governed targets via src/generators/check-all.ts UNCONDITIONAL_EMISSIONS ' +
      '(CANON-01/04, __tests__/templates/acceptance-anchor-scripts-render.test.ts), and #2405 ' +
      'closed the ADR-110 follow-up: check-acceptance.mjs is emitted from ' +
      'src/templates/scripts/check-acceptance.mjs.ejs and wired in the generated check-all ' +
      'via the `acceptance-anchor` row of gate-registry.yml.ejs (advisory). The catalog entry ' +
      'stays selfOnly because ACTIVATION is opt-in per project ' +
      '(features.acceptanceAnchor / ARBITER_ACCEPTANCE_ANCHOR): the mechanism now exists in ' +
      'every governed tree, but the RULE is not one every target is held to by default. ' +
      'exit 0=PASS/SKIP, 1=FAIL, 2=ERROR per INV-53.',
    adr: 'ADR-110',
  },
  {
    id: 'INV-139',
    tier: 'governance',
    selfOnly: true,
    alwaysActive: true,
    title: 'Fixture and smoke output must never land in real evidence directories',
    description:
      'A smoke or fixture run must never write into a real evidence root (.arbiter/evidence, .evidence). ' +
      'The origin is the #2176 /ship-v2 study, where two contaminated runs carrying `fake-*` finding IDs ' +
      'reached the real result set, passed every mechanical guard, and were caught only by the semantic judge. ' +
      'Detection is ANCHORED-SCALAR over parsed .json/.jsonl: whitespace-free string values and object keys ' +
      'matching /^fake-/ or containing STUDY_FAKE, deliberately NOT a substring grep because the live corpus ' +
      'legitimately contains 158 `fake-green`/`fake-db` occurrences inside multi-line diff and log blobs. ' +
      'An unparseable document is skipped, non-JSON artifacts are out of scope, and NO-DATA is a PASS so fresh ' +
      'clones and ungoverned repos never false-fail. The guard scans the FILESYSTEM rather than the git index ' +
      'so contamination is caught before it is committed; selfOnly because the marker set is arbiter-study ' +
      'vocabulary and would be a false-positive minefield in an arbitrary target project — the Track-B mirror ' +
      'waits on a project-configurable marker set.',
    enforcement:
      'scripts/check-fixture-isolation.mjs (L1 gate, self) — wired in scripts/check-all.mjs and ' +
      'also enrolled in the anti-fake-green aggregate roster (scripts/lib/anti-fake-green-guards.mjs, ' +
      'class file-scan, so a broken guard fails the aggregate) with a discrimination proof in ' +
      'scripts/lib/guard-flip-registry.mjs. Verified by __tests__/scripts/check-fixture-isolation.test.ts ' +
      '(red→green). exit 0=PASS/NO-DATA, 1=contamination, 2=ERROR per INV-53 (#2181).',
  },
]
