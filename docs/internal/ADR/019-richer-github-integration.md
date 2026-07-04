---
title: 'ADR-019: Richer GitHub Integration (M21)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '019'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-019: Richer GitHub Integration (M21)

**Status:** Accepted
**Date:** 2026-04-09
**Deciders:** Luca Dominici
**Issue:** #39

## Context

Arbiter's original GitHub issue templates were minimal (4-section task-brief, basic bug report, no epic). The prior-art baseline demonstrated that 7-section structured task briefs drive better AI-assisted task execution by making context, invariants, acceptance criteria, and forbidden patterns explicit upfront.

This ADR records the design decisions made in M21.

## Decisions

### 1. Task-brief becomes EJS (governance-gated sections)

**Decision:** Convert `task-brief.yml` to `task-brief.yml.ejs` and gate sections 3 (Engineering Invariants) and 7 (Forbidden Patterns) on `governanceLevel !== 'L1'`.

**Rationale:** L1 projects are lightweight bootstraps. Forcing invariant checklists and forbidden-pattern documentation on L1 users creates friction disproportionate to the value. L2/L3 projects have committed to structured governance and benefit from the full 7-section brief.

**Consequences:** The generator pulls task-brief out of the static template loop and renders it separately via EJS, consistent with the existing `ci.yml.ejs` pattern.

### 2. Bug report enhanced to 6 sections

**Decision:** Add Severity dropdown, structured Context, combined Repro/Observed-vs-Expected, optional Invariant Violation reference, optional Evidence field, and Acceptance Criteria checkboxes.

**Rationale:** The original 4-section template omitted severity triage and acceptance criteria, making it ambiguous when a bug was actually fixed. The invariant violation reference links defects back to the project's engineering contracts.

### 3. Epic template added

**Decision:** New `epic.yml` template with 5 sections: Goal & Business Value, Scope & Boundaries, Sub-tasks, Success Metrics / DoD, Risks & Dependencies.

**Rationale:** Epics are container issues that link multiple task-briefs. Without a template, epic descriptions are freeform and miss key scoping information (what's out of scope, how to know when done).

**Note:** Epic stays static YAML — governance gating is not needed because epics are structural, not enforcement-level.

### 4. Project board setup via gh CLI

**Decision:** New `src/github/project-board.ts` module, called from `runGithubSetup()`, creates a GitHub Project with Priority (P0/P1/P2) and Size (XS/S/M/L) custom fields.

**Rationale:** The Priority and Size fields mirror the existing label taxonomy (ADR-007), creating consistency between issue labels and project board triage. Automating board creation removes a manual step that teams routinely skip.

**Failure mode:** Graceful — same pattern as `branch-protection.ts`. If `gh project create` fails (permissions, org restrictions), a warning is printed but `arbiter init` completes normally.

## Consequences

**Positive:**

- Task-brief templates now encode 7 structured sections that AI agents and human developers use to drive consistent implementation.
- Severity and acceptance criteria in bug reports make triage and closure unambiguous.
- Epic template ensures scope and success criteria are explicit before decomposition begins.
- Project board creation is automated, not manual.

**Negative:**

- `task-brief.yml.ejs` adds EJS complexity to what was a simple static file. YAML + EJS whitespace must be managed carefully (use `<%_` / `_%>` trim tags).
- `gh project` CLI requires `project` scope in the GitHub token; some CI environments may not have it, causing graceful-but-visible skips.
