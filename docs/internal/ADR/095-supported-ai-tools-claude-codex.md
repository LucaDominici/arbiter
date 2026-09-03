---
title: 'ADR-095: Supported AI tools — claude + codex; rest experimental'
doc_version: '1.0.0'
status: active
last_review: '2026-06-13'
owner: ''
canonical_id: '095'
tags: ['audience/dev', 'kind/adr']
related: ['001-agents-md-canonical', '010-ai-rulez-coexistence']
---

# ADR-095: Supported AI tools — claude + codex; rest experimental

**Project:** arbiter
**Date:** 2026-06-13
**Status:** Accepted

## Context

arbiter can target seven AI coding tools. The `init --tools` surface accepted
`claude, codex, cursor, copilot, gemini, windsurf, aider`, and the
`agent-rules export --target` surface (#265) accepted `claude, cursor, copilot,
aider, windsurf`. The wizard, `--help`, the generated `configure` skill, the
README, and the reference docs all advertised these tools as if equally
supported.

They are not. Only two are exercised end-to-end:

- **claude** — dogfooded daily (this repo and generated consumers are driven by
  Claude Code; the gate, hooks, and evidence harness are used continuously).
- **codex** — wired through `init --tools` with a runnable adapter
  (`codex-adapter`) that has empirical tests (`__tests__/hooks/empirical/`).

The other five emit configuration or a static rules file and have **structural**
unit tests (the generator/emitter produces the expected file), but no run is
ever validated against the live tool — nobody on this project uses Cursor,
Copilot, Gemini CLI, Windsurf, or Aider. Advertising them at parity is an
**overclaim**: the first user who tries one and hits a rough edge erodes trust in
the whole product. Note that arbiter's actual _enforcement_ is tool-agnostic —
the gate runs as a git hook and in CI regardless of which tool (or human) wrote
the code — so narrowing the advertised tool list costs no enforcement guarantee;
it only makes the claimed surface honest.

## Decision

Advertise only what is verified. **Supported, customer-facing AI tools = `claude`
and `codex`.** The remaining five (`cursor`, `copilot`, `gemini`, `windsurf`,
`aider`) are **experimental**: their code is retained and unit-tested, but they
are removed from every customer-facing surface.

1. **Canonical policy** lives as a comment on the `AiTool` type
   (`src/wizard/types.ts`). Every other site references it.
2. **Input surface narrowed.** `parseTools` (`src/commands/init.ts`) accepts only
   `claude, codex` — experimental values raise `E_INVALID_TOOL`, whose message
   lists the supported set verbatim. The wizard's `TOOL_OPTIONS`
   (`src/wizard/prompts.ts`) offers only the two. `--tools` and
   `agent-rules --target` help strings, and the generated `configure` SKILL.md,
   advertise only the supported set.
3. **Code retained, marked.** Each experimental generator
   (`src/generators/{cursor,copilot,gemini,windsurf,aider}.ts`) and the
   `agent-rules` target registry (`src/agent-rules/targets.ts`) carry an
   `EXPERIMENTAL — not customer-facing` header. The generators and emitters keep
   their tests; they remain reachable internally, just unadvertised.
4. **Docs aligned.** README and `docs/REFERENCE/AGENT_RULES.md` mark the extra
   tools experimental rather than supported.

No new exported symbols are introduced (the `publicApiSurface` debt ratchet is a
hard floor); the policy is expressed via local constants and comments.

## Consequences

### Positive

- The advertised surface matches the verified surface — no overclaim, no
  "figura di merda" when someone tries an unsupported tool.
- A clear, single re-exposure gate: a tool returns to the supported list only
  after end-to-end verification against the live tool (codex is the worked
  example — adapter + empirical tests).
- Zero enforcement loss: the gate/hooks/CI guarantee is tool-agnostic.

### Negative

- `agent-rules export` for cursor/copilot/aider/windsurf still works but is no
  longer discoverable from `--help`; an experimental user must read the policy.
- The retained-but-unadvertised generators are now partially dead from the
  product's point of view; they must be either revived (with verification) or
  eventually removed if they bit-rot.

## Links

- Related ADRs: ADR-001 (AGENTS.md canonical), ADR-010 (ai-rulez coexistence)
- Surfaces: `src/wizard/types.ts` (policy), `src/commands/init.ts` (`parseTools`),
  `src/wizard/prompts.ts` (`TOOL_OPTIONS`), `src/cli.ts` (help), `src/agent-rules/targets.ts`,
  `src/templates/claude/skills/configure/SKILL.md.ejs`, `README.md`,
  `docs/REFERENCE/AGENT_RULES.md`
