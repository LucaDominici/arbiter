---
title: 'Nightly self-canary: arbiter regenerates its own config'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Nightly self-canary: arbiter regenerates its own config

**Issue:** #654 (R1.O4)

Every night, arbiter runs `arbiter init --yes --brownfield --dry-run` against
its own repository. If the dry-run output indicates any file would be written
or modified, CI opens a P0 issue automatically.

---

## What it checks

The self-canary verifies that arbiter's committed configuration is stable —
that running `arbiter init` again would produce no changes. Drift in the
dry-run output signals one of:

1. A template was changed but the generated files were not regenerated
2. A new invariant or hook was added without updating the committed config
3. The init command's brownfield detection logic changed and now re-classifies
   existing files

## How it works

The nightly `arbiter-self-canary` CI job:

1. Checks out the repository and builds arbiter (`npm run build`)
2. Runs `node scripts/run-self-canary.mjs --dry-run`
3. If drift is detected (exit code 1) → opens a GitHub issue labelled `P0,canary`
4. The issue body includes the workflow run ID for diff lookup

The orchestrator script is `scripts/run-self-canary.mjs`. It accepts
`--arbiter-bin <path>` to override the binary for testing.

## Guard: --dry-run is mandatory

The script refuses to run without `--dry-run` and exits non-zero with a
diagnostic message. This prevents accidental real writes to the repository.

## Tests

`__tests__/scripts/self-canary.test.ts` covers:

- Missing `--dry-run` → exit 1 + diagnostic
- Mock binary producing no output → exit 0 (no drift)
- Mock binary producing dry-run output → exit 1 (drift detected)

## Status

<!-- nightly canary status is updated by CI — see latest workflow run -->

Last known status: see the `arbiter-self-canary` nightly workflow run.
