---
generated: true
source: 'docs/REFERENCE/plan-template.md'
source_sha: '9cee7a771e5512dd3b1a239ddcb5476de0c97b91'
last_updated: '2026-06-13'
---

# Plan Template — Context Block

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/plan-template.md](../docs/REFERENCE/plan-template.md)

# Plan Template — Context Block

**Issues:** #689, #695

Every plan file under `.claude/plans/` must begin with a Context Block — a YAML front-matter section
validated by the `pre-edit-plan-anchor` hook. Plans without a Context Block are rejected at edit time.

---

## Template

Copy this skeleton and fill in every field before writing plan body.

```markdown
---
context:
  issue: '#NNN'
  type: feat|fix|chore|docs|refactor|test
  pipeline: 'plan → impl → gate → PR'
  branch_convention: 'task/#NNN-kebab-description'
  base_branch: main
  key_constraints:
    - 'One constraint per bullet'
  red_team_warnings:
    - 'One risk per bullet'
  estimate: 'XS (1h) | S (2h) | M (8h) | L (2d) | XL (1w)'
---

# Plan: Issue #NNN — Short Title

## Scope

...
```

For batched issues (multiple IDs in one plan), use the `issues` array instead of `issue`:

```yaml
context:
  issues:
    - '#NNN'
    - '#MMM'
```

---

## Required Fields

| Field               | Format                       | Notes                                    |
| ------------------- | ---------------------------- | ---------------------------------------- |
| `issue` / `issues`  | `"#NNN"` or list of `"#NNN"` | At least one required                    |
| `type`              | conventional-commit keyword  | `feat`, `fix`, `chore`, `docs`, etc.     |
| `pipeline`          | free text                    | Typically `"plan → impl → gate → PR"`    |
| `branch_convention` | `task/…` prefix              | Must match actual branch naming          |
| `base_branch`       | branch name                  | Typically `main`                         |
| `key_constraints`   | list                         | One invariant or constraint per item     |
| `red_team_warnings` | list                         | One risk or adversarial concern per item |
| `estimate`          | size + time                  | E.g. `"S (2h)"`, `"M (8h)"`              |

---

## Bypass

In CI or automated contexts where a plan file is unavailable, set:

```bash
export ARBITER_PLAN_BYPASS=1
```

This skips all plan-anchor validation. Not for interactive use.

---

## Legacy Plans

Plans written before issue #689 carry a `# [legacy — pre-Context-Block]` header and are
exempt from the Context Block requirement. Do not add a Context Block to legacy plans
retroactively — legacy marker is the bypass signal.

---

## Plan Review Gate (#695)

Every plan ready for implementation must pass an N-pass review:

```bash
arbiter review plan --file .claude/plans/<slug>.md
```

The tier is auto-detected from `.claude/.task-tier`. Pass count by tier:

| Tier       | Passes per cycle | Source value         |
| ---------- | ---------------- | -------------------- |
| `XS`       | 1                | `XS` or no tier file |
| `S`        | 3                | `S`                  |
| `Standard` | 5                | `M`, `L`, `Standard` |

Each pass runs `claude -p <prompt>` and records `pass-<N>.json` under
`.arbiter/evidence/plan-review/<sanitized-id>/run-<ts>/`. The final verdict + plan SHA-256
digest is written to `<sanitized-id>/latest.json`. Up to **2 revise cycles** are allowed
when the aggregator returns WARN; if all cycles still WARN, the verdict becomes FAIL
(`reason: max revisions exceeded`).

### Gate enforcement

`arbiter task advance --to implementation` consults `latest.json` and refuses to advance
when:

- `latest.json` is missing
- `verdict !== PASS`
- `planDigest` does not match the current plan content (plan changed since review)

The gate is **opt-in per project** via `.arbiter/plan-review.enabled` — projects without
the flag file get the legacy behaviour (advance freely). Plant the flag to activate:

```bash
touch .arbiter/plan-review.enabled
```

### Bypass

When you must advance without a fresh review (emergency hotfix, broken claude CLI, etc.):

```bash
arbiter task advance --to implementation --skip-plan-review
# or (non-CI only):
ARBITER_SKIP_PLAN_REVIEW=1 arbiter task advance --to implementation
```

Every bypass writes an audit record to
`.arbiter/evidence/plan-review/<sanitized-id>/bypass-<ts>.json` with the reason, git
user name (never email — INV-12 PII), and timestamp, and emits a `WARNING` to stderr.

Under `CI=true` the env-var bypass is **refused**: only the explicit `--skip-plan-review`
flag works. This keeps unattended bypass out of pipelines.

### Claude CLI missing

When `claude` is not on `PATH`, each pass returns `verdict: ERROR` and the final verdict
is FAIL with reason `claude CLI required for plan-review`. Set
`ARBITER_PLAN_REVIEW_OPTIONAL=1` to convert ERROR → PASS (SKIPPED) for unattended
environments where plan-review is not feasible.

### Agent-agnostic review (hosted agent / Codex / any model) (#1329)

When the orchestrating agent is itself a capable model but is **not** Claude Code (a hosted
agent session, Codex, etc.), it can serve as the reviewer directly — no `claude` CLI, no
SKIPPED degrade. The flow is a two-step emit/submit handshake that writes the **same**
evidence the dispatch path does, so the gate finalises unchanged:

```bash
# 1. Emit the per-pass reviewer prompts (one per TIER_PASS_COUNT pass) and exit.
arbiter review plan .claude/plans/<slug>.md --emit-prompts .arbiter/review-prompts \
  --tier S
# → writes pass-1.txt … pass-N.txt + manifest.json; NO latest.json yet.

# 2. The agent reviews each emitted prompt itself, then records its verdicts.
arbiter review submit .claude/plans/<slug>.md --tier S --reviewer agent-harness \
  --pass 1:PASS --pass 2:PASS --pass 3:PASS \
  --manifest .arbiter/review-prompts/manifest.json
# → folds verdicts (all PASS → PASS, any FAIL → FAIL) and writes latest.json
#   with source:"submit" + reviewer provenance. The gate then unblocks exactly
#   as for the claude path.
```

The `--manifest` cross-check rejects a submit whose plan SHA-256 differs from the emitted
prompts (a plan edited after emit must be re-emitted). Provenance (`reviewer`, `source`) is
recorded in `latest.json` and each `pass-<N>.json`, keeping the trail auditable — this is a
tool-agnostic _path_, not a bypass.
