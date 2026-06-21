---
name: gold-audit
description: Use when the user wants to measure how close the project is to gold-standard quality — runs the deterministic `arbiter gold-audit` engine and reports the level band plus a prioritized list of what is missing. Read-only; never changes code.
title: 'Gold Audit (measure)'
doc_version: '1.0.0'
status: active
last_review: '2026-06-16'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/analysis']
related: ['ship', 'gap']
---

# Gold Audit (measure)

**Goal:** tell the user where the project sits against the gold-standard registry —
its level band (`L0`–`L3`), its score, and a prioritized "what's missing" list — so
they know exactly what to close next.

**Read-only.** This skill MEASURES; it never changes a single file. It runs the
existing deterministic engine and presents the result. It does NOT re-score, re-rank,
or "estimate" anything with the model — the verdicts come straight from the engine.

---

## Step 1 — Run the engine

```bash
npx @arbiter/cli gold-audit --json
```

The CLI auto-detects the project's brownfield class and degrades gracefully when no
registry is installed. Capture stdout as the payload.

---

## Step 2 — Handle the graceful fallback

The engine prints a non-JSON SKIP line (it does not start with `{`) when there is no
registry/engine installed. In that case do NOT invent a score. Tell the user the
gold registry isn't wired up yet and point them at:

```bash
npx @arbiter/cli init    # new project — sets up the registry + gates
npx @arbiter/cli update  # existing arbiter project — refreshes the generated kit
```

Then stop.

---

## Step 3 — Read the payload verbatim

When stdout is JSON, parse it and read these fields **as-is** (no re-scoring):

| Field                                   | Use                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `level.level`                           | Current band: `L0` / `L1` / `L2` / `L3`                                             |
| `level.nextLevel` / `level.toNextLevel` | Next band + how many points away                                                    |
| `level.brownfieldClass`                 | The detected class the band is keyed to                                             |
| `score`                                 | Overall score                                                                       |
| `yCount` / `totals.checks`              | Checks fully satisfied vs total                                                     |
| `riskyCount`                            | Count of risky (N/P on high-risk) checks                                            |
| `checks[]`                              | Per-check `id` / `dimension` / `title` / `type` / `verdict` / `weight` / `evidence` |
| `gaps[]`                                | The "what's missing" families: N/P checks grouped by `dimension`                    |

---

## Step 4 — Present the level band + prioritized gaps

Lead with the band, then the gap list grouped by family (`dimension`):

1. **Level line** — `<level> (<brownfieldClass>) · score <score> · <toNextLevel> to <nextLevel> · Y <yCount>/<totals.checks> · RISKY <riskyCount>`.
2. **What's missing** — iterate `gaps[]`. For each `dimension` family, list its N/P
   checks as `<verdict> <id> <title>` with the `evidence.file`/`evidence.detail` when
   present. These are the concrete, deterministic next actions.
3. If `gaps[]` is empty, report that every applicable check is `Y`.

Prioritize the families with the most `N` (missing entirely) and highest-risk checks
first — but the ordering reflects the engine's verdicts, not a model opinion.

---

## Hard rules

- **Deterministic, no AI scoring.** Same repo + same registry ⇒ identical output. The
  level and every verdict come from the engine payload; never substitute a guess.
- **Read-only.** Measure and report. Closing a gap is a separate, explicit action —
  this skill never edits code, config, or docs.
- **Graceful when absent.** No registry ⇒ point at `arbiter init` / `arbiter update`,
  never a fabricated score.
