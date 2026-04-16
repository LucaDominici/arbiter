# Arbiter — Cross-Language Enforcement Matrix

**Status:** Active
**Last updated:** 2026-04-17 (M22c: Go boundaries via depguard added)

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
| **Architecture boundaries** | ArchUnit                                | eslint-plugin-boundaries               | cargo-deny + clippy         | go/analysis                | import-linter + ruff           | proven / proven / proven / proven / proven                   |
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

## CI Job Mapping

| CI Job                      |     L1     |                                             L2                                              |    L3 (nightly)    |
| --------------------------- | :--------: | :-----------------------------------------------------------------------------------------: | :----------------: |
| Lint + format               | All stacks |                                         All stacks                                          |     All stacks     |
| Unit tests                  | All stacks |                                         All stacks                                          |     All stacks     |
| Coverage verification       |     —      |                                         All stacks                                          |     All stacks     |
| Architecture boundaries     |     —      | Java (ArchUnit), TS (eslint-boundaries), Rust (cargo-deny + boundaries shim), Go (depguard) |   All applicable   |
| Dependency audit            |     —      |                                         All stacks                                          |     All stacks     |
| Secrets scan (Gitleaks)     |     —      |                                         All stacks                                          |     All stacks     |
| PII scan                    |     —      |                                         All stacks                                          |     All stacks     |
| Integration tests (real DB) |     —      |                                     All stacks with DB                                      | All stacks with DB |
| Mutation testing            |     —      |                                              —                                              |     All stacks     |
| E2E full suite              |     —      |                                              —                                              | Frontend projects  |
| Evidence harness            |     —      |                                              —                                              |     All stacks     |
| Container scan (Trivy)      |     —      |                                              —                                              |     All stacks     |

---

## Implementation Status

| Mechanism                 | Status                                                                              | Milestone         |
| ------------------------- | ----------------------------------------------------------------------------------- | ----------------- |
| Architecture boundaries   | Java + TypeScript + Rust + Go done (M22/M22a/M22b/M22c). Python tracked in #140     | M22–M22c done     |
| Complexity limits         | Partial (ESLint for TS, PMD mention for Java)                                       | M29               |
| Static analysis           | Partial (generic PMD)                                                               | M29               |
| Formatting                | Partial (assumed, not generated)                                                    | M29               |
| Coverage                  | Partial (threshold in gate script, not in build tool)                               | M30               |
| Mutation testing          | Advisory only (guide, not gate)                                                     | M23               |
| Dep security              | Not generated                                                                       | M24               |
| Secrets scanning          | Not generated                                                                       | M24               |
| Integration DB            | Not generated                                                                       | M26               |
| API testing (RestAssured) | Java done (RestAssuredBaseIT + RestAssuredArchTest + dep fragment). Maven: doc only | M22 (Java done)   |
| Contract testing          | Not generated                                                                       | M28               |
| DB migrations             | Mentioned in invariants, not generated                                              | Future            |
| E2E testing               | Not generated                                                                       | M25               |
| Dead code                 | Generated (Knip, PMD, clippy, golangci-lint, ruff)                                  | Done (M15)        |
| Circular deps             | Generated (madge, jdeps, native)                                                    | Done (M15)        |
| Type safety               | Generated (hooks per language)                                                      | Done (M12)        |
| No MockMvc                | Generated (ArchUnit NoMockMvcTest)                                                  | Done (M21/INV-29) |
| PII scan                  | Not generated                                                                       | M24               |
| Evidence harness          | Not generated                                                                       | M25               |
| Nightly pipeline          | Not generated                                                                       | M25               |

---

## Known Failure Modes

These cells are marked `beta` or `unsafe` in the maturity column above. Do not generate L3 features for them without explicit user acknowledgement.

### go-mutesting (`unsafe`)

- **Status:** Abandoned upstream (last commit 2022). No longer maintained.
- **Failure mode:** Hangs indefinitely on Go 1.23+ module graphs that use `go.work` workspaces. No timeout-per-mutant support.
- **Recommendation:** Use L2 mutation advisory only. Do not generate L3 mutation gate for Go projects. Use code review + property-based tests as a substitute.

### mutmut — Python (`beta`)

- **Status:** Maintained but slow.
- **Failure mode:** Runtime exceeds 6h on mid-sized codebases (>5k LoC) with no per-mutant timeout control. CI runners time out before results are available.
- **Recommendation:** Acceptable for small libraries (<2k LoC). Requires `--accept-beta-tools` for L3 generation. Consider `--runner` customization to limit scope.

### cargo-mutants — Rust (`beta`)

- **Status:** Actively maintained but threshold gating is unstable.
- **Failure mode:** The `--minimum-test-count` and coverage threshold flags behave inconsistently across 0.x patch versions. Gate may pass on one version and fail on another for the same code.
- **Recommendation:** Pin cargo-mutants version in `Cargo.toml`. Requires `--accept-beta-tools` for L3 generation. Gate on mutation score only after pinning.

### pact-python — Python (`beta`)

- **Status:** Under active migration to V4 Rust FFI core.
- **Failure mode:** Provider verification results do not match pact-jvm behavior for some contract expressions. Cross-language consumer/provider tests may produce false positives.
- **Recommendation:** Use only for Python-to-Python contracts. Cross-language contracts (Java provider + Python consumer) require independent validation. Requires `--accept-beta-tools` for L3 generation.

### pact_consumer — Rust and Go (`beta`)

- **Status:** Community-maintained wrappers around the Rust Pact core via FFI.
- **Failure mode:** FFI panics observed on newer Go runtimes (Go 1.22+). Rust provider verification is experimental.
- **Recommendation:** Suitable for greenfield projects where both sides are in the same language. Requires `--accept-beta-tools` for L3 generation.

### E2E testing — Rust and Go (`unavailable`)

- **Status:** No browser-based E2E equivalent for CLI/systems languages.
- **Recommendation:** Use integration-level testing (L2/L3 exec-command assertions) as a substitute. E2E generation is blocked for these languages regardless of flags.
