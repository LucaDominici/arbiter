---
title: 'Refactor-First Rule (CANON-16)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Refactor-First Rule (CANON-16)

Before creating any new file under `src/`, `src/generators/`, `src/templates/`, or `src/commands/`:

## Mandatory Survey

Run these searches and record results in the plan:

```bash
# Find similar exports/functions
grep -r "export function <name>" src/ --include="*.ts" -l
grep -r "export.*<keyword>" src/ --include="*.ts" -l

# Find similar templates
ls src/templates/<domain>/
```

## Decision Tree

1. **Similar code found** → refactor first
   - Extend existing function via parameter
   - Extract shared logic to utility
   - Generalize existing template with new conditional
   - Document refactoring decision in plan: "Existing Code Survey: found X in Y, refactored by Z"

2. **Refactor not viable** → document WHY in plan before creating new file
   - Architecturally different responsibility
   - Semantic divergence that would pollute existing abstraction
   - Different lifecycle/ownership
   - Plan must include: "Existing Code Survey: found X, rejected refactor because Y, new file justified"

3. **No similar code** → create new file
   - Plan must include: "Existing Code Survey: grepped for <terms>, found nothing similar"

## Violation

Plan section "Existing Code Survey" missing → STOP at review (CANON-16).

A plan that proceeds directly to file creation without survey evidence is incomplete.

## What This Is NOT

- A ban on new files — new files are fine when justified
- A similarity-scanner — judgment, not automation
- Applicable to test files, fixtures, or documentation — source code only

## Rationale

Senior developers ask "does this already exist?" before building.
Three similar 30-line functions are worse than one 50-line function.
The survey cost is 60 seconds; the bloat cost is compounded across every future reader.
