---
title: 'Architecture: Evidence Bundle Schema (INV-90)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method']
related: []
---

# Architecture: Evidence Bundle Schema (INV-90)

## Overview

An **evidence bundle** is a JSON file stored at `.evidence/task-NNN/bundle.json` that records
the TDD lifecycle artifacts for a completed task. The schema is defined at
`schemas/evidence-bundle.schema.json` (JSON Schema v7) and enforced by INV-90 via
`scripts/check-evidence-bundle.mjs` at the L2 gate.

## Purpose

Evidence bundles provide an auditable trail for every task:

1. **TDD compliance** — records that red-phase (failing) tests existed before implementation
2. **Gate result capture** — snapshots the quality gate result at time of completion
3. **Artifact traceability** — links to test output, coverage reports, or other evidence files

## Schema

File: `schemas/evidence-bundle.schema.json`

| Field           | Type                 | Required | Description                               |
| --------------- | -------------------- | -------- | ----------------------------------------- |
| `taskId`        | string               | yes      | GitHub issue reference, e.g. `#883`       |
| `timestamp`     | string (ISO 8601)    | yes      | When the bundle was recorded              |
| `gateResult`    | `"pass"` or `"fail"` | yes      | Quality gate result at completion         |
| `redTestPath`   | string               | yes      | Path to failing test written in red phase |
| `greenTestPath` | string               | yes      | Path to passing test after implementation |
| `artifacts`     | Artifact[]           | yes      | Additional artifacts (may be empty array) |

### Artifact object

| Field      | Type   | Required | Description                   |
| ---------- | ------ | -------- | ----------------------------- |
| `name`     | string | yes      | Human-readable name           |
| `path`     | string | yes      | Relative path from repo root  |
| `mimeType` | string | no       | MIME type (e.g. `text/plain`) |

## Directory Structure

```
.evidence/
  task-#883/
    bundle.json          ← evidence bundle (validated by INV-90)
    test-output.txt      ← optional artifact
  task-#884/
    bundle.json
```

## Enforcement

The `check-evidence-bundle.mjs` script is wired at the L2 gate (`gate` subcommand) in
`scripts/check-all.mjs`. It:

1. Scans `.evidence/task-*/` for `*.json` files
2. Validates each against `schemas/evidence-bundle.schema.json`
3. Exits 0 if no bundles are found (vacuous pass — new projects have no evidence)
4. Exits 1 if any bundle fails validation

## Lifecycle

Evidence bundles are created by `arbiter task record-red` and written to
`.arbiter/evidence/tdd/#NNN.json`. The `.evidence/task-NNN/bundle.json` format
is the published, schema-validated form intended for external audit consumption.

Bundles accumulate over the project lifetime and are never deleted (append-only
audit trail, see INV-83 when implemented).

## Related

- `docs/TEST_TAXONOMY.md` — 25-dimension test taxonomy
- `docs/REFERENCE/evidence-schema.md` — schema reference for target projects
- `scripts/check-tdd-evidence.mjs` — TDD evidence per-commit check (separate concern)
- `src/invariants/catalog.ts` — INV-90 entry
- `AGENTS.md` — INV-90 declaration
