# Canonical Source Model — Deep Dive

Arbiter's invariant: one canonical governance file, all tool configs as thin overlays. This document explains the model in full, why it exists, and how the write pipeline enforces it at generation time.

For the layer diagram and quick summary, see [OVERVIEW.md](OVERVIEW.md). For the ADR rationale, see [ADR-001](../ADR/001-agents-md-canonical.md) and [ADR-002](../ADR/002-thin-pointer-pattern.md).

---

## Why AGENTS.md Is Canonical

`AGENTS.md` was co-donated to the [AAIF (Agentic AI Interoperability Foundation)](https://agents.md/) by Anthropic and OpenAI in December 2025. It is a Linux Foundation standard, not a proprietary format. As of early 2026:

- **Universal native reading** — Claude Code, Codex, Cursor, Copilot, Gemini CLI, and Windsurf all read `AGENTS.md` without configuration.
- **Single maintenance point** — a governance change written once in `AGENTS.md` propagates to every tool automatically.
- **No vendor lock-in** — the file format belongs to the AAIF, not to any AI tool vendor.
- **Adopted at scale** — 60,000+ projects use the standard.

The alternative — maintaining governance in each tool's native format — guarantees drift. Tool configs each add their own syntax and semantics; keeping them consistent manually is unsustainable.

---

## Layer Model

```
Layer 0   AGENTS.md                         <- Canonical governance (AAIF standard)
             |
Layer 1   .claude/CLAUDE.md                 <- Claude Code overlay (thin pointer)
          .claude/settings.json             <- Hook wiring + permissions (deep-merged)
          .claude/hooks/*.mjs                <- Enforcement scripts (skipIfExists)
          .claude/rules/*.md                <- Rule documents (skipIfExists)
          .claude/commands/*.md             <- Slash commands (skipIfExists)
             |
          .agents/CODEX.md                  <- Codex overlay (thin pointer)
          .agents/rules/                    <- Rule mirror (skipIfExists)
          .agents/plan/                     <- Task plan artifacts (skipIfExists)
             |
Layer 2   .github/workflows/ci.yml          <- CI pipeline (skipIfExists)
          .github/PULL_REQUEST_TEMPLATE.md  <- PR template (skipIfExists)
          .github/ISSUE_TEMPLATE/           <- Issue templates (skipIfExists)
          .github/dependabot.yml            <- Dep updates (skipIfExists)
          scripts/check-all.mjs              <- Gate runner (skipIfExists)
          CODEOWNERS                        <- Review ownership (skipIfExists)
          SECURITY.md                       <- Vulnerability policy (skipIfExists)
          CONTRIBUTING.md                   <- Contribution guide (skipIfExists)
          .editorconfig                     <- Editor defaults (skipIfExists)
```

Each layer has a distinct role and write strategy. Mixing them — for example, putting invariants in `CLAUDE.md` or coding standards in a hook — creates drift.

---

## What Belongs Where

### Layer 0: AGENTS.md (Canonical — backup + replace)

Everything that must be consistent across all AI tools:

| Concern                | Example                                       |
| ---------------------- | --------------------------------------------- |
| Project identity       | name, stack, build/test commands              |
| Authority hierarchy    | which document overrides which                |
| Invariants             | non-negotiable architecture and process rules |
| Coding standards       | language-specific conventions                 |
| Testing policy         | what must be tested and how                   |
| Commit convention      | `type(scope): summary` format                 |
| Branch strategy        | naming, protection rules                      |
| Gate system            | L1/L2/L3 quality levels                       |
| Multi-agent extensions | per-tool capability table                     |

`AGENTS.md` is stateless (fully regenerated from `ProjectConfig`). A backup is kept on re-init (`AGENTS.md.arbiter-backup`) but the file is always replaced. See [ADR-001](../ADR/001-agents-md-canonical.md).

### Layer 1: Tool Overlays (thin pointer — backup + replace for `CLAUDE.md`/`CODEX.md`, deep merge for `settings.json`, skipIfExists for everything else)

Tool overlays **add** what `AGENTS.md` cannot express natively for a specific tool. They must **not** duplicate any content already in `AGENTS.md`.

**What tool configs add (and only this):**

| Concern               | Claude Code                                    | Codex                          |
| --------------------- | ---------------------------------------------- | ------------------------------ |
| Permissions schema    | `settings.json` `permissions` + `allowedTools` | —                              |
| Hook wiring           | `settings.json` `hooks` section                | —                              |
| Enforcement scripts   | `.claude/hooks/*.mjs`                          | —                              |
| Slash commands        | `.claude/commands/*.md`                        | —                              |
| Sub-agent definitions | `.claude/agents/*.md`                          | —                              |
| Plan schema           | —                                              | `CODEX.md` §Plan Schema        |
| Execution router      | —                                              | `CODEX.md` §Execution Router   |
| Context pack          | —                                              | `.agents/plan/CONTEXT_PACK.md` |
| Rule mirror           | `.claude/rules/`                               | `.agents/rules/`               |

**What tool configs must not contain:**

- Invariants (those live in `AGENTS.md`)
- Coding standards (those live in `AGENTS.md`)
- Commit conventions (those live in `AGENTS.md`)
- Testing policy (those live in `AGENTS.md`)
- Authority hierarchy (lives in `AGENTS.md`)

Any content duplicated between `AGENTS.md` and a tool config will drift the moment one is updated without the other.

### Layer 2: GitHub + Infrastructure (skipIfExists)

GitHub files, the CI workflow, and infrastructure files (`CODEOWNERS`, `SECURITY.md`, `CONTRIBUTING.md`, `.editorconfig`) are generated once and never overwritten. They are intended for project-specific customization immediately after generation. See [ADR-004](../ADR/004-skip-if-exists.md).

---

## Write Pipeline and Drift Prevention

The generation pipeline enforces the layer model through two mechanisms:

### 1. Write Strategy Per File

`src/utils/fs.ts` exposes `writeFile(path, content, opts)` with:

- `{ backup: true }` — write a `.arbiter-backup` copy of the existing file, then replace. Used for `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `.cursorrules`, `.github/copilot-instructions.md`.
- `{ skipIfExists: true }` — do nothing if the file exists. Used for hooks, rules, commands, GitHub files, `scripts/check-all.mjs`.
- `mergeSettingsJson()` — deep merge for `settings.json`: hooks union by matcher+command, permissions union arrays, other keys keep existing value.

Each call returns a `WriteResult` with `action: 'created' | 'skipped' | 'backed-up-and-replaced'`. The init command prints a summary of all results, making the effect of each run visible.

### 2. ai-rulez Coexistence Gate

If the target project already uses [ai-rulez](https://github.com/isobar-ai/ai-rulez) (detected by presence of `.ai-rulez/` or `ai-rulez.yml`), the init flow skips tool config generation entirely. `AGENTS.md` and GitHub files are still generated. This prevents arbiter from overwriting an existing, project-owned tool configuration strategy. See [ADR-010](../ADR/010-ai-rulez-coexistence.md).

### 3. Stateless Canonical, Stateful Customizable

The core asymmetry: canonical files (`AGENTS.md`, thin pointers) are stateless — they contain no project-specific customization. They are safe to regenerate. Customizable files (hooks, rules, commands) are stateful from the moment a team modifies them. The `skipIfExists` strategy respects that boundary. See [ADR-011](../ADR/011-brownfield-first-design.md) for the brownfield design rationale.

---

## Thin Pointer Pattern

Every Layer 1 tool config opens with an explicit pointer to `AGENTS.md`:

```markdown
# {project} — Claude Code Configuration

> **Governance rules are in `AGENTS.md` (canonical, AAIF standard).**
> This file adds Claude Code-specific configuration only.
```

This opening block is non-negotiable. It:

1. Tells the AI tool where the authoritative rules live.
2. Makes the layering visible to any human reading the file.
3. Prevents the tool config from being extended with governance content.

The generated `CLAUDE.md` and `CODEX.md` templates enforce this pattern. See [ADR-002](../ADR/002-thin-pointer-pattern.md) for the full rationale and the rejected alternatives.
