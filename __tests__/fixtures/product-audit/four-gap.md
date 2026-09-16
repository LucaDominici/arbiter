# Four-gap product journey

<!-- PRODUCT_AUDIT
scope: product-complete
subject_sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
entrypoint_denominator: 4
readiness_verdict: FAIL
docs_verdict: FAIL
behavior_verdict: NO_DATA
-->

<!-- PRODUCT_COVERAGE_START -->

| capability_id | classification | entrypoints        | owner            | config                    | proof                     | external_overlap       | coverage      | verdict |
| ------------- | -------------- | ------------------ | ---------------- | ------------------------- | ------------------------- | ---------------------- | ------------- | ------- |
| REQ-001       | SUPPORTED      | docs route         | docs owner       | config:docs               | missing required document | none                   | SOURCE_TRACED | FAIL    |
| REQ-002       | SUPPORTED      | emitted control    | generator owner  | config:emit               | emitted control absent    | host hook runtime      | SOURCE_TRACED | FAIL    |
| REQ-003       | SUPPORTED      | product behavior   | command owner    | config:behavior           | no executed journey       | native command runtime | UNCOVERED     | NO_DATA |
| REQ-004       | SUPPORTED      | manual attestation | acceptance owner | N/A: external attestation | attestation unavailable   | human authority        | N/A           | N/A     |

<!-- PRODUCT_COVERAGE_END -->
