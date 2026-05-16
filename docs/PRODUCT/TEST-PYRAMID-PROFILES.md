# Test Pyramid Profiles

**Status:** Implemented (Phase 9.5 MH)
**Issue:** #89

---

## Problem

The default L1–L5 test pyramid assumes a backend service with a database, external services,
and a browser UI. For a Rust CLI or a Python library, `L3 Testcontainers` is nonsense and
`L4 Playwright` is noise. Generating empty or inapplicable CI stages creates friction and
erodes trust in the governance framework.

---

## Solution

`src/config/test-pyramid-profiles.ts` defines a `TestPyramidProfile` per archetype.
Each profile declares which test categories apply and provides concrete level definitions
for `docs/TEST_TAXONOMY.md` generation.

---

## Profiles

### backend-web-db

Full pyramid — the reference archetype.

| Level          | Description                      | Key Tools                         |
| -------------- | -------------------------------- | --------------------------------- |
| L1 Unit        | Business logic, domain models    | JUnit, pytest, vitest, cargo test |
| L2 Integration | Service + DB with Testcontainers | Testcontainers, RestAssured       |
| L3 Contract    | Consumer-driven contract tests   | Pact, Spring Cloud Contract       |
| L4 E2E         | Browser / API end-to-end flows   | Playwright, Cypress               |
| L5 Performance | Load and stress under SLA        | k6, Gatling, Locust               |

Flags: `hasContainerIntegration=true`, `hasE2ETests=true`, `hasPerformanceTests=true`,
`hasContractTests=true`.

---

### cli

Minimal — no containers, no browser, no network services.

| Level              | Description                      | Key Tools                           |
| ------------------ | -------------------------------- | ----------------------------------- |
| L1 Unit            | Commands, parsers, handlers      | pytest, vitest, cargo test          |
| L2 CLI Integration | Binary invocation with real args | bats, pytest subprocess, assert_cmd |

Flags: all optional test types `false`. No Testcontainers, no Playwright.

---

### library

Pure code, no external dependencies.

| Level             | Description                    | Key Tools                         |
| ----------------- | ------------------------------ | --------------------------------- |
| L1 Unit           | All public API surface         | JUnit, pytest, vitest, cargo test |
| L2 Property-Based | Generative edge-case discovery | fast-check, Hypothesis, proptest  |

Flags: `hasPropertyTests=true`. No containers, no E2E.

---

### data-pipeline

Transform-heavy, data-store dependent, schema-contract sensitive.

| Level          | Description                      | Key Tools                           |
| -------------- | -------------------------------- | ----------------------------------- |
| L1 Unit        | Transforms, parsers, aggregators | pytest, vitest                      |
| L2 Integration | Containerised data stores        | Testcontainers, pytest-docker       |
| L3 Contract    | Schema / data contracts          | Great Expectations, Pact, soda-core |

Flags: `hasContainerIntegration=true`, `hasContractTests=true`. No Playwright.

---

### frontend-spa

Browser-first. Components over integration, E2E over performance.

| Level        | Description                      | Key Tools                  |
| ------------ | -------------------------------- | -------------------------- |
| L1 Unit      | Utilities, hooks, pure functions | vitest, jest               |
| L2 Component | Rendering + interaction          | Testing Library, Storybook |
| L3 E2E       | Full browser flows               | Playwright, Cypress        |

Flags: `hasE2ETests=true`. No Testcontainers, no performance tests.

---

### embedded

Hardware-constrained. Host-side logic + simulator integration only.

| Level                   | Description                      | Key Tools                  |
| ----------------------- | -------------------------------- | -------------------------- |
| L1 Unit                 | Logic, state machines, protocols | Unity, cargo test, pytest  |
| L2 Hardware Integration | Simulator / emulator in CI       | QEMU, Renode, JTAG harness |

Flags: all optional test types `false`. No browser, no containers, no load tests.

---

## Implementation

- **`src/config/test-pyramid-profiles.ts`** — `getTestPyramidProfile(archetype)` returns a
  `TestPyramidProfile` with boolean flags and an ordered `levels[]` array. Pure function, no I/O.
- **`src/templates/root/TEST_TAXONOMY.md.ejs`** — branches on `archetype` to render only
  applicable levels. Generated to `docs/TEST_TAXONOMY.md` with `skipIfExists: true`.
- **`src/generators/test-taxonomy.ts`** — calls `renderTemplate` + `writeFile`; wired into
  `runGenerators()` in `src/commands/init.ts`.

---

## Consequences

- Generated `docs/TEST_TAXONOMY.md` contains only the test levels that make sense for the project's archetype.
- CLI and library archetypes never see Testcontainers or Playwright references.
- Teams can customise the generated file — `skipIfExists: true` ensures `arbiter update` won't overwrite it.
- The boolean flags (`hasE2ETests`, `hasContainerIntegration`, etc.) are available for future use in template conditionals.

---

## 25-Dimension Taxonomy Extension (#719)

**Opt-in flag:** `enableTaxonomy25d: true` in `arbiter.json`.

When enabled, `generateTestTaxonomy` uses `src/templates/testing/test-taxonomy.md.ejs` instead of
the base template. This extends the 17 universal dimensions with 8 compliance and industrial-grade
dimensions:

| #   | Dimension                                                                      | Standard reference            |
| --- | ------------------------------------------------------------------------------ | ----------------------------- |
| 18  | Audit trail — state-mutation events logged with actor, resource, timestamp     | GDPR Art.30, ISO 27001 A.12.4 |
| 19  | PII masking — sensitive data absent from logs, traces, and error responses     | GDPR Art.5, INV-19            |
| 20  | Rate limiting — throttle limits enforced; burst and sustained load tested      | OWASP ASVS 4.0 §13            |
| 21  | Session / token lifecycle — tokens expire, rotate, and invalidate on logout    | OWASP ASVS 3.x                |
| 22  | Event delivery — async consumers idempotent; dead-letter queue routing tested  | NIS2 Art.21                   |
| 23  | Graceful degradation — circuit-breaker/fallback responses when deps fail       | INV-17                        |
| 24  | SLA assertion — p95 latency within declared budget under sustained load        | ISO 27001 A.12.1.3            |
| 25  | Security surface — OWASP Top-10 attack inputs rejected at each public endpoint | OWASP Top-10, INV-19          |

The decision matrix in the 25-dimension template also maps compliance-specific change types
(`Compliance / audit feature`, `High-traffic endpoint`) to their mandatory dimensions.
