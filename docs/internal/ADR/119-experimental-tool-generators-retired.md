---
title: 'ADR-119: Experimental tool generators — promotion criteria, and retire all five'
doc_version: '1.0.0'
status: active
last_review: '2026-08-30'
owner: ''
canonical_id: '119'
tags: ['audience/dev', 'kind/adr']
related:
  [
    'docs/internal/ADR/095-supported-ai-tools-claude-codex.md',
    'docs/internal/ADR/106-codex-track-parity-contract.md',
  ]
---

# ADR-119: Experimental tool generators — promotion criteria, and retire all five

**Project:** arbiter
**Date:** 2026-08-30
**Status:** Accepted
**Supersedes:** N/A (completes ADR-095)

## Context

ADR-095 narrowed the advertised AI-tool surface to `claude` and `codex` and marked the
other five (`cursor`, `copilot`, `gemini`, `windsurf`, `aider`) **experimental**: their
generators and templates were RETAINED and unit-tested, but `parseTools` rejected the
only values that could reach them. ADR-095's own "Negative" section named the hazard it
was creating: _"the retained-but-unadvertised generators are now partially dead from the
product's point of view; they must be either revived (with verification) or eventually
removed if they bit-rot."_ Nobody wrote the exit condition, so the holding pattern became
the steady state.

