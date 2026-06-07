---
generated: true
source: 'docs/REFERENCE/postman-newman-contract.md'
source_sha: '4cd4354a167a3c08226fe5c31e3313a4f402ccbd'
last_updated: '2026-06-07'
---

# Postman/Newman Contract Tests — Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/postman-newman-contract.md](../docs/REFERENCE/postman-newman-contract.md)

# Postman/Newman Contract Tests — Reference

**Feature:** F7 | **Issue:** #894 | **Language:** Java (when `contractType: rest-owned`)

## Overview

Adds Postman/Newman contract testing scripts and a CI workflow to Java projects that use
`contractType: rest-owned`. The scripts complement Pact consumer-driven contract tests by
running a Postman collection against the live service using Newman.

## Activation

Emitted automatically when all conditions are met:

- `language: 'java'` (or `'multi'`)
- `contractType: 'rest-owned'`
- `hasPublicApi: true`
- `governanceLevel: 'L2'` or `'L3'`

No additional flags are required.

## Emitted Files

| File                     | Location             | Purpose                                                       |
| ------------------------ | -------------------- | ------------------------------------------------------------- |
| `run-postman-tests.sh`   | `scripts/`           | Newman runner with retry, health-check, JUnit output          |
| `inject-pact-samples.sh` | `scripts/`           | Seeds Pact interactions into the running service before tests |
| `_contract-postman.yml`  | `.github/workflows/` | CI workflow that runs Newman on PR and `workflow_dispatch`    |

All files use `skipIfExists: true`.

## How It Works

```
          ┌─────────────────────────────────┐
          │  CI: _contract-postman.yml      │
          │                                 │
          │  1. Start service (docker)      │
          │  2. inject-pact-samples.sh      │──▶ POST /api/test/seed (Pact JSON)
          │  3. run-postman-tests.sh        │──▶ newman run <collection>
          │  4. Publish JUnit report        │
          └─────────────────────────────────┘
```

### `run-postman-tests.sh`

Runs Newman against a Postman collection. Features:

- Health-check wait loop (up to 30 s) before executing tests
- Configurable retry count (`NEWMAN_MAX_RETRIES`)
- JUnit XML output at `.arbiter/evidence/contract/newman-results.xml`
- Configurable collection path, base URL, and environment file

Environment variables:
| Variable | Default | Description |
|----------|---------|-------------|
| `POSTMAN_COLLECTION` | `postman/<projectName>.postman_collection.json` | Path to Postman collection |
| `SERVICE_BASE_URL` | `http://localhost:8080` | Service base URL |
| `POSTMAN_ENVIRONMENT` | (none) | Optional Postman environment JSON |
| `RESULTS_DIR` | `.arbiter/evidence/contract` | JUnit output directory |
| `NEWMAN_TIMEOUT_MS` | `30000` | Per-request timeout |
| `NEWMAN_MAX_RETRIES` | `2` | Retry count on failure |
| `INJECT_PACT_SAMPLES` | `false` | Set to `true` to call inject-pact-samples.sh first |

### `inject-pact-samples.sh`

Seeds the service's test/seed endpoint with Pact interaction samples before Newman runs.
This ensures Newman exercises the exact contract scenarios defined in the Pact files.

Environment variables:
| Variable | Default | Description |
|----------|---------|-------------|
| `SERVICE_BASE_URL` | `http://localhost:8080` | Service base URL |
| `PACTS_DIR` | `pacts` | Directory containing Pact JSON files |
| `SEED_ENDPOINT` | `$SERVICE_BASE_URL/api/test/seed` | Admin seed endpoint |
| `SEED_TIMEOUT_SECONDS` | `10` | Per-request timeout |

The script is non-fatal when the seed endpoint is absent — Newman will still run, failures
surface in test results. Only hard-fails when all injections fail.

## Setting Up the Postman Collection

1. Export your Postman collection as JSON from the Postman app
2. Save it to `postman/<projectName>.postman_collection.json`
3. Commit it to your repository

Alternatively, set `POSTMAN_COLLECTION` in CI to point to any path.

## CI Workflow

`_contract-postman.yml` triggers on:

- Pull requests modifying `src/`, `postman/`, `pacts/`, or the runner script
- `workflow_dispatch` (manual trigger with configurable `base_url`)

The workflow:

1. Starts the service via Docker (`ghcr.io/<repo>:pr-<number>`)
2. Optionally injects Pact samples
3. Runs Newman with JUnit reporting
4. Uploads results as a CI artefact
5. Publishes a JUnit check via `mikepenz/action-junit-report`

## Relationship to Pact

Newman contract tests are **additive** to Pact consumer-driven tests — both are emitted when
`contractType: rest-owned`. They serve different purposes:

|                 | Pact                                     | Newman/Postman                             |
| --------------- | ---------------------------------------- | ------------------------------------------ |
| **Driven by**   | Consumer contract                        | Postman collection                         |
| **Validates**   | Consumer expectations met by provider    | API surface matches Postman scenarios      |
| **Good for**    | Microservice consumer-provider contracts | REST API smoke/regression across endpoints |
| **CI position** | L2 integration (PactVerificationIT.java) | Supplementary contract workflow            |

## INV-35 Compliance

`INV-35` requires contract testing when `contractType` is active. Newman tests satisfy the
"live API validation" aspect of this invariant for Java projects. Pact satisfies the
"consumer-provider contract" aspect.
