import type { Invariant } from "./types.js";

export const INVARIANT_CATALOG: Invariant[] = [
  // ─── Tier 1: Architectural Integrity (6) ─────────────────────────────────

  {
    id: "INV-01",
    tier: "architectural",
    title: "No circular dependencies between modules",
    description:
      "Circular imports create tight coupling and make modules impossible to test in isolation. " +
      "Every module must have a clear single direction of dependency. Detected by static analysis in CI.",
    alwaysActive: true,
    enforcement: "CI (madge / go vet / cargo check / pylint)",
  },

  {
    id: "INV-02",
    tier: "architectural",
    title: "Public API surface must be intentional — no accidental exports",
    description:
      "Every publicly exported symbol is a commitment to callers. Exporting by default leaks " +
      "implementation details and makes refactoring costly. Only intentionally designed symbols " +
      "may be public.",
    alwaysActive: true,
    enforcement: "CI (Knip / cargo doc / PMD / unused linters)",
  },

  {
    id: "INV-03",
    tier: "architectural",
    title: "Architecture boundary enforcement",
    description:
      "Layers must respect their dependency direction. Domain/business logic must not import " +
      "from infrastructure or adapters. Boundary violations break testability and portability.",
    languageDetail: {
      typescript:
        "Layer boundaries enforced — domain code must not import from infrastructure layers",
      java: "Hexagonal architecture — domain must not import from adapters or infrastructure",
      rust: "Module visibility enforced — `pub(crate)` preferred over `pub` for internal APIs",
      go: "Package boundaries enforced — minimize `internal/` escapes and cross-layer imports",
      python:
        "Module boundaries enforced — no circular imports, layered architecture respected",
      unknown:
        "Architecture boundary enforcement — layers must respect their dependency direction",
    },
    alwaysActive: true,
    enforcement: "CI (ArchUnit / architecture linters / manual)",
  },

  {
    id: "INV-04",
    tier: "architectural",
    title: "Language-specific type safety",
    description:
      "Each language has idioms for expressing and enforcing type safety at compile or lint time. " +
      "Bypassing these mechanisms removes the safety net and allows runtime errors that the type " +
      "system was designed to prevent.",
    languages: ["typescript", "java", "rust", "go", "python"],
    languageDetail: {
      typescript:
        "No `any` type in TypeScript — use `unknown` and narrow, or create proper types",
      java: "No raw types — generics must be parameterized (e.g. `List<String>` not `List`)",
      rust: "No `.unwrap()` calls in library code — use `?` or explicit error handling",
      go: "Explicit error handling required — no silenced errors with blank identifier",
      python: "Type annotations required on all public function signatures",
    },
    alwaysActive: true,
    enforcement:
      "hook + CI (ESLint no-explicit-any / cargo clippy / ruff / golangci-lint)",
  },

  {
    id: "INV-05",
    tier: "architectural",
    title: "Complexity limits enforced",
    description:
      "High cyclomatic complexity correlates with defect density and makes code harder to test. " +
      "Functions and methods must stay within complexity bounds to ensure readability and testability.",
    languages: ["typescript", "java", "rust", "go", "python"],
    languageDetail: {
      typescript: "Cyclomatic complexity ≤ 15 (ESLint `complexity` rule)",
      java: "Cyclomatic complexity ≤ 15, method length ≤ 65 LOC (PMD CyclomaticComplexity)",
      rust: "Cognitive complexity enforced via `clippy::pedantic` lint level",
      go: "Cyclomatic complexity ≤ 15 (`gocyclo` via golangci-lint)",
      python: "Cyclomatic complexity ≤ 15 (`ruff C901` rule)",
    },
    alwaysActive: true,
    enforcement: "CI (ESLint / PMD / clippy / golangci-lint / ruff)",
  },

  {
    id: "INV-06",
    tier: "architectural",
    title: "No unused or dead code",
    description:
      "Dead code is a maintenance liability — it misleads readers, bloats binaries, and may " +
      "hide latent bugs. All exported symbols and dependencies must be actively used.",
    languages: ["typescript", "java", "rust", "go", "python"],
    languageDetail: {
      typescript: "No unused exports (Knip dead code analysis, zero findings)",
      java: "No unused code (PMD UnusedCode rules, zero violations)",
      rust: "No dead code (`#[warn(dead_code)]` via clippy, zero warnings)",
      go: "No unused code (`deadcode,unused` via golangci-lint, zero findings)",
      python:
        "No unused imports or variables (ruff `F401,F811`, zero findings)",
    },
    alwaysActive: true,
    enforcement: "CI (Knip / PMD / clippy / golangci-lint / ruff)",
  },

  // ─── Tier 2: Data Integrity (4) ──────────────────────────────────────────

  {
    id: "INV-07",
    tier: "data",
    title: "Schema changes via versioned migrations only — no manual DDL",
    description:
      "Database schema must evolve through versioned migration files (e.g. Flyway, Alembic, " +
      "golang-migrate). Direct ALTER TABLE in application code, ORM auto-schema, or manual " +
      "production changes are forbidden. Every schema state must be reproducible from migration history.",
    alwaysActive: false,
    enforcement: "CI (migration lint / manual review)",
  },

  {
    id: "INV-08",
    tier: "data",
    title: "Input validation at system boundaries",
    description:
      "All data entering the system from external sources (HTTP requests, message queues, " +
      "files, user input) must be validated and rejected if malformed before reaching domain " +
      "logic. Never trust external input.",
    alwaysActive: false,
    enforcement: "code review / integration tests",
  },

  {
    id: "INV-09",
    tier: "data",
    title: "Audit trail for mutable entities",
    description:
      "Every create, update, or delete on business-critical entities must be auditable. " +
      "Changes must be traceable to the acting user, timestamp, and prior state.",
    alwaysActive: false,
    minGovernanceLevel: "L2",
    enforcement: "code review / integration tests",
  },

  {
    id: "INV-10",
    tier: "data",
    title: "Soft delete preferred over hard delete",
    description:
      "Business data should be logically deleted (e.g. `deleted_at` timestamp, `is_active` flag) " +
      "rather than physically removed. Hard delete is permitted only for explicit GDPR erasure " +
      "flows. Queries must exclude soft-deleted records by default.",
    alwaysActive: false,
    enforcement: "code review / ArchUnit or equivalent",
  },

  // ─── Tier 3: Security & Compliance (5) ───────────────────────────────────

  {
    id: "INV-11",
    tier: "security",
    title: "No secrets in source code",
    description:
      "API keys, passwords, tokens, and other secrets must never appear in source files, " +
      "configuration files committed to version control, or log output. Use environment " +
      "variables or secret managers (Vault, AWS Secrets Manager, etc.).",
    alwaysActive: true,
    minGovernanceLevel: "L2",
    enforcement:
      "CI (gitleaks secrets scan — security-early-fail job, runs before lint-and-test); " +
      "local gate: `gitleaks detect --source . --baseline-path suppressions/.gitleaksignore` (L2 block)",
  },

  {
    id: "INV-12",
    tier: "security",
    title: "No PII in code, tests, or logs",
    description:
      "Personally identifiable information (emails, phone numbers, credit card numbers) must not " +
      "appear in source code, test fixtures, or log output. Mask or redact PII before logging. " +
      "Required for GDPR/NIS2 compliance. Enforced by static scan (pii-scan.mjs) as a HARD " +
      "early-fail gate — no grace-period exception applies.",
    alwaysActive: true,
    minGovernanceLevel: "L2",
    enforcement:
      "CI (pii-scan.mjs — security-early-fail job, HARD early-fail, no grace period); " +
      "local gate: `node scripts/pii-scan.mjs` runs before all L1 checks; " +
      "Claude hook: check-no-pii.mjs (PostToolUse, Edit|Write)",
  },

  {
    id: "INV-13",
    tier: "security",
    title: "Dependencies scanned for known vulnerabilities",
    description:
      "All third-party dependencies must be scanned for CVEs before each release. " +
      "High-severity vulnerabilities (CVSS ≥ 7.0) block deployment. Dependency updates must be " +
      "reviewed for breaking changes.",
    alwaysActive: true,
    minGovernanceLevel: "L2",
    enforcement:
      "CI dep-audit step per stack — TypeScript: `npm audit --audit-level=high`; " +
      "Rust: rustsec/audit-check action; " +
      "Java: OWASP Dependency-Check (failBuildOnCVSS=7.0, apply config/owasp-dependency-check.gradle); " +
      "Go: golang/govulncheck-action; " +
      "Python: pip-audit. " +
      "Local gate (L2 block): same commands, soft: graceActive",
  },

  {
    id: "INV-14",
    tier: "security",
    title: "No dynamic code execution with untrusted input",
    description:
      "Dynamic code or shell execution using untrusted input is a critical injection vulnerability. " +
      "Never pass user-controlled data to dynamic evaluation or shell-execution mechanisms without sanitization.",
    languages: ["typescript", "java", "rust", "go", "python"],
    languageDetail: {
      typescript:
        "No dynamic code evaluation (`eval` function or `Function` constructor) with untrusted input",
      java: "No shell command execution (Runtime, ProcessBuilder) with unsanitized user input",
      rust: "No unsafe FFI calls or shell execution with untrusted data",
      go: "No shell execution with unsanitized user input",
      python:
        "No dynamic code evaluation (`eval`/`exec` builtins) or subprocess calls with untrusted input",
    },
    alwaysActive: false,
    enforcement: "code review / SAST (semgrep / CodeQL)",
  },

  {
    id: "INV-15",
    tier: "security",
    title: "Authentication required at every entry point",
    description:
      "Every API endpoint, message consumer, and job scheduler must authenticate the caller " +
      "unless explicitly designated as public. Default-deny authentication; explicit opt-out " +
      "requires ADR approval.",
    alwaysActive: false,
    enforcement: "code review / integration tests",
  },

  // ─── Tier 4: Operational Excellence (5) ──────────────────────────────────

  {
    id: "INV-16",
    tier: "operational",
    title: "Structured logging only — no raw print statements in production",
    description:
      "Production code must use a structured logging library that emits machine-parseable " +
      "output (JSON). Raw print statements bypass log level filtering, structured fields, " +
      "and correlation IDs. Every log entry should include `traceId` where applicable.",
    languages: ["typescript", "java", "rust", "go", "python"],
    languageDetail: {
      typescript:
        "No `console.log/warn/error` in production code — use structured logger",
      java: "No `System.out.println()` in production code — use SLF4J with structured output",
      rust: "No `println!` or `eprintln!` in library code — use `tracing` or `log` crate",
      go: "No `fmt.Print*` in production code — use `slog` or structured logger",
      python:
        "No `print()` in production code — use `logging` module with structured formatter",
    },
    alwaysActive: false,
    enforcement: "hook + CI (lint rules / grep / ESLint no-console)",
  },

  {
    id: "INV-17",
    tier: "operational",
    title:
      "Explicit error handling — panics and unhandled errors are forbidden",
    description:
      "Unhandled errors and unexpected panics cause silent data corruption or opaque crashes. " +
      "Every error path must be explicitly handled, logged, or propagated with context.",
    languages: ["typescript", "java", "rust", "go", "python"],
    languageDetail: {
      typescript:
        "Unhandled Promise rejections forbidden — always `.catch()` or `await` in `try/catch`",
      java: "Empty catch blocks forbidden — exceptions must be handled or rethrown with context",
      rust: "`panic!` forbidden in library code — use `Result<T, E>` for error propagation",
      go: "`recover()` must log and reraise, never silently discard panics",
      python:
        "Bare `except:` clause forbidden — always specify exception type and log the error",
    },
    alwaysActive: false,
    enforcement: "hook + CI (lint rules / clippy)",
  },

  {
    id: "INV-18",
    tier: "operational",
    title: "No hardcoded environment values",
    description:
      "Configuration values that differ between environments (URLs, ports, timeouts, feature " +
      "flags) must be externalized via environment variables or configuration files, never " +
      "hardcoded in source. This enables environment parity and safe deployments.",
    alwaysActive: false,
    enforcement: "code review / SAST",
  },

  {
    id: "INV-19",
    tier: "operational",
    title: "Resilient external calls — circuit breaker or retry required",
    description:
      "Every outbound call to an external service (HTTP, database, queue) must be wrapped in " +
      "a resilience pattern: retry with exponential backoff and/or circuit breaker. " +
      "Unbounded blocking calls and missing timeouts cause cascading failures.",
    alwaysActive: false,
    minGovernanceLevel: "L2",
    enforcement: "code review / integration tests",
  },

  {
    id: "INV-20",
    tier: "operational",
    title: "Health and readiness endpoints required for deployed services",
    description:
      "Every deployed service must expose `/health` (liveness) and `/ready` (readiness) " +
      "endpoints that orchestrators (Kubernetes, ECS, etc.) can probe. These endpoints must " +
      "reflect actual dependency health, not just process uptime.",
    alwaysActive: false,
    minGovernanceLevel: "L2",
    enforcement: "integration tests / deployment checks",
  },

  // ─── Tier 5: Governance (10) ──────────────────────────────────────────────

  {
    id: "INV-21",
    tier: "governance",
    title: "Every TODO comment must reference a task ID: `TODO(#NNN)`",
    description:
      "Orphan TODOs without a task ID cannot be tracked or prioritized and accumulate as " +
      "invisible tech debt. Every TODO must link to a trackable issue so it can be scheduled " +
      "or explicitly deferred.",
    alwaysActive: true,
    enforcement: "hook (check-no-orphan-todo.mjs) + CI",
  },

  {
    id: "INV-22",
    tier: "governance",
    title: "Branch naming: `task/#NNN-description`",
    description:
      "Consistent branch naming enables automatic linking between code and issue trackers, " +
      "makes CI filtering predictable, and allows automated branch cleanup.",
    alwaysActive: true,
    enforcement: "pre-push hook / CI branch name check",
  },

  {
    id: "INV-23",
    tier: "governance",
    title: "No direct commits to `main` — all changes via task branches + PR",
    description:
      "Direct commits to the main branch bypass code review, CI validation, and the PR " +
      "discussion record. All changes must flow through a PR from a task branch.",
    alwaysActive: true,
    enforcement: "branch protection (GitHub) / pre-push hook",
  },

  {
    id: "INV-24",
    tier: "governance",
    title: "Gate must pass before commit: `node scripts/check-all.mjs L1`",
    description:
      "The L1 gate (lint + unit tests) is the minimum bar for any commit. Committing broken " +
      "code wastes reviewer time and breaks other developers' workflows.",
    alwaysActive: true,
    enforcement: "pre-commit hook / CI",
  },

  {
    id: "INV-25",
    tier: "governance",
    title: "Gate must pass before push: `node scripts/check-all.mjs L2`",
    description:
      "The L2 gate (L1 + coverage + integration tests) verifies that the feature works end-to-end " +
      "before others are affected. Pushing broken code blocks the team.",
    alwaysActive: true,
    enforcement: "pre-push hook / CI",
  },

  {
    id: "INV-26",
    tier: "governance",
    title: "TDD mandatory — test first, then implement",
    description:
      "Test-driven development forces explicit design thinking before coding and produces code " +
      "that is testable by construction. Writing tests after the fact often results in tests " +
      "written to pass rather than tests that document expected behavior.",
    alwaysActive: true,
    minGovernanceLevel: "L2",
    enforcement: "process / code review",
  },

  {
    id: "INV-27",
    tier: "governance",
    title: "Evidence artifacts must be generated for all gate runs",
    description:
      "At L3 (audit grade), every gate execution must produce machine-readable evidence " +
      "artifacts (coverage reports, lint results, test output) that can be archived and " +
      "reviewed by auditors. Gate runs without artifacts are non-compliant.",
    alwaysActive: true,
    minGovernanceLevel: "L3",
    enforcement: "CI (evidence collection step)",
  },

  {
    id: "INV-28",
    tier: "governance",
    title: "SSOT documents must not contradict — run drift check before merge",
    description:
      "At L3, SSOT (Single Source of Truth) documents (AGENTS.md, architecture docs, " +
      "API contracts) must stay consistent. Contradictions between governance documents " +
      "create ambiguity for agents and humans alike.",
    alwaysActive: true,
    minGovernanceLevel: "L3",
    enforcement: "CI (drift check / pre-merge hook)",
  },

  // ─── Java-specific: Test Architecture ────────────────────────────────────────

  {
    id: "INV-29",
    tier: "architectural",
    title: "No MockMvc — use RestAssured for integration tests (Java)",
    description:
      "MockMvc tests the controller layer through a mock servlet container, bypassing real HTTP " +
      "serialization, filter chains, exception handlers, and content negotiation. Bugs in those " +
      "layers pass MockMvc and break in production. RestAssured tests the full HTTP stack with a " +
      "real embedded server, providing genuine end-to-end confidence.",
    languages: ["java"],
    alwaysActive: true,
    enforcement:
      "hook (check-no-mockmvc.mjs) + ArchUnit (NoMockMvcTest.java) + policy",
  },

  {
    id: "INV-30",
    tier: "operational",
    title: "Mutation testing required — PIT/pitest (Java, L2+)",
    description:
      "Line coverage measures which lines execute but not whether tests verify behavior. " +
      "A suite can reach 90% coverage with assertions that check nothing meaningful. " +
      "Mutation testing (PIT/pitest) injects faults into production code and verifies tests fail — " +
      "proving genuine fault-detection power. Thresholds: 80% mutation score, 85% line coverage. " +
      "Scope: domain and application layers only (not adapters/controllers).",
    languages: ["java"],
    alwaysActive: false,
    minGovernanceLevel: "L2",
    enforcement:
      "CI gate (pitest in check-all.mjs L2) + generated pitest config",
  },

  // ─── Governance: Suppression Expiry ─────────────────────────────────────────

  {
    id: "INV-31",
    tier: "governance",
    title: "Suppressions must have mandatory expiry",
    description:
      "Every suppression entry in dependency-check-suppressions.xml, .gitleaksignore, " +
      "pii-allowlist.json, and archunit-baseline.json must carry four mandatory metadata " +
      "fields: reason (≥10 chars), owner (@github-handle), expiresAt (ISO date), and scope. " +
      "Entries with a past expiresAt block the L1 gate. There are no permanent suppressions — " +
      "waivers must be renewed or removed when the underlying issue is resolved.",
    alwaysActive: true,
    enforcement:
      "CI gate (scripts/check-suppressions.mjs — L1) + pre-commit hook",
  },

  // ─── Governance: Real-Project Matrix Coverage ───────────────────────────────

  {
    id: "INV-32",
    tier: "governance",
    title: "Every 'proven' language must have a nightly real-project fixture",
    description:
      "Arbiter's cross-language-matrix.json tracks tool maturity per language. A 'proven' " +
      "rating implies the tool chain works end-to-end on real projects. Every language that " +
      "carries at least one 'proven' cell must have a corresponding fixture under " +
      "__tests__/fixtures/real-projects/ so the nightly real-project-matrix workflow can " +
      "exercise the full arbiter pipeline (init → verify → check-all) against it. " +
      "Promoting a language to 'proven' without a fixture is rejected by the L1 gate.",
    alwaysActive: true,
    enforcement:
      "CI gate (scripts/check-matrix-fixtures.mjs — L1) + nightly real-project-matrix workflow",
  },

  // ─── Governance: L3 Evidence Gate ────────────────────────────────────────────

  {
    id: "INV-33",
    tier: "governance",
    title: "L3 merges require valid evidence with obs_gate == PASS",
    description:
      "L3 governance mandates structured, machine-checkable evidence of deep validation " +
      "before merging. The evidence harness (scripts/evidence-collect.mjs) writes " +
      ".evidence/SUMMARY.json containing an obs_gate field. A merge is blocked when " +
      "obs_gate !== 'PASS', which indicates that tests failed, coverage dropped below " +
      "threshold, mutation score is insufficient, or critical security findings exist. " +
      "The nightly pipeline populates this evidence; the L3 check-all.mjs gate reads it.",
    alwaysActive: true,
    minGovernanceLevel: "L3",
    enforcement:
      "check-all.mjs L3 block (reads .evidence/SUMMARY.json) + nightly pipeline (evidence-collect.mjs)",
  },

  // ─── Data: Real Database Enforcement ─────────────────────────────────────────

  {
    id: "INV-34",
    tier: "data",
    title: "Integration tests must use real database (L2+)",
    description:
      "Integration tests must execute against a real database via Testcontainers at L2+. " +
      "In-memory databases (H2, SQLite in-memory mode) are forbidden as a substitute for a " +
      "real database engine. Tests that pass against an in-memory store may fail against the " +
      "production database due to SQL dialect differences, constraint handling, and index behaviour.",
    alwaysActive: false,
    minGovernanceLevel: "L2",
    enforcement:
      "check-all.mjs integration test step (L2+ when hasDatabase=true); " +
      "anti-fake-DB gates: ArchUnit NoH2ArchTest (Java), ESLint no-restricted-imports (TypeScript), " +
      "ruff F401-style check (Python); generated by src/generators/integration-testing.ts",
  },

  // ─── Operational: Contract Testing Enforcement ───────────────────────────────

  {
    id: "INV-35",
    tier: "operational",
    title: "Contract testing enforced when contractType is active",
    description:
      "When contractType !== 'none', contract tests must run in CI at L2+ and are a HARD gate. " +
      "Failures block merge. Supported contract types: rest-owned, rest-public, graphql, grpc, message-queue. " +
      "Each type generates the appropriate tooling (Pact, graphql-inspector, buf) and CI job.",
    alwaysActive: false,
    minGovernanceLevel: "L2",
    enforcement:
      "check-all.mjs L2 contract gate + CI contract-verify job; generated by src/generators/contract-testing.ts",
  },
];
