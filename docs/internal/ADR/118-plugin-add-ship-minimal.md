---
title: 'ADR-118: `arbiter plugin add`/`list` — Ship the Minimal Command, No Scaffolder'
doc_version: '1.0.0'
status: active
last_review: '2026-08-30'
owner: ''
canonical_id: '118'
tags: ['audience/dev', 'kind/adr']
related: ['docs/internal/ADR/031-plugin-api-v1.md']
---

# ADR-118: `arbiter plugin add`/`list` — Ship the Minimal Command, No Scaffolder

**Project:** arbiter
**Date:** 2026-08-30
**Status:** Accepted
**Supersedes:** N/A (extends ADR-031)

## Context

ADR-031 designed a `arbiter plugin add | remove | list` CLI subcommand alongside the Plugin
API v1, but the subcommand was never registered in `src/cli.ts` — only the loader, types, and
config field shipped. Three public docs (`website/recipes/plugin.md`,
`website/recipes/custom-invariant.md`, `examples/plugins/spring-boot/README.md`) and
`CONTRIBUTING.md` kept instructing users to run `arbiter plugin add <name>` and described it as
a scaffolder that creates `index.js`/`package.json`/`templates/` — a command and a behavior
that both did not exist. `src/cli.ts:298` already reserved `plugin` in the nested-subcommand
parser; `src/i18n/en.json` already carried a full `cli.plugin.*` string catalog (including
scaffolder-era keys like `scaffolded`/`cd_hint`); `config.ts`'s own doc comment already listed
`plugin` among the commands expected to acquire `.arbiter/.lock`. The command was designed,
partially scaffolded in supporting files, and never finished.

## Decision

Ship a minimal `arbiter plugin add <package>` and `arbiter plugin list` — **no scaffolder**
(`plugin init`/`plugin add`'s old "creates a project skeleton" behavior is dropped) and **no
`remove`** (nothing in the current doc surface promises it, and ADR-031's `remove` design is
deferred, not built, until something actually needs it).

- `plugin add <package>` classifies the argument as a local path (Node's own bare-specifier-vs-
  path convention: a `.`/`/` prefix is a path) or an npm package name. A local path is validated
  and registered as-is — no install step. An npm name is installed as a devDependency via the
  package manager `src/detectors/package-manager.ts` already detects (`--no-install` skips this).
  Either way, the package is validated through the same `src/utils/plugin-loader.ts` `arbiter
update` uses — **before** `arbiter.json` is touched, so a plugin that fails to load never gets
  persisted. `plugins[]` is kept sorted and de-duplicated (idempotent re-add).
- `plugin list` loads every configured entry the same way and reports `loaded` / `not found` /
  `error` per plugin.
- The public website recipes are rewritten from "Scaffold" (a `## Scaffold` heading promising
  generated files) to "Layout" (a hand-authored package structure, then `arbiter plugin add` to
  register it) — because generating plugin skeletons is not a product promise arbiter wants to
  maintain: a plugin is a normal npm package with one JSON contract to satisfy, and a generator
  for that is speculative scaffolding for a shape simple enough to hand-write once per plugin.
- `plugins[]` sorting is a deliberate, minor departure from ADR-031's original "run in declared
  array order" framing: order was never load-bearing for the shipped `runPlugins` (first-writer-
  wins file conflicts, independent `generate()` calls), and a sorted array is diff-stable and
  trivially idempotent to append to. Only configs touched by `plugin add` are ever re-sorted; a
  hand-edited `plugins[]` with meaningful order is left alone until `plugin add` runs against it.

## Consequences

### Positive

- Closes a live phantom-command defect on the public website (users following the documented
  recipe hit a non-existent command) with the command those docs already promised, not a
  doc-only retreat.
- No new command-adjacent infrastructure: `plugin.ts` composes `plugin-loader.ts`,
  `package-manager.ts`, and `config.ts` verbatim — the survey behind this ADR found every piece
  needed already existed except the command module itself.
- Validate-before-persist means `arbiter.json` can never accumulate an unresolvable plugin entry
  through `plugin add` (a pre-existing risk for hand-edited `plugins[]` entries, unchanged here).

### Negative

- The scaffolder-era i18n keys (`scaffolded`, `cd_hint`, `npm_install`, `npm_build`) and the
  `remove`-era keys (`removing`, `removed`, `removed_msg`, `not_found`) are left in
  `src/i18n/en.json`, unused, rather than deleted — they are pre-existing, not part of this
  diff, and deleting unrelated dead code inside a scoped change is out of policy here. A future
  `plugin remove` or a locale cleanup pass can pick them up.
- `plugins[]` sort order is now a side effect of running `plugin add`, which a project relying on
  ADR-031's original declared-order framing (nothing in the shipped code ever actually depended
  on it) would need to know about.

## Alternatives rejected

- **Ship the scaffolder too (`plugin init` generates `index.js`/`package.json`/`templates/`).**
  Rejected: the product decision behind this issue is explicit — generating plugin skeletons is
  not a maintenance commitment arbiter wants (template drift as the `ArbiterPlugin` contract
  evolves, a second EJS surface for one three-file skeleton). The recipe's manual-layout section
  is one code fence; a generator is a template, a test, and a compatibility promise.
- **Delete the phantom-command recipes/promise instead of shipping.** Rejected by the issue's own
  framing: the command was designed (ADR-031), partially wired (loader, config field, i18n
  catalog, reserved CLI name), and consumers were told to run it — deleting the promise abandons
  work that already exists rather than finishing it.
- **Ship `remove` alongside `add`/`list` for ADR-031 parity.** Rejected: no doc in scope cites
  `plugin remove`, and hand-editing `arbiter.json`'s `plugins[]` array already covers removal
  with zero new code. Building it now would be speculative completeness, not a fix for a
  documented gap.

## Links

- Related ADR: ADR-031 (Plugin API v1 — original `add | remove | list` design)
- Issue: #2416
