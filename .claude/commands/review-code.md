---
description: Multi-agent code review via the arbiter review subagent dispatcher (#236)
argument-hint: [--diff <ref>] [--tier XS|S|Standard]
title: "/review-code"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# /review-code

Dispatch N parallel Claude subagents over the current diff. Each agent
focuses on a distinct concern; their findings are aggregated into
blocker / warning / note buckets.

| Severity  | Exit code |
| --------- | --------- |
| `blocker` | 2 (fail)  |
| `warning` | 1         |
| (clean)   | 0         |

## Usage

Dispatch N parallel Claude subagents over the current diff. Each agent
focuses on a distinct concern; their findings are aggregated into
blocker / warning / note buckets.

1. **Route** the current diff to compute the auditor set — see
   [Auditor Routing](#auditor-routing) for the invocation (include
   `--size-floor <tier>` so the tier widens the active set).
2. **Dispatch** one subagent per routed auditor.
3. **Verify completion** — see [Completion check](#completion-check).

Each agent's raw response is persisted under
`.evidence/review-<timestamp>/agent-<name>.json` for audit.

## Tier guidance

The tier→reviewer-count mapping lives in `.claude/agent-dispatch-matrix.json`
(`tier_verticals`) — the SSOT also consumed by `scripts/route-auditors.mjs`
via `--size-floor <tier>` and asserted against `src/sizing/sizing.ts` by
`scripts/check-agent-dispatch.mjs`. Read the matrix for the current counts;
never copy them here.

The auditor roster — names, weights, and the `always_on` / `tag_map` /
`critical_paths` selection — is defined in `.claude/auditor-routing.json`, the
SSOT consumed by `scripts/route-auditors.mjs`. Route the current diff to learn
which personas are active; do not hardcode the roster here.

## Completion check

After dispatch, verify every persona returned a verdict — each
`.evidence/review-<timestamp>/agent-<name>.json` must carry a non-empty
findings result. If any persona produced no verdict, retry that persona once
(re-dispatch with the same scope). A second miss is a blocker: do not aggregate
a partial review.

## FIT Rubric (INV-138) — target, not just quality

A reviewer that sees only the diff can say "good code", never "the code that was asked
for". When the active task's plan carries a frozen `## Acceptance Criteria` anchor
(`AC-N:` ids), the review MUST judge fit against it as an explicit rubric:

- For **each** `AC-N`: cite the diff or test `file:line` that satisfies it — verdict
  PASS / FAIL / NOT-TESTED. An uncited PASS does not count.
- Any criterion without demonstrated evidence ⇒ **REJECT**, regardless of code quality.
- Diff behavior that maps to no criterion and violates a `## Non-Goals` bullet ⇒
  scope-creep finding.
- Record the verdicts in `.arbiter/evidence/ac-fit/<taskId>.json` — taskId sanitized
  for the filename (`#` and `/` stripped: task `#42` → `42.json`), schema
  `arbiter-ac-fit-v1` — validated by `scripts/check-acceptance.mjs`, which
  hard-requires all-PASS at verification/close.
- A REJECT that forces a redo is rework data:
  `node scripts/rework-log.mjs add --issue <n> --reason <r> --caught review`.

## Auditor Routing

Auditors are selected per-diff using `.claude/auditor-routing.json`. Run before dispatching agents:

```bash
git diff --name-only --no-renames origin/main...HEAD | node scripts/route-auditors.mjs --diff-stdin --size-floor <tier>
```

`<tier>` is the issue size (`XS|S|Standard`); the floor widens the active
auditor set per `.claude/agent-dispatch-matrix.json::tier_verticals`
(union-only — it never removes a file-path-selected auditor).

### Precedence (highest to lowest)

1. **`critical_paths`** — force-activates ALL auditors (governance files, security-sensitive paths)
2. **`always_on`** — bugs, type-safety, domain always active regardless of diff
3. **`tag_map`** — glob patterns map file types to additional auditors (union semantics)
4. **skip** — unlisted auditors inactive

### Dual scoring

| Metric          | Formula                              | Meaning                                 |
| --------------- | ------------------------------------ | --------------------------------------- |
| `coverage`      | `active_weight / total_weight`       | What fraction of review capacity ran    |
| `pass_rate`     | `active_pass_weight / active_weight` | Fraction of active capacity that passed |
| `coverage_tier` | `minimal` / `partial` / `full`       | Human label alongside pass_rate         |

**Never interpret `pass_rate` alone** — a docs-only diff has `coverage_tier=minimal`;
a 100% `pass_rate` on 1 auditor is not the same as 100% on all 7.

Empty diff or empty active set → `route-auditors.mjs` exits 1 (refused to score).

### Weighted verdict score (#1212)

After the auditors run, compute a single anti-inflation verdict:

```bash
node scripts/route-auditors.mjs --score \
  --results '{"bugs":true,"security":false,...}' \
  --caps    '{"security":0}'   # optional — see forward-link below
```

`score = 100 × Σ(weight of passing active auditors) / Σ(weight of ALL auditors)`.
The denominator is the **total** auditor weight, never the active subset — so a
skipped auditor contributes 0 to the numerator exactly like a failing one and **a
skip can never raise the score** (no inflation by omission). Verdict ladder:

| Score | Verdict    |
| ----- | ---------- |
| ≥ 80  | `PASS`     |
| ≥ 60  | `CONCERNS` |
| ≥ 40  | `REWORK`   |
| < 40  | `FAIL`     |

`--caps` lowers a single auditor's contribution to at most `pct`% of its weight.
This is how an unaddressed red-team finding caps its mapped auditor (see
**Forward-linked red-team findings** below). Caps are **agent-applied** at review
time — the agent passes them based on the unresolved-finding ledger; the script
does not itself read task state.

### Forward-linked red-team findings (#1212, INV-114 sibling)

If the plan / unified task document (`.claude/.task/status.json`) carries
`redTeamFindings` (`RT-01`, `RT-02`, …), re-verify each at code-review:

1. Map every **unresolved** `RT-xx` to the auditor whose remit it falls under
   (its `auditorHint` — one of the `auditors` keys above).
2. Pass `--caps '{"<auditor>":0}'` for each such auditor so its contribution is
   capped, and tag the auditor's section `[RT-xx UNRESOLVED]` in the report.
3. A finding marked `resolved` in the ledger imposes no cap.

## Hard stops

- Any agent emits a `blocker` finding → exit 2, no merge.
- Dispatcher exception / timeout / malformed JSON → surfaced as a blocker
  finding (never silently dropped).
- Tier flag is invalid → exit 1 with usage error.
