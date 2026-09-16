# Product audit

<!-- PRODUCT_AUDIT
scope: product-complete
subject_sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
entrypoint_denominator: 2
readiness_verdict: FAIL
docs_verdict: FAIL
behavior_verdict: NO_DATA
-->

<!-- PRODUCT_COVERAGE_START -->

| capability_id | classification | entrypoints  | owner                     | config         | proof                              | external_overlap           | coverage           | verdict |
| ------------- | -------------- | ------------ | ------------------------- | -------------- | ---------------------------------- | -------------------------- | ------------------ | ------- |
| REQ-001       | SUPPORTED      | arbiter init | src/commands/init.ts      | configure:init | .arbiter/evidence/rtm/REQ-001.json | native runtime consumed    | VERIFIED           | PASS    |
| REQ-002       | SUPPORTED      | /ship        | src/commands/task-ship.ts | configure:ship | test:ship journey                  | model execution integrated | NEEDS_REVALIDATION | NO_DATA |

<!-- PRODUCT_COVERAGE_END -->
