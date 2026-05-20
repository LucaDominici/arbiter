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

```bash
arbiter review code --diff origin/main --tier S
arbiter review code --json
arbiter review code --evidence-dir .evidence/custom/
```

Each agent's raw response is persisted under
`.evidence/review-<timestamp>/agent-<name>.json` for audit.

## Tier guidance

| Tier     | Reviewer agents |
| -------- | --------------- |
| XS       | 3               |
| S        | 3               |
| Standard | 5               |

## Personas

- **bugs** — logic, off-by-one, null-deref, race, edge cases
- **type-safety** — type leaks, casts, `any`/`unknown` misuse
- **domain-consistency** — drift vs `AGENTS.md` (Standard)
- **silent-failure-hunter** — swallowed errors, empty catches, ignored rejections
- **test-analyzer** — coverage and assertion quality (Standard)

## Auditor Routing

Auditors are selected per-diff using `.claude/auditor-routing.json`. Run before dispatching agents:

```bash
git diff --name-only --no-renames origin/main...HEAD | node scripts/route-auditors.mjs --diff-stdin
```

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

## Hard stops

- Any agent emits a `blocker` finding → exit 2, no merge.
- Dispatcher exception / timeout / malformed JSON → surfaced as a blocker
  finding (never silently dropped).
- Tier flag is invalid → exit 1 with usage error.
