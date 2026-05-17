# RACI Matrix — arbiter

<!-- arbiter-managed: claim-verified-governance (INV-90) -->
<!-- HIGH and CRITICAL responsibilities require a @RACI:<id>-tagged test. -->
<!-- Run: node scripts/check-stride-traceability.mjs to verify. -->

## Responsibility Matrix

| ID   | Responsibility                                                                                                             | Accountable | Responsible | Consulted         | Informed  | Priority |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ----------------- | --------- | -------- |
| R001 | Approve a new arbiter release to npm via `.github/workflows/release.yml` (`workflow_dispatch` + concurrency-locked group). | Maintainer  | Maintainer  | Security Reviewer | Community | HIGH     |

<!--
## How to use this table

1. Add a row for each key responsibility or decision area.
2. Set Priority: CRITICAL, HIGH, MEDIUM, or LOW.
3. For HIGH and CRITICAL responsibilities, annotate the verifying test with:
       // @RACI:<id>
   where <id> matches the ID column (e.g., // @RACI:R001).
4. Run: node scripts/check-stride-traceability.mjs
-->
