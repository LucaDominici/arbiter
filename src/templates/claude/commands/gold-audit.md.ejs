---
description: Measure the project against the gold-standard registry — level band + prioritized "what's missing" list, deterministic and read-only (skill:gold-audit)
title: '/gold-audit'
doc_version: '1.0.0'
status: active
last_review: '2026-06-16'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/analysis']
related: ['ship', 'gap']
---

# /gold-audit

`/gold-audit` measures how close this project is to gold-standard quality. It loads the
**`gold-audit`** skill, which runs the deterministic `arbiter gold-audit` engine and
reports the **level band** (`L0`–`L3`) plus a prioritized list of **what's missing**.

It is **read-only**: it measures and reports, it never changes code. The score and every
verdict come straight from the engine payload — there is **no AI re-scoring**, so the same
repo + registry always produces identical output.

## Steps

1. Run the engine and capture stdout:

```bash
npx arbiter gold-audit --json
```

2. If stdout is not JSON (a SKIP line — no registry installed), do not invent a score.
   Point the user at `npx arbiter init` (new project) or `npx arbiter update` (existing
   arbiter project), then stop.

3. Otherwise parse the payload and present the band + the `gaps[]` families (N/P checks
   grouped by `dimension`), highest-risk and most-missing first.

## Allowed Tools

- `Bash` to run `npx arbiter gold-audit --json`
- `Read` to inspect cited evidence files

> See the **`gold-audit`** skill for the full field-by-field reading protocol and hard rules.
