---
title: "N43: DAST scan (OWASP ZAP / Nuclei)"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N43 hash=ed9265063f983c7bdeb9f8f8199c46415d3b829dfafa903f0ad3ffc63f80e2b5 generator=kit@1 -->
# N43: DAST scan (OWASP ZAP / Nuclei)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | ADVISORY |
| Status | partial |
| Category | e2e_perf |

## Notes

DAST wired at T4 nightly tier; ZAP scan against running service

## Arbiter Templates (F8, #898)

For `backend-web-db` archetype with `enableSecurityScanning: true`, arbiter emits:

- `.zap/rules.tsv` — passive/active rule overrides (WARN/FAIL/IGNORE per rule ID); user-tunable, never overwritten on re-run
- `.zap/baseline-auth.context` — form-based authentication context (ZAP type 2); user-customisable, never overwritten on re-run
- `scripts/ingest-zap-report.mjs` — ZAP JSON report ingestion gate; exits 1 on HIGH/MEDIUM alert threshold breach; always kept current on re-run

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: RestAssured IT (via e2e) |
| `typescript` | tool: Playwright (via e2e) |
| `python` | tool: Playwright / pytest-playwright (via e2e) |
| `go` | tool: owasp-zap (via dast) |
| `rust` | tool: owasp-zap (via dast) |