arbiter's own practice says indefinite deferral is a failure mode, not a neutral choice —
that is why `check-suppression-expiry.mjs` and `check-todo-max-age.mjs` exist. A
retained-forever experimental tool is the same failure in a different shape (#2367 D3).

The cost was never zero. Five generators plus five template trees were carried through
every generator-registry refactor, every template render-test sweep (CANON-04 / INV-48),
the duplication and bloat ratchets, and every reader trying to work out which tools are
real. The benefit was exactly zero: `parseTools` (`src/commands/init/resolve-config.ts`)
rejects the five with `E_INVALID_TOOL`, `configure --set tools=` validates against
`SUPPORTED_AI_TOOLS`, and the wizard's `TOOL_OPTIONS` never offered them — so no user
could reach the code by any supported path.

### Demand evidence (or the absence of it)

arbiter ships **zero telemetry, by design**, so downloads and usage cannot be counted and
never will be. That leaves issue history and user reports as the only honest signals. A
search of this repository's issues for a request to support any of the five returns
nothing: the only issues naming them are the ones that _narrowed_ the surface (#2367 and
ADR-095's own work), not requests to widen it. `docs/REFERENCE/AGENT_RULES.md` records
that the sibling surface — the multi-tool `agent-rules export` command and its
`cursor`/`copilot`/`aider`/`windsurf` emitters — was already cut, and that removal
produced no request to restore it. Absent any demand signal, the burden of proof sits with
retention, not with removal (#2367 D2).

## Decision

Two things: write the exit condition, then apply it.

### 1. Promotion criteria (experimental → customer-facing)

Derived from what the `codex` track actually required, because it is the only tool that
has made the journey; inventing a fresh checklist would be theory where a worked example
exists (#2367 D4). A tool becomes customer-facing only when **all four** hold:

1. **A runnable adapter.** Not a static config emitter — an adapter the project can
   actually invoke, as `codex-adapter` is.
2. **Empirical tests against the live tool.** `__tests__/hooks/empirical/` runs the real
   binary. Structural unit tests asserting "the generator wrote the file we told it to
   write" are explicitly **not** sufficient — that is exactly the evidence the five
   already had, and it proved nothing about the tool.
3. **An emission-parity gate.** The ADR-106 derive-from-Claude rule plus a
   `check-<tool>-parity` gate, and — where the tool also governs this repo — a
   `check-<tool>-self-parity` gate. `check-codex-parity` and `check-codex-self-parity`
   are the shape.
4. **A fixture**, plus a documented known-limitations table generated from the real
   Claude-track inventory (as `codex-known-limitations` does), so the gap between the
   tool and the Claude track is stated rather than implied.

A tool that meets fewer than four is not "nearly supported"; it is unsupported. Promotion
is the **only** way a member returns to `AiTool` — re-adding a generator with unit tests
does not qualify, and is the precise overclaim ADR-095 was written to prevent.

**If a future tool is instead KEPT as experimental**, the keep must carry an expiry and an
owner in the shape `check-suppression-expiry` already enforces — an explicit `owner:` plus
an `expires:` ISO date no more than 365 days out, recorded here and re-decided on that
date. An experimental tool retained without a date is not a decision (#2367 D3). No tool
is kept under this ADR, so no expiry entry exists today.

### 2. The five decisions

No tool is promoted in this ADR (#2367 D1 / AC-5): promotion requires dogfooding against
the live tool, and none has been done.

| Tool       | Decision   | Rationale                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cursor`   | **RETIRE** | Unreachable via every supported path and never validated against the live editor. It emitted a single static `.cursorrules` pointer with no adapter, so it satisfied 0 of the 4 criteria above and had no partial progress to preserve. No demand signal in issue history. Git history is the archive if it is ever dogfooded. |
| `copilot`  | **RETIRE** | Same standing: one static `.github/copilot-instructions.md` pointer, no adapter, no live-tool test, 0 of 4 criteria, no demand signal. Copilot also reads `AGENTS.md`, which arbiter still emits as the canonical governance file — so what a Copilot user actually relies on is unaffected by the generator's removal.        |
| `gemini`   | **RETIRE** | Same standing as the others _as a config-emission target_. Its candidacy as a **cross-model review provider** (#2355/#2356) is a **different role** and is untouched by this decision — see §Gemini below.                                                                                                                     |
| `windsurf` | **RETIRE** | Same standing: one static `windsurf-instructions.md` pointer, no adapter, no live-tool test, 0 of 4 criteria, no demand signal.                                                                                                                                                                                                |
| `aider`    | **RETIRE** | Same standing, and the sharpest case for removal: `.aider.conf.yml` was the closest of the five to real tool configuration (it set `auto-commits`/`dirty-commits` and a `read:` list), which makes shipping it unverified the most harmful — wrong settings misconfigure a user's tool rather than merely failing to help.     |

### Gemini: two roles, one name

Being a **review provider** and being a **config-emission target** are different roles, and
conflating them would be a mistake (#2367, open question 3). They share no code:

- The _config-emission_ role was `src/generators/gemini.ts` + `src/templates/gemini/` —
  writing a `.gemini/GEMINI.md` pointer into a user's repo. That is what is retired here.
- The _review-provider_ role is `src/integrations/external-review.ts`, driven by
  `CrossModelReviewProvider` in `src/wizard/types.ts`, which is `'codex'` only. It invokes
  an external CLI to review a diff and returns an agent-return envelope. It never reads or
  writes `GEMINI.md`.

Retiring the generator therefore costs the provider track nothing: a future `gemini`
review provider adds a member to `CrossModelReviewProvider` and an adapter branch in
`external-review.ts`, and would neither want nor use a resurrected config emitter. Keeping
a dead emitter "because gemini might matter later" would have been keeping the wrong
artifact for the right reason.

### What retirement removes — and what it deliberately does not

Removed: the five generators, `src/generators/agent-file.ts` (the shared factory whose only
callers were those five — retiring them and keeping it would leave a dead abstraction), the
five template trees, and all of their generator/template/tool tests. The `AiTool` union,
`SUPPORTED_AI_TOOLS`, `AI_TOOLS` (`src/config/schema.ts`), the recipe `AiToolSchema`, the
`GeneratorKey` union and the interactive-configure list all narrow to `claude | codex` — so
the advertised set, the emittable set and the type are finally the same set.

**Kept deliberately:** brownfield _detection_ of `.gemini/`, `windsurf-instructions.md` and
`.aider.conf.yml` (`src/detectors/existing.ts`, `determineFlow`, and the matching i18n
lines). Detection is not emission. Under ADR-011 (brownfield-first) arbiter must still
notice that a repo is already AI-assisted so it backs those files up rather than clobbering
them — a guarantee that is _more_ valuable, not less, once arbiter no longer writes them
itself.

## Consequences

### Positive

- The holding pattern ends with a written decision instead of drift. Every reader of
  `AiTool` now sees exactly the tools that exist.
- Unreachable source and templates plus fourteen test files leave the tree; the
  duplication, bloat and dead-code ratchets all move down (an improvement — the improved
  floors stay where they land, they are not re-pinned upward).
- Every future generator-registry refactor, template render sweep and CANON-04 audit gets
  five fewer unreachable subjects.
- The promotion criteria above are now the single, written gate for any tool's return, so
  the next such request is decided by evidence rather than by argument.

### Negative

- **Public type change.** `AiTool` is exported; narrowing it is breaking for any consumer
  that referenced a retired member. Recorded in `docs/SEMVER.md` and in a `minor`
  changeset (pre-1.0: a breaking change bumps the minor).
- An existing `arbiter.json` naming a retired tool no longer validates. It is **not**
  bricked: `sanitizeCoercibleFields` filters unknown `tools` entries and falls back to
  `['claude','codex']` with a report line (ADR-105 never-brick), so such a config is
  coerced on the next read rather than rejected.
- Anyone who was using an experimental generator through an unsupported path loses it.
  The mitigation is the one D2 relies on: git history holds the code, and the promotion
  criteria describe exactly what it would take to bring it back properly.

## Links

- Related ADRs: ADR-095 (supported AI tools), ADR-106 (codex track parity contract),
  ADR-105 (never-brick config migration), ADR-011 (brownfield-first design)
- Issues: #2367, #2360 (positioning/comparison tables), #2355/#2356 (cross-model review)
- Design doc: `docs/design/experimental-tool-breadth.md`
- Surfaces: `src/wizard/types.ts` (`AiTool`, `SUPPORTED_AI_TOOLS`), `src/config/schema.ts`
  (`AI_TOOLS`), `src/generators/registry.ts`, `website/comparisons/index.md`,
  `website/reference/cli.md`, `docs/SEMVER.md`
