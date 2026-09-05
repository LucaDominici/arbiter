---
title: 'Canon Enforcement Rule'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Canon Enforcement Rule

## Source

`docs/internal/SYSTEM/CANON.md` — 24 process-level rules derived from audit waves #151–#186 and #2480.

## Protocol

When implementing any open issue:

1. **Read** `docs/internal/SYSTEM/CANON.md` before touching any file
2. **List** every CANON-NN ID that applies to the issue (check labels: `canon/NN-*`)
3. **Block** advancement to the next implementation step until each listed CANON-NN is satisfied
4. **Cite** CANON-NN on violation: `STOP — CANON-NN violation: <rule summary>`

The citation protocol is identical to INV-NN: **STOP → REFUSE → cite CANON-NN**.

## Quick Reference (most commonly triggered)

| CANON    | Triggered when you are...                                                                |
| -------- | ---------------------------------------------------------------------------------------- |
| CANON-01 | Adding a hook, gate, or enforcement mechanism to arbiter self-config                     |
| CANON-02 | Marking a tool `proven` in `cross-language-matrix.json`                                  |
| CANON-03 | Promoting a language/archetype to `proven`                                               |
| CANON-04 | Creating or editing any `.ejs` template                                                  |
| CANON-05 | Creating or editing any `src/generators/*.ts` file                                       |
| CANON-06 | Creating or editing any `src/commands/*.ts` file                                         |
| CANON-07 | Adding a generator that emits a shell script                                             |
| CANON-08 | Adding an invariant to `src/invariants/catalog.ts`                                       |
| CANON-09 | Adding an enforcement claim to `AGENTS.md` §Invariants                                   |
| CANON-10 | Adding a hook to `.claude/settings.json`                                                 |
| CANON-11 | Creating a generator that writes files                                                   |
| CANON-12 | Writing any code under `src/` that shells out                                            |
| CANON-13 | Editing any `.ejs` template with `<% if (governanceLevel` guards                         |
| CANON-14 | Adding a hook to the generated `settings.json.ejs`                                       |
| CANON-15 | Adding a template that emits a tool config file                                          |
| CANON-16 | Adding a new file under `src/`, `src/generators/`, `src/templates/`, or `src/commands/`  |
| CANON-17 | Adding a filesystem error handler (`ENOENT`, `EACCES`, etc.) that translates errno codes |
| CANON-18 | Adding/modifying any `src/templates/github/workflows/*.ejs`                              |
| CANON-19 | Adding/modifying any `.github/actions/sign-and-attest/*`                                 |
| CANON-20 | Changing governance threshold table in `thresholds-by-level.ts`                          |
| CANON-23 | Adding or updating a Feature/RTM matrix (FEATURE_MATRIX.md or its generator/gate)        |
| CANON-24 | Closing a high-stakes review — hop until nothing above `low` is unaddressed              |
