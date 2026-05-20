---
title: 'Arbiter — Conflict Resolution'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method']
related: []
---

# Arbiter — Conflict Resolution

How arbiter handles existing files, merges configuration, and ensures idempotent operation.

---

## Conflict Resolution Strategy

| File                               | Strategy                         | Reason                           |
| ---------------------------------- | -------------------------------- | -------------------------------- |
| `AGENTS.md`                        | Backup + replace                 | Always regenerated from template |
| `.claude/CLAUDE.md`                | Backup + replace                 | Thin pointer — stateless         |
| `.agents/CODEX.md`                 | Backup + replace                 | Thin pointer — stateless         |
| `.claude/settings.json`            | Deep merge                       | Custom hooks must be preserved   |
| `.claude/hooks/*.mjs`              | Skip if exists                   | Project-customized               |
| `.claude/rules/*.md`               | Skip if exists                   | Project-customized               |
| `.claude/commands/*.md`            | Skip if exists                   | Project-customized               |
| `.github/workflows/ci.yml`         | Skip if exists                   | May be heavily customized        |
| `.github/PULL_REQUEST_TEMPLATE.md` | Skip if exists                   | May be customized                |
| `.github/ISSUE_TEMPLATE/*`         | Skip if exists                   | May be customized                |
| `scripts/check-all.mjs`            | Skip if exists                   | May be customized                |
| `SECURITY.md`, `.editorconfig`     | Skip if exists                   | Created once                     |
| GitHub labels                      | Create missing + update existing | Idempotent provisioning          |
| Branch protection                  | Always apply                     | Rules are deterministic          |

---

## settings.json Deep Merge

When `.claude/settings.json` already exists, arbiter deep-merges:

- `permissions.allow` — union of arrays, deduplicated by command
- `permissions.deny` — union of arrays, deduplicated by command
- `hooks` — incoming hooks added if their `matcher` isn't already present
- All other keys — incoming wins

This preserves project-specific hook registrations while adding missing ones.

---

## ai-rulez Detection

If `.ai-rulez/` or `ai-rulez.yml` is present, arbiter detects it and skips multi-tool config generation (the other tool handles it). GitHub and quality gate generation still proceed.

---

## Idempotency Guarantees

**Running `arbiter init` twice is safe** — idempotent by design.

- Canonical files (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`) are backed up before replacement
- Customizable files (hooks, rules, commands, workflows) are never overwritten
- `settings.json` is deep-merged, preserving existing configuration
- GitHub labels use create-or-update semantics (never deleted)
- Branch protection rules are deterministic and re-applicable

This means arbiter can be run repeatedly — after upgrades, after template changes, or in CI — without destroying project customizations.
