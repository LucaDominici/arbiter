---
name: senior-survey
description: Use BEFORE creating any new file under src/. Guides grep + classify + decide protocol and emits a structured Survey block for the plan that the pre-edit hook can validate.
title: 'Senior Code Survey'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Senior Code Survey

Use this skill before writing any new file under `src/`. It ensures you reason like a senior engineer: identify what already exists, decide the minimum viable path, and document the decision with evidence.

## When to Use

Any time you are about to call Write with a path under `src/` that does not yet exist.

## Skip When

- File already exists (you are editing, not creating)
- Target is under `__tests__/`, `docs/`, `scripts/` — not under `src/`
- Target is a test file (`*.test.ts`, `*.spec.ts`)

## Protocol

### Step 1 — Name the target

State:

- Relative path: `src/<path/to/file>.ts`
- Main export(s) you plan to add

### Step 2 — Run ≥3 searches

Execute these (replace `<Name>` and `<keyword>` with your specific terms):

```bash
grep -r "export.*<Name>" src/ --include="*.ts" -l
grep -r "<keyword>" src/ --include="*.ts" -l
ls src/<sibling-directory>/
```

Capture the results (file:line hits or `(no match)`).

### Step 3 — Classify

Choose one decision keyword:

| Keyword              | Meaning                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `refactor-applied`   | Similar code found; you are extending/extracting instead of creating new |
| `refactor-rejected`  | Similar code found but refactoring would pollute the abstraction         |
| `extend`             | Adding to an existing file/module rather than creating new               |
| `extract`            | Pulling shared logic out of existing files into a new shared utility     |
| `new file justified` | No similar code; new responsibility is architecturally distinct          |
| `no-similar-code`    | Grepped thoroughly; nothing similar exists                               |

### Step 4 — Emit the Survey block

Paste this into your plan (one block per new file):

```markdown
## Existing Code Survey

- **Target:** `src/<relative/path>.ts`
- **Decision:** `<keyword from table above>`

### Evidence

- `grep "export.*<Name>" src/ --include="*.ts" -l` → `<file:line>` | `(no match)`
- `grep "<keyword>" src/ --include="*.ts" -l` → `<file:line>` | `(no match)`
- `ls src/<sibling>/` → `<entries>` | `(none similar)`

### Rationale

<2–4 sentences. State: what similar code you found (or didn't find); why refactoring was or was not viable; what new responsibility makes this file architecturally justified. Must be ≥200 non-whitespace characters — a stub like "needed" will be rejected by the hook.>
```

## Hook Validation

The `pre-edit-plan-anchor.mjs` hook validates this block before allowing the Write. It requires:

1. `- **Target:** \`src/your/file.ts\`` — exact relpath of the file being written
2. `- **Decision:** \`<keyword>\`` — one of the six valid keywords
3. `### Evidence` subsection with ≥3 lines starting with ``- `grep`` or ``- `ls``
4. `### Rationale` subsection with ≥200 non-whitespace characters

If validation fails: `STOP — CANON-16 violation`. Fix the Survey or set `ARBITER_PLAN_BYPASS=1` for justified bypasses.

## Multi-File Tasks

If your task creates multiple new `src/` files, add one `## Existing Code Survey` block per file. Each block must have its own `Target` line matching that specific file.
