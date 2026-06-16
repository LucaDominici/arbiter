---
description: Raise the project's gold level honestly — gold-audit → remediation wave → close each gap for real → re-audit behind the no-regress ratchet + anti-fake-green guards (skill:levelup)
argument-hint: '[--target L0|L1|L2|L3] [--max-waves N]'
title: '/levelup'
doc_version: '1.0.0'
status: active
last_review: '2026-06-16'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/orchestration']
related: ['gold-audit', 'close-gold-gap', 'drain']
---

# /levelup

`/levelup --target gold` raises this project's gold-audit **level band** toward the target by
closing **real** gaps. It loads and executes the **`levelup`** skill. You are the orchestrator:
you measure, compose a remediation wave, close each gap honestly, and re-audit — you never
invent a score and never fake a green.

It composes the engines that already exist — there is **no new TS engine** and **no new
`arbiter` CLI verb**:

- `/gold-audit` (`arbiter gold-audit --json`) — measure the band + prioritized gaps.
- `/close-gold-gap <gapId>` (`arbiter close-gold-gap`) — the honest recipe per gap.
- `arbiter gold-audit --check` — the no-regress ratchet that locks each gain.
- `scripts/check-all.mjs` — the disarm-proof anti-fake-green aggregate.

## Defaults

| Flag              | Default | Meaning                                              |
| ----------------- | ------- | ---------------------------------------------------- |
| `--target L0..L3` | `L3`    | The level band to reach (`L3` = the gold standard)   |
| `--max-waves N`   | 5       | Cap on remediation waves before reporting + stopping |

## The loop (per wave)

1. **Measure** — `npx arbiter gold-audit --json`; read the band + `gaps[]` (no AI re-scoring).
2. **Compose** a remediation wave from the gaps, prioritized by risk + ratchet value +
   closeability (code-closeable gaps ahead of `manual`/`process` gaps).
3. **Close** each gap honestly via `/close-gold-gap` — doc-set (fill real content), test
   (TDD-first), config (wire the real tool). A `manual` check or external blocker → needs-human.
4. **Re-audit behind the guards (fail-closed):** `npx arbiter gold-audit --check`
   (no-regress ratchet) + `node scripts/check-all.mjs` (disarm-proof).
5. Commit the new `.gold-audit-baseline.json` only when the band rose **for a real reason**;
   repeat to `--target` (or until every remaining gap is needs-human).

## Hard stops (fail-closed)

- `gold-audit --check` exit 1 (regress) → REJECT the wave, revert the cheat, re-do real work.
- `check-all.mjs` exit 1 (hard fail) or exit 2 (a broken/disarmed guard) → HALT —
  you cannot disarm a guard by breaking it.
- A gap that can't be closed honestly → `needs-human` with a blocker reason. **Never** faked,
  suppressed, or marker-stuffed.

## Final report

before → after band + score; gaps closed (with evidence); gaps needs-human (with reason);
ratchet verification (the committed baseline + the `--check` exit-0 that locks the gain).

> See the **`levelup`** skill for the full phase contract and anti-fake-green rules.
