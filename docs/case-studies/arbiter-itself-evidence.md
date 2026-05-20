---
title: "Evidence trail: arbiter's own knowledge map snapshot"
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Evidence trail: arbiter's own knowledge map snapshot

**Issue:** #653 (R1.O3)

arbiter ships a public, scrubbed snapshot of its own evidence artifacts — the
`.arbiter/evidence/` directory that the gate writes after every L2 run. The
snapshot is published nightly via CI after a PII denylist scrub pass.

---

## What is included

The evidence snapshot captures:

- Gate result JSON (`arbiter-gate-v1` schema) — which checks passed/failed and their durations
- Knowledge map — the `docs/SYSTEM/KNOWLEDGE-MAP.md` updated by the gate
- STRIDE/RACI traceability report — invariant-to-control mapping

## What is excluded

The scrubber removes before publishing:

| Pattern                                             | Replacement      |
| --------------------------------------------------- | ---------------- |
| Email addresses                                     | `[EMAIL]`        |
| GitHub tokens (`ghp_`, `ghs_`, ...)                 | `[GH_TOKEN]`     |
| AWS access key IDs (`AKIA...`)                      | `[AWS_KEY]`      |
| Private IPv4 addresses                              | `[IPV4]`         |
| Internal hostnames (`.local`, `.internal`, `.corp`) | `[HOSTNAME]`     |
| Bearer tokens                                       | `[BEARER_TOKEN]` |
| JWT triplets                                        | `[JWT]`          |
| Generic long hex/base64 secrets (32+ chars)         | `[SECRET]`       |

The scrubber performs a re-scan pass after writing. If any pattern survives,
the run fails non-zero and no artifact is uploaded.

## How it is generated

The nightly `publish-evidence-snapshot` CI job runs:

```bash
node scripts/publish-evidence-snapshot.mjs \
  --input .arbiter/evidence \
  --output docs/case-studies/_evidence-snapshot
```

The implementation is in `scripts/publish-evidence-snapshot.mjs`. Tests
covering all scrub patterns are in
`__tests__/scripts/publish-evidence-snapshot.test.ts`, including a canary
fixture (`__tests__/fixtures/evidence-pii-canary.txt`) with planted markers
that must all be removed.

## Snapshot location

Scrubbed snapshots are uploaded as CI artifacts named
`evidence-snapshot-<run-id>` and retained for 30 days. They are not committed
to the repository.
