---
generated: true
source: 'docs/PRODUCT/CROSS-LANGUAGE-MATRIX.md'
source_sha: '8af08f7f44dc822fc2d355c88a0496a86378fd80'
last_updated: '2026-06-06'
---

# Arbiter — Cross-Language Enforcement Matrix

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/CROSS-LANGUAGE-MATRIX.md](../docs/PRODUCT/CROSS-LANGUAGE-MATRIX.md)

# Arbiter — Cross-Language Enforcement Matrix

**Status:** Active
**Last updated:** 2026-04-17 (M22c: Go boundaries via depguard; M22d: Python boundaries via import-linter + ruff)

For every enforcement mechanism, arbiter must generate the equivalent for all 5 supported languages. This matrix is the canonical reference.

### Maturity Legend

| Value         | Meaning                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `proven`      | Verified working in a real repo; nightly CI runs it. Safe to generate at L3.                                      |
| `beta`        | Works but has limited adoption or known edge cases. Requires `--accept-beta-tools` to generate L3 features.       |
| `unsafe`      | Known failure modes that make gate enforcement unreliable. L3 generation blocked even with `--accept-beta-tools`. |
| `unavailable` | No equivalent tool exists for this language. L3 generation blocked.                                               |

Machine-readable maturity data: `src/compatibility/cross-language-matrix.json`
Generator gate: `src/utils/maturity-check.ts::isL3Allowed()`

---

## Tool Equivalents

| Mechanism                   | Java                                    | TypeScript                             | Rust                        | Go                         | Python                         | Maturity (Java / TS / Rust / Go / Python)                    |
| --------------------------- | --------------------------------------- | -------------------------------------- | --------------------------- | -------------------------- | ------------------------------ | ------------------------------------------------------------ |
| **Architecture boundaries** | ArchUnit                                | eslint-plugin-boundaries               | cargo-deny + clippy         | golangci-lint (depguard)   | import-linter + ruff           | proven / proven / proven / proven / proven                   |
| **Complexity limits**       | Checkstyle (CC≤15, method≤65, params≤7) | ESLint (complexity: 15, max-params: 5) | clippy cognitive_complexity | gocyclo (≤15)              | ruff C901 (≤15)                | proven / proven / proven / proven / proven                   |
| **Static analysis**         | PMD + SpotBugs                          | ESLint strict + TypeScript strict      | clippy pedantic + deny      | golangci-lint (full suite) | ruff (full rules) + mypy       | proven / proven / proven / proven / proven                   |
| **Formatting**              | Spotless (Google Java Format)           | Prettier                               | rustfmt                     | gofmt                      | ruff format                    | proven / proven / proven / proven / proven                   |
| **Coverage**                | JaCoCo (line≥80%, branch≥70%)           | vitest/c8 (≥80%)                       | cargo-tarpaulin (≥80%)      | go test -cover (≥80%)      | pytest-cov (≥80%)              | proven / proven / proven / proven / proven                   |
| **Mutation testing**        | PIT / pitest (≥85%)                     | Stryker (≥85%)                         | cargo-mutants (≥85%)        | go-mutesting               | mutmut (≥85%)                  | proven / proven / **beta** / **unsafe** / **beta**           |
| **Dep security**            | OWASP DependencyCheck (CVSS≥7)          | npm audit --audit-level=high           | cargo audit                 | govulncheck                | pip-audit / safety             | proven / proven / proven / proven / proven                   |
| **Secrets scanning**        | Gitleaks                                | Gitleaks                               | Gitleaks                    | Gitleaks                   | Gitleaks                       | proven / proven / proven / proven / proven                   |
| **Integration DB**          | Testcontainers (postgresql)             | testcontainers-node                    | sqlx test (real DB)         | testcontainers-go          | testcontainers-python          | proven / proven / proven / proven / proven                   |
| **API testing**             | RestAssured                             | supertest                              | reqwest                     | net/http/httptest          | httpx                          | proven / proven / proven / proven / proven                   |
| **Contract testing**        | pact-jvm                                | @pact-foundation/pact                  | pact_consumer               | pact_consumer (Go)         | pact-python                    | proven / proven / **beta** / **beta** / **beta**             |
| **DB migrations**           | Flyway                                  | Prisma Migrate / Drizzle               | diesel / sqlx               | golang-migrate             | Alembic                        | proven / proven / proven / proven / proven                   |
| **E2E testing**             | RestAssured IT (backend)                | Playwright                             | N/A (CLI)                   | N/A (CLI)                  | Playwright / pytest-playwright | proven / proven / **unavailable** / **unavailable** / proven |
| **A11y (INV-61)**           | N/A (server-side)                       | axe-core/playwright (wcag2a+wcag2aa)   | N/A (no browser)            | N/A (no browser)           | axe-playwright-python          | unavailable / proven / unavailable / unavailable / **beta**  |
| **Dead code**               | PMD unused rules                        | Knip                                   | clippy dead_code            | golangci-lint deadcode     | ruff F401/F811                 | proven / proven / proven / proven / proven                   |
| **Circular deps**           | jdeps / ArchUnit                        | madge                                  | Rust compiler (native)      | Go compiler (native)       | ruff / custom                  | proven / proven / proven / proven / proven                   |
| **Type safety**             | no raw types (ArchUnit)                 | no `any` (ESLint)                      | no `.unwrap()` (clippy)     | error checking (go vet)    | type annotations (mypy)        | proven / proven / proven / proven / proven                   |
| **No MockMvc**              | ArchUnit NoMockMvcTest                  | N/A                                    | N/A                         | N/A                        | N/A                            | proven / N/A / N/A / N/A / N/A                               |

---

## Build Tool Integration

| Mechanism           | Gradle (Java)                   | npm (TypeScript)               | Cargo (Rust)                 | go (Go)               | pip/uv (Python)              |
| ------------------- | ------------------------------- | ------------------------------ | ---------------------------- | --------------------- | ---------------------------- |
| **Quality gate**    | `gradle check`                  | `npm run lint && npm test`     | `cargo clippy && cargo test` | `go vet && go test`   | `ruff check && pytest`       |
| **Coverage report** | JaCoCo HTML/XML/LCOV            | vitest --coverage              | cargo-tarpaulin --out Html   | go test -coverprofile | pytest-cov --cov-report html |
| **Mutation gate**   | `gradle pitest`                 | `npx stryker run`              | `cargo mutants`              | `go-mutesting ./...`  | `mutmut run`                 |
| **Format check**    | `gradle spotlessCheck`          | `npx prettier --check .`       | `cargo fmt --check`          | `gofmt -l .`          | `ruff format --check .`      |
| **Dep audit**       | `gradle dependencyCheckAnalyze` | `npm audit --audit-level=high` | `cargo audit`                | `govulncheck ./...`   | `pip-audit`                  |

---

## CI

_[content truncated — see source for full text]_
