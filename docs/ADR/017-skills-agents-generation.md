# ADR-017: Skills & Sub-Agents Generation (M19)

**Status:** Accepted
**Date:** 2026-04-08
**Issue:** #36

---

## Context

The prior-art baseline ships 20+ skills and 8 sub-agents as part of its Claude Code integration. These provide structured workflows (TDD, architect review, epic decompose) and specialized agents (codebase-scanner, red-team) that teams use daily.

Arbiter generates Claude Code configuration but produced none of these — teams initialized with arbiter got only AGENTS.md, hooks, and slash commands.

---

## Decision

Arbiter generates 7 skills and 2 sub-agent definitions as part of `arbiter init` and `arbiter update`:

**Skills** (`.claude/skills/<name>/SKILL.md`):

- `tdd` — Red-Green-Refactor cycle, stack-parameterized test runner references
- `verification` — Pre-commit/pre-push checklist, stack-aware invariant checks
- `architect-review` — Structural review, stack-specific layer guidance
- `clean-code` — DRY/KISS/YAGNI with stack-specific idioms
- `understand-code` — 4-step read-only comprehension protocol, GLOBAL_INVARIANTS integration at L2+
- `codebase-audit` — Parallel agent audit across disjoint scopes
- `epic-decompose` — Sequenced task breakdown with acceptance criteria

**Agents** (`.claude/agents/<name>.md`):

- `codebase-scanner` — Haiku-model, read-only, fast pattern search
- `red-team` — Adversarial security/quality review, read-only

---

## Constraints

- **Claude-only**: Skills and agents are generated only when `tools.includes("claude")`.
- **aiRulez guard**: Skipped when `existing.aiRulez` is true (ai-rulez manages tool configs).
- **skipIfExists**: All files use `skipIfExists: true` — teams can customize without being overwritten on `update`.
- **Stack parameterization**: EJS templates branch on `language` to include framework-specific test runners, patterns, and references.

---

## Alternatives Considered

1. **Ship generic universal skills** — simpler templates, but miss stack-specific guidance (e.g., JUnit vs vitest).
2. **External skill registry** — pull from a remote catalog. Too complex, unnecessary dependency.
3. **Single flat skills directory** — no subdirectory per skill. Rejected to match production-style convention.

---

## Consequences

- `arbiter init` on a Java project now generates JUnit-referencing TDD skill, Java-specific architect-review guidance, etc.
- Teams get structured workflows out of the box without writing them from scratch.
- Customizations survive `arbiter update` due to `skipIfExists`.
