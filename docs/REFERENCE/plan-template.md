---
title: 'Plan Template — Context Block'
doc_version: '1.0.2'
status: active
last_review: '2026-09-25'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Plan Template — Context Block

**Issues:** #689, #695, #2913

A plan file under `.claude/plans/` may begin with a Context Block — a `context:` key in its YAML
front matter. It is an optional recovery anchor for a reader resuming the task; it is not validated
by any hook or by admission (#2913). The plan body must carry the mandatory sections listed in /ship's
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

## Fields

When you write a Context Block, use these fields.

| Field               | Format                       | Notes                                    |
| ------------------- | ---------------------------- | ---------------------------------------- |
| `issue` / `issues`  | `"#NNN"` or list of `"#NNN"` | At least one                             |
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

Plans written before issue #689 may carry a `# [legacy — pre-Context-Block]` header. Since #2913
nothing reads that marker; a plan without a Context Block needs no marker.

---

## Result-first admission (#2724)

The active Markdown plan is the one shared delivery contract. Before implementation it must freeze:

- explicit `AC-N` acceptance criteria and non-goals;
- the complete `files:` manifest;
- dependency and caller evidence used for treatment qualification;
- the smallest executable implementation and its RED proof;
- rollback and recovery notes.

`arbiter lifecycle advance --to red` performs mechanical admission. Missing or malformed required
input fails closed; incomplete narrow-tier evidence widens treatment to Standard. There is no second
host-specific plan or reviewer verdict before code. Independent judgment is reserved for the frozen
candidate, where the final reviewer evaluates code and returns one acceptance decision per AC.

## Premortem decision (#2890)

At the plan step `arbiter ship` derives a premortem decision from the `files:` manifest and the
resolved treatment only (never file contents) and prints it as one `premortem:` line. The decision
is recomputed from the current manifest wherever it is read (the plan-step print, the review freeze,
the delivery record) and is never stored in `.claude/.task/status.json` (#2899); a `premortem` key
left there by an older version is ignored:

| Decision        | When                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `required`      | hooks or templates touched, sensitive treatment, Standard with ≥2 areas, empty/unreadable manifest |
| `deterministic` | `.github/workflows/**` (with the CI-infra checklist), and every other plan                         |
| `skip-llm`      | XS/S plan with no `src`, hook, template or workflow file                                           |

The first matching rule wins, in this order: `--premortem`, hooks/templates, workflows, sensitive,
Standard multi-area, empty manifest, XS/S skip, default. `--premortem` forces `required`; only
that input is stored (`premortemForced: true`) and it binds every later read. A `required` decision blocks the review freeze with
`E_PREMORTEM_REQUIRED` until the plan names the notes: a `premortem: <path>` frontmatter key, or a
`PREMORTEM_*` path in `files:`. The path must be repo-relative (no absolute path, no `..`) and point
at a non-empty regular file inside the repository; symlinks are refused. For a task with a ship
treatment, every delivery-record line in `.claude/.task/log.md` ends with `premortem=<decision> rounds=<n>`.
