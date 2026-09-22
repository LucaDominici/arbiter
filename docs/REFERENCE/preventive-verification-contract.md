---
title: 'Preventive verification contracts'
doc_version: '1.0.0'
status: active
last_review: '2026-09-21'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['2773']
---

# Preventive verification contracts

An anchored task plan records the checks that can turn red for the files in its `files:`
manifest. The record includes each local command, its execution condition, effective thresholds and
their sources, plus hashes of the configuration and gate authority that produced it. `/ship` shows
this list as **Gates awaiting this change** before implementation begins.

Arbiter derives the record when `arbiter lifecycle start --plan <path>` anchors or re-anchors a
plan. Admission from `plan` to `red` inspects the authority again and requires an exact match. A
missing record, an edited manifest, a changed threshold or authority file, or missing derivation
support blocks admission until the plan is re-anchored.

## Inspecting the authority

Generated gates and Arbiter's own gate declare support for the versioned inspection protocol:

```sh
node scripts/check-all.mjs L2 --dry-run
```

The command prints one `arbiter-gate-contract-v1` JSON document and exits before acquiring the
gate mutex, spawning checks, changing `TMPDIR`, or writing gate evidence. Inline thresholds come
from the same registry data used by execution, including an effective value of zero. TypeScript
integration checks name `vitest.integration.config.ts` explicitly because the default Vitest
configuration excludes the integration corpus.

The inspector does not run an unknown `scripts/check-all.mjs` to discover whether it supports this
protocol. A custom wrapper is reported as `unsupported custom gate authority`, and plan admission
stays blocked until that authority supplies a compatible, effect-free contract. This prevents a
wrapper that ignores `--dry-run` from accidentally starting a full gate.

## Remote conditions

Workflow checks remain `remote-dependent`. Their checked-out workflow files are content-hashed,
while the contract states that event context and repository variables resolve only in CI. Arbiter
does not interpret workflow YAML or claim that a local default reproduces a modified or withheld
workflow.

Re-anchor after changing the plan, gate registry, thresholds, debt baseline, or workflow files:

```sh
arbiter lifecycle start --id '#NNN' --plan path/to/plan.md
```

Then read the next `/ship` step to review the refreshed commands and unresolved obligations before
entering RED.
