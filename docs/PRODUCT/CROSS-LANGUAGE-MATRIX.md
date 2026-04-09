# Arbiter — Cross-Language Enforcement Matrix

**Status:** Active
**Last updated:** 2026-04-09

For every enforcement mechanism, arbiter must generate the equivalent for all 5 supported languages. This matrix is the canonical reference.

---

## Tool Equivalents

| Mechanism                   | Java                                    | TypeScript                             | Rust                        | Go                         | Python                         |
| --------------------------- | --------------------------------------- | -------------------------------------- | --------------------------- | -------------------------- | ------------------------------ |
| **Architecture boundaries** | ArchUnit                                | eslint-plugin-boundaries               | cargo-deny + clippy         | go/analysis                | import-linter + ruff           |
| **Complexity limits**       | Checkstyle (CC≤15, method≤65, params≤7) | ESLint (complexity: 15, max-params: 5) | clippy cognitive_complexity | gocyclo (≤15)              | ruff C901 (≤15)                |
| **Static analysis**         | PMD + SpotBugs                          | ESLint strict + TypeScript strict      | clippy pedantic + deny      | golangci-lint (full suite) | ruff (full rules) + mypy       |
| **Formatting**              | Spotless (Google Java Format)           | Prettier                               | rustfmt                     | gofmt                      | ruff format                    |
| **Coverage**                | JaCoCo (line≥80%, branch≥70%)           | vitest/c8 (≥80%)                       | cargo-tarpaulin (≥80%)      | go test -cover (≥80%)      | pytest-cov (≥80%)              |
| **Mutation testing**        | PIT / pitest (≥85%)                     | Stryker (≥85%)                         | cargo-mutants (≥85%)        | go-mutesting               | mutmut (≥85%)                  |
| **Dep security**            | OWASP DependencyCheck (CVSS≥7)          | npm audit --audit-level=high           | cargo audit                 | govulncheck                | pip-audit / safety             |
| **Secrets scanning**        | Gitleaks                                | Gitleaks                               | Gitleaks                    | Gitleaks                   | Gitleaks                       |
| **Integration DB**          | Testcontainers (postgresql)             | testcontainers-node                    | sqlx test (real DB)         | testcontainers-go          | testcontainers-python          |
| **API testing**             | RestAssured                             | supertest                              | reqwest                     | net/http/httptest          | httpx                          |
| **Contract testing**        | pact-jvm                                | @pact-foundation/pact                  | pact_consumer               | pact_consumer              | pact-python                    |
| **DB migrations**           | Flyway                                  | Prisma Migrate / Drizzle               | diesel / sqlx               | golang-migrate             | Alembic                        |
| **E2E testing**             | RestAssured IT (backend)                | Playwright                             | N/A (CLI)                   | N/A (CLI)                  | Playwright / pytest-playwright |
| **Dead code**               | PMD unused rules                        | Knip                                   | clippy dead_code            | golangci-lint deadcode     | ruff F401/F811                 |
| **Circular deps**           | jdeps / ArchUnit                        | madge                                  | Rust compiler (native)      | Go compiler (native)       | ruff / custom                  |
| **Type safety**             | no raw types (ArchUnit)                 | no `any` (ESLint)                      | no `.unwrap()` (clippy)     | error checking (go vet)    | type annotations (mypy)        |
| **No MockMvc**              | ArchUnit RestAssuredArchTest            | N/A                                    | N/A                         | N/A                        | N/A                            |

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

## CI Job Mapping

| CI Job                      |     L1     |                   L2                    |    L3 (nightly)    |
| --------------------------- | :--------: | :-------------------------------------: | :----------------: |
| Lint + format               | All stacks |               All stacks                |     All stacks     |
| Unit tests                  | All stacks |               All stacks                |     All stacks     |
| Coverage verification       |     —      |               All stacks                |     All stacks     |
| Architecture boundaries     |     —      | Java (ArchUnit), TS (eslint-boundaries) |   All applicable   |
| Dependency audit            |     —      |               All stacks                |     All stacks     |
| Secrets scan (Gitleaks)     |     —      |               All stacks                |     All stacks     |
| PII scan                    |     —      |               All stacks                |     All stacks     |
| Integration tests (real DB) |     —      |           All stacks with DB            | All stacks with DB |
| Mutation testing            |     —      |                    —                    |     All stacks     |
| E2E full suite              |     —      |                    —                    | Frontend projects  |
| Evidence harness            |     —      |                    —                    |     All stacks     |
| Container scan (Trivy)      |     —      |                    —                    |     All stacks     |

---

## Implementation Status

| Mechanism                 | Status                                                | Milestone         |
| ------------------------- | ----------------------------------------------------- | ----------------- |
| Architecture boundaries   | Partial (1 ArchUnit test for Java)                    | M22               |
| Complexity limits         | Partial (ESLint for TS, PMD mention for Java)         | M29               |
| Static analysis           | Partial (generic PMD)                                 | M29               |
| Formatting                | Partial (assumed, not generated)                      | M29               |
| Coverage                  | Partial (threshold in gate script, not in build tool) | M30               |
| Mutation testing          | Advisory only (guide, not gate)                       | M23               |
| Dep security              | Not generated                                         | M24               |
| Secrets scanning          | Not generated                                         | M24               |
| Integration DB            | Not generated                                         | M26               |
| API testing (RestAssured) | Partial (ArchUnit test, no setup)                     | M22               |
| Contract testing          | Not generated                                         | M28               |
| DB migrations             | Mentioned in invariants, not generated                | Future            |
| E2E testing               | Not generated                                         | M25               |
| Dead code                 | Generated (Knip, PMD, clippy, golangci-lint, ruff)    | Done (M15)        |
| Circular deps             | Generated (madge, jdeps, native)                      | Done (M15)        |
| Type safety               | Generated (hooks per language)                        | Done (M12)        |
| No MockMvc                | Generated (ArchUnit NoMockMvcTest)                    | Done (M21/INV-29) |
| PII scan                  | Not generated                                         | M24               |
| Evidence harness          | Not generated                                         | M25               |
| Nightly pipeline          | Not generated                                         | M25               |
