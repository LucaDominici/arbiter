---
title: 'Plan Template — Context Block'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Plan Template — Context Block

**Issues:** #689, #695

Every plan file under `.claude/plans/` must begin with a Context Block — a YAML front-matter section
validated by the `pre-edit-plan-anchor` hook. Plans without a Context Block are rejected at edit time.
Beyond the Context Block, the plan body must carry the mandatory sections listed in /ship's
`## Plan contents (mandatory sections)`.

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

Every plan ready for implementation must pass review before `arbiter task advance` will
move it into implementation. The gate itself is tool-agnostic: it only reads a
`latest.json` verdict file — how that file gets produced (a reviewing agent, a project's
own review script, a human) is deliberately not `arbiter`'s concern (A8: guidance, not
review machinery). The final verdict + plan SHA-256 digest belongs at
`.arbiter/evidence/plan-review/<sanitized-id>/latest.json`.

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
