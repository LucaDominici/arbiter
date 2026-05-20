---
title: 'STRIDE Threat Model — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/auditor', 'audience/dev', 'kind/security']
related: []
---

# STRIDE Threat Model — arbiter

<!-- arbiter-managed: claim-verified-governance (INV-90) -->
<!-- HIGH and CRITICAL threats require a @Security:<id>-tagged test. -->
<!-- Run: node scripts/check-stride-traceability.mjs to verify. -->

## Threat Register

| ID   | Threat                                                                                                                             | Category               | Severity | Mitigation                                                                                                                                                                                                                                                                                                 | Status    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| S001 | Replay log writer leaks unredacted secrets from environment variables into `~/.arbiter/logs/<runId>/env.json`.                     | Information Disclosure | HIGH     | Pattern-match redaction in `src/utils/replay.ts` (`shouldRedactKey`): segment-aware match for `TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `PASS`, `AUTH`, `CREDENTIAL`, `PRIVATE`, `API`, plus prefix match for `GH_`, `GITHUB_`, `NPM_`. Verified by `@Security:S001` test in `__tests__/utils/replay.test.ts`. | MITIGATED |
| S002 | `arbiter report` tar bundle follows a symlink in `~/.arbiter/logs/<runId>/` and exfiltrates a file from outside the run directory. | Tampering              | HIGH     | `collectSafeFiles` in `src/commands/report.ts` uses `lstatSync` and rejects symbolic-link entries before they reach the tar writer. Verified by `@Security:S002` test in `__tests__/commands/report.test.ts`.                                                                                              | MITIGATED |

<!--
## How to use this table

1. Add a row for each identified threat.
2. Set Severity: CRITICAL, HIGH, MEDIUM, or LOW.
3. For HIGH and CRITICAL threats, annotate the verifying test with:
       // @Security:<id>
   where <id> matches the ID column (e.g., // @Security:S001).
4. Run: node scripts/check-stride-traceability.mjs

Categories: S=Spoofing, T=Tampering, R=Repudiation, I=Information Disclosure, D=Denial of Service, E=Elevation of Privilege
Status: OPEN | MITIGATED | ACCEPTED
-->
