---
generated: true
source: 'docs/REFERENCE/impact.md'
source_sha: 'a2b6499838fd22da91b3fdff5ff0f5fb491de286'
last_updated: '2026-06-15'
---

# Reference: Impact (/impact)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/impact.md](../docs/REFERENCE/impact.md)

# Reference: Impact (/impact)

> **Target:** consumer repos (and arbiter-self, dogfooded)
> **Skill:** `.claude/skills/impact/SKILL.md`
> **Command:** `.claude/commands/impact.md`
> **Templates:** `src/templates/claude/skills/impact/SKILL.md.ejs`, `src/templates/claude/commands/impact.md.ejs`
> **Wiring:** `src/generators/skills.ts` (`SKILL_NAMES`), `src/generators/claude.ts` (commands), `src/compatibility/skills-validator.ts`

## Purpose

`/impact <symbol-or-file>` reports the **blast radius** of a change — its upstream and
downstream dependents — before you touch it. It is the analysis sibling of `/ship`: scope a
change before planning, and validate in the plan/red-team phases that the plan reaches
everything the change actually affects.

## Opt-in, graph-first (never required)

arbiter mandates no graph tool. The skill is **graph-first when a graph is available**: if the
optional `graphify` CLI is installed and a `graphify-out/graph.json` exists and is fresh, the
skill queries the graph — deterministic, no-LLM, and far cheaper than grep-and-read for
"who depends on X". When graphify is absent, or a symbol is not in the graph, it **falls back to
ripgrep**. No gate, plan, or `/ship` phase may _require_ graphify; absence degrades gracefully,
never errors.

| Phase     | Behavior                                                                     |
| --------- | ---------------------------------------------------------------------------- |
| Detect    | `command -v graphify` AND `graphify-out/graph.json` present → graph path     |
| Freshness | build-commit == HEAD AND clean tree, else `graphify update .` (no-LLM) first |
| Query     | `graphify explain <symbol>` (dependents) / `graphify path <A> <B>` (chain)   |
| Trust     | `EXTRACTED` edges reliable; `INFERRED` edges flagged for manual confirmation |
| Fallback  | `rg -nw <symbol>` excluding `dist/`, `node_modules/`                         |

## Enabling the graph (opt-in)

Install the `graphify` CLI (a `uv tool`) and build the graph once with `graphify update .`. The
`graphify-out/` directory is a derived artifact (git-ignored); rebuild it whenever it goes
stale. With no graphify installed, `/impact` still works via ripgrep — you just pay more tokens.

## Relationship to /ship

`/ship` drives an issue to a merged PR. Use `/impact` to scope the change beforehand and, within
`/ship`'s plan and red-team phases, to confirm the plan covers the full blast radius. `/impact`
itself only analyzes — it never edits.
