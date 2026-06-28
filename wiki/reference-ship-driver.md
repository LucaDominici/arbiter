---
generated: true
source: 'docs/REFERENCE/ship-driver.md'
source_sha: 'ad1644a5e94c4c94f78d3cb601bb5e5516b5e4ed'
last_updated: '2026-06-28'
---

# Reference: Ship Driver (generated)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/ship-driver.md](../docs/REFERENCE/ship-driver.md)

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
(`[A-Za-z0-9._-]`) and `harnessCmd` (`[A-Za-z0-9._/-]`) against strict allow-lists
before emission; `shipLabel` is additionally single-quoted in the template. No config
value can inject shell.

## State separation

The driver owns `supervisor.sh`, `TICK_PROMPT.md`, and `HALT`. The engine owns
`.arbiter/ship/<task-id>/attempts.json` (gitignored runtime state) — the driver never
reads or writes it.

## Self-only boundary

ADR-093 §5 locks a set of arbiter-self concerns out of every consumer-rendered driver
artifact, forever:

- **Template authoring** (CANON-04/05/13/14/18) — consumers have no `CANON.md` and no
  `src/templates/`; emitting authoring rules would be map-fiction (INV-115).
- **Matrix promotion** (CANON-02/03, INV-32, `cross-language-matrix`) — proven-cell
  promotion is an arbiter-repo workflow.
- **selfOnly invariants** (INV-107/108/111/117/120) — they govern arbiter's own SSOT,
  CLI-reference, and template-test surfaces.
- **Kit leakage** (INV-85, `kit-source`) — kit provenance never crosses into consumers.

The boundary is regression-locked by the "self-only boundary" describe in
`__tests__/templates/ship-driver-render.test.ts` (#1292): the rendered `supervisor.sh`,
`TICK_PROMPT.md`, and claude `ship.md` command are asserted free of every marker above
under a consumer render context. The dual-sided INV-114 (Stop-hook evidence) remains
allowed — only self-only markers are banned.
