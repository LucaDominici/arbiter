---
title: 'Pact Provider States — Convention Reference'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Pact Provider States — Convention Reference

**Issue:** #972 | **Plan:** Workstream C, Port #12 | **Scope:** scaffolds when `contractType` is enabled at L2+

## What this ships

Two templates in `src/templates/contract-testing/`:

| File                                    | Renders to                                           | Purpose                                                                                |
| --------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `PROVIDER_STATES.md.ejs`                | `contract-testing/PROVIDER_STATES.md`                | SSOT convention doc for naming provider states + a slug → fixture mapping table        |
| `scripts/check-provider-states.mjs.ejs` | `contract-testing/scripts/check-provider-states.mjs` | Read-only gate script that asserts every consumer-declared state has a backend fixture |

Both render only when `governanceLevel` is L2 or higher AND `contractType` is one of the supported strategies (`rest-owned`, `rest-public`, `graphql`, `grpc`, `message-queue`).

## Convention summary

Each provider state is a `snake_case` slug paired with a one-line prose summary, e.g.
`user_has_active_trip` → "A user with id=1 has at least one trip in status=active."

Each slug has exactly one backend fixture file under `contract-testing/pact-samples/states/<slug>.fixture.<ext>` where `<ext>` is one of `ts | js | py | java | kt | rs | go`.

## Validation

The scaffolded `check-provider-states.mjs` walks `contract-testing/pact-samples/contracts/*.json`, extracts every `providerState` (Pact spec v2) or `providerStates[].name` (Pact spec v3+), and asserts a matching fixture file exists for each unique slug. Exit codes:

- `0` — all declared slugs have fixtures, or no contracts directory found (skip)
- `1` — orphan slug (declared, no fixture) or slug violating the `^[a-z][a-z0-9_]*$` naming rule
- `2` — invalid JSON in a contract file (read-error)

## Plagiarism boundary

"Provider states" is the public Pact term and is cited inline (`docs.pact.io/getting_started/provider_states`). The naming rule, mapping-table schema, gate-script logic, exit-code contract, and examples are arbiter-original.

## Related

- `src/generators/contract-testing.ts` — gates emission on `contractType !== 'none'` and `governanceLevel !== 'L1'`
- `src/templates/contract-testing/CONTRACTS_POLICY.md.ejs` — the top-level policy doc that this convention extends
- `docs/REFERENCE/coverage/dim-28-contract-tests-spring-cloud-contract-pact.md` — capability matrix entry for contract testing
