---
title: 'Experimental Tool Breadth — five generators maintained but unreachable'
doc_version: '0.1.0'
status: decided
last_review: '2026-08-30'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['src/wizard/types.ts', 'src/generators/registry.ts']
---

# Experimental Tool Breadth — five generators maintained but unreachable

> **DECIDED (2026-08-30, #2367).** All five were **retired** — generators, templates and
> tests deleted, `AiTool` narrowed to `claude | codex`. The promotion criteria that were
> missing are now written down. See
> [ADR-119](../internal/ADR/119-experimental-tool-generators-retired.md) for the recorded
> decision per tool and the rationale; the rest of this document is the design record that
> produced it.

Five tool generators are built, tested and maintained — and reachable by nobody.

## Problem statement

`AiTool` (`src/wizard/types.ts:113`) declares seven targets: `claude`, `codex`, `cursor`, `copilot`, `gemini`, `windsurf`, `aider`. The support policy above it (`:94-112`) is explicit and, on its own terms, admirable:

> SUPPORTED (customer-facing): 'claude' and 'codex' ONLY. […] EXPERIMENTAL (NOT customer-facing): […] Their generators/emitters produce config but are NOT validated against the live tool; advertising them would be an overclaim. The code is RETAINED and unit-tested for internal/experimental use, but these values are rejected by `parseTools`, hidden from the wizard, and absent from user-facing docs and `--help`.

The honesty is right. The steady state is not. Five generators (`cursor`, `copilot`, `gemini`, `windsurf`, `aider`) plus their template trees are carried in the tree, unit-tested, and rendered by the template render-test gates (CANON-04/INV-48) — while `parseTools` rejects the only values that would reach them. They are maintained code with no reachable caller, held in a holding pattern with no exit condition written down.

For comparison, the spec-driven ecosystem competes on breadth: Spec Kit advertises 30+ agent integrations. arbiter's two are deeper (gated parity via ADR-106, `check-codex-parity`, `check-codex-self-parity`) but the five in between are neither promoted nor retired — they are cost without either benefit.

This is not a request to advertise them. It is a request to **decide**, because "retained, untested against the live tool, indefinitely" is a decision that was never explicitly made.

## Chosen approach

Write the exit condition, then apply it per tool.

Define what promotion from experimental to customer-facing requires — by analogy with what `codex` already has, since that is the only worked example: a runnable adapter, empirical tests against the live tool, an emission-parity gate (the ADR-106 derive-from-Claude pattern plus `check-*-parity`), and a fixture. Then for each of the five, take one of three decisions and record it:

- **promote** — someone dogfoods it and it earns the parity gate;
- **retire** — delete the generator and its templates; the support matrix shrinks to what is true;
- **keep, with a written expiry** — retained deliberately, with a date and an owner, the way `suppressions/` entries already work under `check-suppression-expiry`.

The third option is the current state, minus the part that makes it accountable.

## Key decisions and rejected alternatives

**D1 — Do not promote anything in this issue.**
Promotion requires dogfooding against the live tool. Marking a tool customer-facing because its generator has unit tests would be exactly the overclaim `types.ts:94-112` was written to prevent, and would put a false check-mark in the comparison tables the positioning issue (#2360) is cleaning up. This issue produces the criteria and the decisions, not the promotions.

**D2 — Retirement is a legitimate and probably common answer.**
Deleting an unreachable generator is not a loss: git keeps the history, and the code can return when someone actually needs it. Carrying five unreachable generators taxes every refactor of the generator registry, every template-render sweep, and every reader trying to understand which tools are real. `check-bloat-ratchet` and CANON-16 already push this direction.

**D3 — "Keep" must carry an expiry, or it is not a decision.**
arbiter already has this pattern and enforces it: `check-suppression-expiry.mjs` and `check-todo-max-age.mjs` exist precisely because indefinite deferral rots. An experimental tool retained without a date is the same failure in a different shape.

**D4 — The criteria come from `codex`, not from first principles.**
`codex` is the only tool that has actually made the journey, so what it needed _is_ the empirical bar: ADR-106's derive-from-Claude rule, `check-codex-parity`, `check-codex-self-parity`, and the documented known-limitations table generated from the real Claude-track inventory. Inventing a fresh checklist would be theory where a worked example exists.

**D5 — Whatever is decided, the public tables must match.**
The support-matrix footnote in `website/comparisons/index.md` names the five as experimental. If any are retired, that footnote is wrong the same day. Coordinate with #2360 rather than letting a second stale claim appear.

## Open questions

- Is there real demand for any of the five? Issue history, download telemetry (there is none, by design) and user reports are the only signals — and with zero telemetry, asking is the only honest method.
- What does dogfooding a tool actually cost? The `codex` track carries two dedicated parity gates and a generated limitations table; if that is the price per tool, the answer for all five is probably retire.
- Does `gemini` deserve different treatment given it is also a candidate cross-model review provider (#2355's provider table)? Being a _review provider_ and being a _config-emission target_ are different roles, and conflating them would be a mistake.

---

## Acceptance Criteria

- [ ] AC-1: documented promotion criteria for experimental to customer-facing exist, derived from what the `codex` track actually required (runnable adapter, empirical tests against the live tool, parity gate, fixture).
- [ ] AC-2: each of `cursor`, `copilot`, `gemini`, `windsurf`, `aider` has a recorded decision — promote, retire, or keep-with-expiry — with a written rationale.
- [ ] AC-3: every `keep` decision carries an explicit expiry date and owner, in the shape `check-suppression-expiry` already enforces.
- [ ] AC-4: every `retire` decision deletes the generator, its templates and its tests, and the support-policy comment at `src/wizard/types.ts:94-112` is updated to match reality.
- [ ] AC-5: no tool is promoted to customer-facing in this issue (D1).
- [ ] AC-6: user-facing surfaces stay consistent — `--tools`, `--help`, the wizard, and the experimental footnote in `website/comparisons/index.md` all reflect the decisions, coordinated with #2360.
- [ ] AC-7: `node scripts/check-all.mjs L2` green, `check-tool-claims` and `check-bloat-ratchet` included.

## Non-Goals

- No promotion of any tool to customer-facing.
- No new tool targets added.
- No change to the `claude` or `codex` tracks, to ADR-106, or to the parity gates.
- No re-litigation of the support policy itself — the policy is right; only the indefinite holding pattern is at issue.

## Files / contracts touched

- `src/wizard/types.ts` — the support-policy comment and, if anything is retired, the `AiTool` union
- `src/generators/cursor.ts`, `copilot.ts`, `gemini.ts`, `windsurf.ts`, `aider.ts` plus their `src/templates/` trees — per decision
- `src/generators/registry.ts` — registry entries for anything retired
- `__tests__/` — generator and render tests for anything retired (INV-48/INV-49)
- `website/comparisons/index.md` — the experimental footnote (coordinate with #2360)
- `docs/internal/ADR/` — the recorded decisions, if treated as architectural
- Contract: `AiTool` is an exported type — retiring a member is a public type change and needs a semver note

## Wave placement

Lane **H (tool surface)**, standalone. Touches `website/comparisons/index.md`, which #2360 also touches — `conflicts-with:#2360`; serial with it, or coordinate the footnote edit into #2360 and drop the overlap.
