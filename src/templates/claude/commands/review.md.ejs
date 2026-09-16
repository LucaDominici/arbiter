---
description: Manual recovery entry for the final review stage owned by /ship
argument-hint: ''
title: '/review'
doc_version: '2.0.0'
status: active
last_review: '2026-09-15'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# /review

Use this only to recover the final review stage of an active `/ship`. The persisted
`ShipTreatment` in `.claude/.task/status.json` is the authority for reviewer count, verticals,
model capability, round, and frozen SHA. This command must not derive another panel from tier,
diff size, a routing matrix, or prose.

1. Read active task state and stop if the treatment is absent or malformed.
2. Freeze the candidate before dispatch. Every reviewer receives the same plan, diff, SHA, and
   targeted certification evidence.
3. Dispatch one independent reviewer per `reviewerVerticals` entry. Do not add seats beyond
   `finalReviewers`. Reviewer agents are distinct from the implementer.
4. Run the independent acceptance-fit verifier against every frozen criterion in parallel with
   code review. It is not a code-review seat.
5. Submit the complete code-review panel once:

```bash
node scripts/record-agent-return.mjs --mode reviewer-panel --task '#NNN' <<'JSON'
{"envelopes":[/* exact arbiter-agent-return-v1 reviewer envelopes */]}
JSON
node scripts/check-review-completion.mjs --task '#NNN'
```

The recorder stamps branch and SHA and writes the sidecar from the persisted treatment. The checker
rejects missing or malformed envelopes, stale subjects, sidecar/treatment drift, and applicable
MED/HIGH/CRITICAL findings. A missing envelope may be retried once in the same round. A returned
finding is reconciled with every other finding from that round in one fix batch.

After a fix batch, the candidate SHA changes and all dependent review and acceptance evidence is
invalid. Open round two with `arbiter ship --review-round`; it reviews only the delta from the prior
reviewed SHA. Two rounds is the normal cap. Only LOW findings may be parked. Use
`--force-review` only for a deliberate extra round needed to clear a material blocker.

Timeout, OOM, rate limit, unavailable tool, or malformed dispatcher output is an infrastructure
result. Preserve it as such; do not turn it into a source failure or a clean review.
