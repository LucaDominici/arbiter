// SPDX-License-Identifier: Apache-2.0
import type { Invariant } from './types.js'

export const INVARIANT_CATALOG: Invariant[] = [
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
    minGovernanceLevel: 'L2',
    enforcement:
      'CI (gitleaks secrets scan — security-early-fail job, runs before lint-and-test); ' +
      'local gate: `gitleaks detect --source . --baseline-path suppressions/.gitleaksignore` (L2 block)',
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
    minGovernanceLevel: 'L2',
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
      'CI dep-audit step per stack — TypeScript: `npm audit --audit-level=high`; ' +
      'Rust: rustsec/audit-check action; ' +
      'Java: OWASP Dependency-Check (failBuildOnCVSS=7.0, apply config/owasp-dependency-check.gradle); ' +
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
    alwaysActive: false,
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
    alwaysActive: false,
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
      'written to pass rather than tests that document expected behavior.',
    alwaysActive: true,
    minGovernanceLevel: 'L2',
    enforcement: 'process / code review',
  },

  {
    id: 'INV-27',
    tier: 'governance',
    title: 'Evidence artifacts must be generated for all gate runs',
    description:
      'At L3 (audit grade), every gate execution must produce machine-readable evidence ' +
      'artifacts (coverage reports, lint results, test output) that can be archived and ' +
      'reviewed by auditors. Gate runs without artifacts are non-compliant.',
    alwaysActive: true,
    minGovernanceLevel: 'L3',
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
    enforcement: 'CI gate (pitest in check-all.mjs L2) + generated pitest config',
  },

  // ─── Governance: Suppression Expiry ─────────────────────────────────────────

  {
    id: 'INV-31',
    tier: 'governance',
    title: 'Suppressions must have mandatory expiry',
    description:
      'Every suppression entry — both file-based (dependency-check-suppressions.xml, .gitleaksignore, ' +
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
    enforcement:
      'CI gate (scripts/check-matrix-fixtures.mjs — L1) + nightly real-project-matrix workflow',
  },

  // ─── Governance: L3 Evidence Gate ────────────────────────────────────────────

  {
    id: 'INV-33',
    tier: 'governance',
    title: 'L3 merges require valid evidence with obs_gate == PASS',
    description:
      'L3 governance mandates structured, machine-checkable evidence of deep validation ' +
      'before merging. The evidence harness (scripts/evidence-collect.mjs) writes ' +
      '.evidence/SUMMARY.json carrying the required schema ' +
      '{head_sha, head_sha_short, obs_gate, tests, coverage, mutation, security} ' +
      "plus a canonical sha field. A merge is blocked when obs_gate !== 'PASS', which " +
      'indicates that tests failed, coverage dropped below threshold, mutation score is ' +
      'insufficient, or critical security findings exist. The L3 gate runs ' +
      '`arbiter verify evidence` which: (1) validates the schema via src/evidence/summary.ts, ' +
      '(2) verifies the embedded sha, (3) confirms head_sha matches `git rev-parse HEAD`, ' +
      "and (4) requires obs_gate === 'PASS'. Any failure blocks merge.",
    alwaysActive: true,
    minGovernanceLevel: 'L3',
    enforcement:
      'check-all.mjs L3 block (reads .evidence/SUMMARY.json) + nightly pipeline (evidence-collect.mjs) + src/evidence/summary.ts validator',
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
      'Every hook in src/templates/claude/hooks/ must be declared in .arbiter/hooks-manifest.json ' +
      'with an explicit classification (HARD | ADVISORY). HARD hooks must empirically exit non-zero ' +
      'on a canonical violation fixture. Any hook file without a manifest entry, or any HARD hook ' +
      'that exits 0 on violation, fails CI. This prevents silent ceremony regression — where a hook ' +
      'is declared hard but silently exits 0.',
    alwaysActive: true,
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
      'Evidence is captured by running node scripts/done-evidence.mjs (runs L2 gate + pins source SHAs).',
    alwaysActive: true,
    enforcement:
      'src/templates/claude/hooks/guard-task-completion.mjs.ejs (exit 2) + ' +
      'src/templates/claude/hooks/guard-done-evidence.mjs.ejs (exit 2, SHA-pin validation) + ' +
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
      "src/templates/github/workflows/ci.yml.ejs (if: vars.PACT_BROKER_BASE_URL != '' + env: block) + " +
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
    alwaysActive: false,
    enforcement:
      'src/templates/scripts/verify-spotbugs.mjs.ejs (SECURITY_HARD_BLOCK set + exit 1) + ' +
      'src/templates/scripts/check-all.mjs.ejs (spotbugs baseline check at L2, Java)',
  },

  {
    id: 'INV-45',
    tier: 'governance',
    title:
      'Self-dogfood check — every EJS template must render to match its materialized .claude/ file',
    description:
      "Every EJS template under src/templates/claude/ must render (with arbiter's own config) " +
      'to content that matches the corresponding materialized .claude/ file. ' +
      'Files listed in .dogfood-divergences.json are explicitly exempted (intentional arbiter-internal ' +
      'extensions not appropriate for target projects). Config-gated templates are skipped when ' +
      'the relevant feature flag is disabled in arbiter.json. ' +
      'This invariant prevents arbiter from shipping stale template skeletons that diverge from ' +
      'its own governance without an explicit documented reason.',
    alwaysActive: true,
    enforcement: 'scripts/check-self-dogfood.mjs (L2 gate check) — exits 1 on unexpected drift',
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
    enforcement:
      '.claude/hooks/pre-edit-plan-anchor.mjs (CANON-16 Survey gate, exit 2) + ' +
      'scripts/check-bloat-ratchet.mjs (L1 ratchet) + ' +
      'npx jscpd (L2 duplication, see .jscpd.json)',
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
    id: 'INV-56',
    tier: 'governance',
    title: 'Knowledge-map freshness — line counts must not drift beyond tolerance',
    description:
      'Every **Lines:** entry in docs/METHOD/KNOWLEDGE_MAP.md must match the actual ' +
      'line count of the referenced document within ±30% tolerance. ' +
      'Lines: 0 entries are skipped (not yet populated). ' +
      'Missing referenced files are skipped. ' +
      'Run knowledge-map-update.mjs to refresh counts.',
    alwaysActive: true,
    enforcement: 'scripts/check-knowledge-map.mjs (L1 gate, #255)',
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
    languages: ['typescript'],
    minGovernanceLevel: 'L2',
    title: 'a11y critical violations are HARD-fail at L2',
    description:
      'For TS web archetypes (frontend-spa, backend-web-db) the generated ' +
      'tests/e2e/a11y/run-axe.ts wrapper runs @axe-core/playwright with the ' +
      'wcag2a + wcag2aa tag set and throws on any violation whose impact is ' +
      '`critical` OR unclassified (impact === null/undefined). serious / ' +
      'moderate / minor violations are logged without throwing — they remain ' +
      'evidence but do not block the gate. The default threshold matches the ' +
      'axe-core WCAG 2.1 AA baseline; downstream projects can ratchet it ' +
      'stricter by extending the wrapper. Matrix cell: a11y × typescript = ' +
      'proven (axe-core/playwright). Python pairs with axe-playwright-python ' +
      'at beta maturity. Other languages have no browser surface (unavailable).',
    alwaysActive: false,
    enforcement:
      'Generated tests/e2e/a11y/run-axe.ts wrapper throws on critical / ' +
      'unclassified impact — pytest/playwright surfaces the throw as a failed ' +
      'spec, which fails the L2 playwright-e2e gate step in scripts/check-all.mjs',
  },
]
