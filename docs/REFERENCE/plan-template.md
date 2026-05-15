# Plan Template — Context Block

**Issue:** #689

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
