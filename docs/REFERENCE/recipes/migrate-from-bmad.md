---
title: 'Recipe: Mapping BMAD-METHOD to arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Recipe: Mapping BMAD-METHOD to arbiter

**Issue:** #644

## Context

BMAD-METHOD (Be My Agile Developer) is a structured multi-agent workflow for AI-assisted software development. This recipe maps BMAD constructs to their arbiter equivalents and provides a worked migration example.

This document is factual. It does not compare the two systems qualitatively.

## Mapping Table

| BMAD construct                               | arbiter equivalent                                      | Scope delta                                                     |
| -------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| BMAD `analyst` agent                         | `feature-dev:code-explorer` subagent                    | arbiter scopes to codebase exploration; BMAD analyst is broader |
| BMAD `architect` agent                       | `feature-dev:code-architect` subagent                   | Direct equivalent — architecture design role                    |
| BMAD `developer` agent                       | Implementation phase of `/task #N`                      | arbiter bundles dev into task lifecycle                         |
| BMAD `qa` agent                              | `code-review:code-review` + adversarial verifier        | arbiter separates code review from QA gate                      |
| BMAD `story` file                            | Task brief (`.claude/plans/*.md` front-matter)          | Front-matter schema differs; see plan-template.md               |
| BMAD `epic`                                  | GitHub issue with `epic` label                          | arbiter uses GitHub issues natively; no separate epic file      |
| BMAD `prd.md`                                | `AGENTS.md` §Governance + `docs/` reference             | Product-level rules live in AGENTS.md; docs are free-form       |
| BMAD phases (Analyse → Architect → Dev → QA) | `/task` phases (plan → impl → gate → PR)                | Phase names differ; semantics are similar                       |
| BMAD `checklist`                             | AGENTS.md `§Invariants` + gate enforcement              | arbiter enforces checklists mechanically via gate/hooks         |
| BMAD `*.cursorrules` / `CLAUDE.md`           | arbiter-generated `AGENTS.md` + `.claude/settings.json` | arbiter generates these per-project from wizard output          |

## What BMAD Has That arbiter Does Not

- BMAD's hosted web UI and multi-model orchestration: arbiter is CLI-only and single-model per invocation.
- BMAD's `create-next-task` agent: arbiter has `arbiter work` commands but no auto-next-task generation.
- BMAD's persona customisation per agent role.

## What arbiter Has That BMAD Does Not

- Mechanical invariant enforcement (gate fails, not warns) at L1/L2.
- Cross-language compatibility matrix with fixture-based testing.
- Brownfield `--repair-state` recovery path.
- Anti-telemetry CI assertion.

## Worked Example

Given a BMAD project with `docs/prd.md`, `docs/stories/*.md`, and `.cursorrules`:

```bash
# 1. Run arbiter init — brownfield mode reads existing structure
arbiter init --brownfield

# 2. Each BMAD story maps to one GitHub issue
# Use GitHub CLI to create issues from story titles:
gh issue create --title "$(head -1 docs/stories/auth-story.md)" --label task

# 3. Move BMAD phase checklists into AGENTS.md invariants
# Open AGENTS.md, add each checklist item as a required invariant

# 4. Verify
arbiter doctor
node scripts/check-all.mjs L1
```

## Philosophical Overlaps and Differences

BMAD and arbiter share a core belief: structured, phase-gated AI workflows produce better outcomes than unstructured prompting. They differ on scope and enforcement:

- **Scope**: BMAD covers the full product lifecycle from PRD to deployment. arbiter focuses on the code-change lifecycle (plan → gate → PR).
- **Enforcement**: BMAD relies on agent discipline and checklists. arbiter enforces rules mechanically via hooks and gates that block on violation.
- **Portability**: BMAD works across AI providers via prompt files. arbiter targets Claude Code specifically but generates provider-agnostic governance docs.

## Gotchas

- BMAD story files have their own front-matter format. arbiter plan files require `context.issue`, `context.type`, `context.estimate` — add these before using `/task` commands.
- BMAD `.cursorrules` and `CLAUDE.md` are handwritten. arbiter generates `AGENTS.md` from wizard output; if you have existing rules, merge them into the generated file rather than replacing it.
- BMAD's QA phase often calls external services. arbiter's gate is local-only; move any external checks to a separate CI job wired as a required check.
