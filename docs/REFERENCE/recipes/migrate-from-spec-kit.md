---
title: 'Recipe: Migrating from Spec Kit to arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Recipe: Migrating from Spec Kit to arbiter

**Issue:** #643

## Context

Microsoft Spec Kit provides structured spec files and plan documents for AI-assisted development. This recipe maps Spec Kit constructs to arbiter equivalents and walks through a brownfield migration.

## Mapping Table

| Spec Kit                             | arbiter equivalent                                | Notes                                                                    |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------ |
| `.speckit/spec/*.md`                 | `docs/` briefs + `AGENTS.md`                      | Spec files become task briefs; shared rules move to AGENTS.md            |
| `.speckit/plan/*.md`                 | `.claude/plans/*.md`                              | Plan files are structurally identical — copy and add YAML front-matter   |
| `speckit run` (wizard)               | `arbiter init`                                    | Single entry point; arbiter wizard auto-detects language/toolchain       |
| Spec Kit hooks (`preRun`, `postRun`) | `arbiter` hooks in `.claude/settings.json`        | Event model is identical; rename event keys per arbiter AGENTS.md §Hooks |
| Spec Kit validators                  | arbiter invariants in `src/invariants/catalog.ts` | Add per-invariant entries; arbiter gates enforce them at L1/L2           |
| `speckit status`                     | `arbiter doctor`                                  | Health-check command; arbiter adds INV compliance + hook-wiring checks   |
| `speckit report`                     | `arbiter report` (ships in #639 / M5)             | Report bundle format differs; see status note below                      |

**Status (2026-05-16):** `arbiter report` ships in M5 (#639). If your arbiter version predates M5, use `git log --oneline` + the error footer Run ID as a manual equivalent.

## What is NOT migrated

- Spec Kit's hosted spec registry (cloud-based sharing): arbiter has no hosted registry. Specs stay in your repo.
- Spec Kit's AI provider configuration: arbiter is provider-agnostic; configure your AI tool separately.
- Spec Kit's `review` workflow if it calls external APIs: arbiter review dispatch is local-only.

## Worked Example

Given a project with `.speckit/spec/auth.md` and `.speckit/plan/2024-01-auth.md`:

```bash
# 1. Initialise arbiter (safe on existing repos)
arbiter init --brownfield

# 2. Copy spec files to docs/
mkdir -p docs/specs
cp .speckit/spec/*.md docs/specs/

# 3. Add YAML front-matter to each plan file (arbiter ignores plans without it)
# Front-matter template: see docs/REFERENCE/plan-template.md

# 4. Move hooks: rename Spec Kit event names to arbiter events
# PreRun  → PreToolUse (Bash)
# PostRun → PostToolUse (Bash)

# 5. Verify health
arbiter doctor
```

After `arbiter init`:

- `AGENTS.md` is generated with your detected stack, governance level, and empty invariant slots.
- `.claude/settings.json` contains hook wiring compatible with Claude Code.
- The L1 gate (`node scripts/check-all.mjs L1`) is wired to your detected test command.

## Migration Effort Estimates

| Project size        | Spec files  | Estimated effort |
| ------------------- | ----------- | ---------------- |
| Small (1–5 specs)   | < 10 hooks  | 1–2 h            |
| Medium (5–20 specs) | 10–30 hooks | 0.5–1 day        |
| Large (20+ specs)   | 30+ hooks   | 1–3 days         |

Largest cost: mapping Spec Kit validators to arbiter invariants (requires reading `src/invariants/catalog.ts`).

## Gotchas

- Spec Kit plan files use different front-matter keys. Add `context.issue`, `context.type`, and `context.estimate` before using `/task` commands.
- If Spec Kit hooks write to `.speckit/state/`, add that path to `.gitignore` and mirror any state you need to `.arbiter/`.
- Shared Spec Kit rules become AGENTS.md invariants. Enforce them with `required: true` in the catalog entry so the L1 gate catches violations.
