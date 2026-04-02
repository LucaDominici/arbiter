# ADR-011: Brownfield-first design — conflict resolution from day one

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

Arbiter is designed to be run on existing projects ("brownfield") as well as new ones ("greenfield"). Any project that already has AI tool configurations, hook scripts, or settings files in place presents a conflict: should arbiter overwrite them, skip them, or merge them?

This decision was made at the start of the project, before any generator was written, and shaped the entire write pipeline.

## Decision

Every generated file has an explicit conflict resolution strategy assigned at the point of generation:

| Strategy             | When used                                                        | Files                                                                                        |
| -------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **backup + replace** | Canonical files — stateless, safe to regenerate                  | `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `.cursorrules`, `.github/copilot-instructions.md`      |
| **deep merge**       | Stateful config with both stable and project-customized sections | `.claude/settings.json`                                                                      |
| **skipIfExists**     | Project-customizable files — created once, never overwritten     | Hook scripts, rules, commands, GitHub workflows, issue templates, `check-all.mjs`, root files |

These strategies are implemented in `src/utils/fs.ts`:

- `writeFile(path, content, { backup: true })` — copies existing file to `<file>.bak`, writes new content.
- `writeFile(path, content, { skipIfExists: true })` — returns `action: 'skipped'` if file exists, writes nothing.
- `mergeSettingsJson(existingPath, incoming)` — deep merges: hooks union by `matcher+command`, permissions union arrays, other keys keep the existing value (existing wins).

## Rationale

The core insight: files fall into two categories.

**Stateless files** (canonical thin pointers) contain no project-specific content. They are fully determined by `ProjectConfig`. Regenerating them is safe because nothing is lost. A backup is kept as a safety net, but the expectation is that users discard it.

**Stateful files** (hooks, rules, commands, GitHub files) are intended to be customized by the project team immediately after generation. Overwriting them on re-init destroys local work. The `skipIfExists` strategy respects the boundary between "arbiter's initial suggestion" and "project's actual configuration".

`settings.json` sits between the two: the hook wiring section is stateless (arbiter controls it), but the permissions and `allowedTools` sections are typically extended by the team. Deep merge handles both: arbiter's hooks are unioned in, project-specific permissions are preserved.

### Alternatives rejected

- **Always overwrite** — destroys local customizations on every re-init. Unacceptable for brownfield use.
- **Always skip** — means updates to canonical files (e.g., new `AGENTS.md` sections added in a new arbiter version) never reach the project. The `arbiter update` command exists specifically to refresh canonical files when desired.
- **Interactive conflict resolution** — complex to implement and breaks `--yes` mode. The rule-based approach covers the cases without user interaction.

## Consequences

**Positive:**

- Arbiter is safe to run on any existing project, including those with heavily customized hook scripts.
- Re-running `arbiter init` is idempotent for stateful files — a second run produces no changes to customized hooks, rules, or commands.
- `arbiter update` provides an explicit, opt-in path to refresh canonical files when the team decides to upgrade.

**Negative:**

- Users don't automatically receive updated hook templates when arbiter is upgraded. They must delete the file and re-init, or use `arbiter update`.
- The backup file (`*.bak`) accumulates on disk over multiple re-inits. Users must clean it up manually.
- The per-file strategy requires contributors adding new generators to consciously assign a conflict resolution strategy. There is no safe default — omitting the option throws an error.
