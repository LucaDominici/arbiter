---
title: 'Reference: Ship Driver (generated)'
doc_version: '1.0.0'
status: active
last_review: '2026-06-11'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['088-ship-as-orchestration-entrypoint']
---

# Reference: Ship Driver (generated)

> **Target:** consumer repos (and arbiter-self, dogfooded)
> **Generator:** `src/generators/ship-driver.ts` (`ship-driver` registry key)
> **Templates:** `src/templates/ship/supervisor.sh.ejs`, `src/templates/ship/TICK_PROMPT.md.ejs`
> **Parity:** `scripts/check-self-dogfood.mjs` (`TEMPLATE_ROOTS` maps `ship/` → `.arbiter/ship/`)

## Purpose

The thin half of the dual-side ship orchestrator (ADR-093). The **driver** runs the
model-requiring steps (write code, review, diagnose a red log) and calls the **engine**
for every decision — it holds no sequencing or failure-policy logic. Emitted only when
the project's tools include `claude` (the tick prompt is harness-specific; the engine is
universal).

## Artifacts

- **`.arbiter/ship/supervisor.sh`** — stateless tick loop. One tick = one bounded
  harness run (`timeout`, `--max-turns`, `--permission-mode acceptEdits` — never
  `--dangerously-skip-permissions`). A failed/timed-out tick logs and continues; a
  GitHub API hiccup in the backlog check retries instead of killing the loop. Stops on
  `.arbiter/ship/HALT` or a confirmed empty backlog. Knobs: `MAX_TICKS`,
  `TICK_TIMEOUT`, `SHIP_TICK_SLEEP`.
- **`.arbiter/ship/TICK_PROMPT.md`** — the tick algorithm. Sequencing via
  `arbiter ship`; red-gate decisions via `arbiter ship-on-red` (engine-owned 2-strike
  memory — see [fix-on-red](fix-on-red.md)). Hard rules include: never `--no-verify`,
  never commit to main, never `--admin` or any branch-protection bypass, never modify
  the driver files.
- **`.claude/commands/ship.md`** — already emitted by the claude commands generator;
  unchanged by this generator (skipIfExists).

## Trust boundary

`TICK_PROMPT.md` is trusted input executed by an autonomous agent every tick — treat
edits to it as security-sensitive. The generator validates `shipLabel`
(`[A-Za-z0-9._-]`) and `harnessCmd` (`[A-Za-z0-9._/-]`) and the template single-quotes
substitutions, so config values cannot inject shell.

## State separation

The driver owns `supervisor.sh`, `TICK_PROMPT.md`, and `HALT`. The engine owns
`.arbiter/ship/<task-id>/attempts.json` (gitignored runtime state) — the driver never
reads or writes it.
