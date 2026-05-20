---
title: 'ADR-010: ai-rulez coexistence — detect and skip tool configs'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-010: ai-rulez coexistence — detect and skip tool configs

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

[ai-rulez](https://github.com/isobar-ai/ai-rulez) is another tool that generates AI tool configurations (Claude, Codex, Cursor, etc.) from a central YAML source (`ai-rulez.yml` or a `.ai-rulez/` directory). When arbiter runs `init` on a project that already uses ai-rulez, two generators would be writing to the same files (e.g., `.claude/CLAUDE.md`, `.cursorrules`), creating a conflict.

The question was: how should arbiter behave when it detects an existing ai-rulez installation?

## Decision

If `src/detectors/existing.ts` finds `.ai-rulez/` or `ai-rulez.yml` in the target directory, the init flow skips all tool config generation. `AGENTS.md` and GitHub files (workflows, templates, labels, branch protection) are still generated.

This is implemented in `src/commands/init.ts` as a guard around `runGenerators()`:

```typescript
if (!config.existing.aiRulez) {
  // generate .claude/, .agents/, .cursorrules, copilot-instructions.md
}
// always: generate AGENTS.md, .github/, scripts/check-all.mjs, root files
```

## Rationale

- **Respect existing tool ownership** — if a project has chosen ai-rulez to manage its tool configs, overwriting those files breaks their governance setup. Arbiter should not be destructive toward an existing, intentional choice.
- **AGENTS.md is neutral ground** — `AGENTS.md` is an AAIF standard, not arbiter-specific. Generating it alongside an ai-rulez setup is additive, not conflicting. ai-rulez does not currently generate `AGENTS.md`.
- **GitHub scaffolding is orthogonal** — CI workflows, PR templates, labels, and branch protection are infrastructure concerns, not tool-config concerns. They are safe to generate regardless of which tool manages AI configurations.

### Alternatives rejected

- **Hard stop with error message** — unhelpful. The user may want GitHub scaffolding even if they already have ai-rulez for tool configs.
- **Overwrite anyway** — destructive. Arbiter must not destroy an intentional governance setup.
- **Prompt the user for choice** — adds complexity and breaks `--yes` mode. The coexistence rule is clear enough to apply automatically.

## Consequences

**Positive:**

- Arbiter can be safely run on ai-rulez projects to add `AGENTS.md` and GitHub scaffolding without conflict.
- No user configuration required — detection is automatic.

**Negative:**

- Users who want arbiter to manage tool configs alongside ai-rulez must manually delete their ai-rulez installation first. There is no merge or migration path.
- The coexistence rule applies to the entire ai-rulez presence — there is no per-tool override (e.g., "generate `.cursorrules` even though ai-rulez is present").
