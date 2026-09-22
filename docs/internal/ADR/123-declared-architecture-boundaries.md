---
title: 'ADR-123: Declared architecture components/deny in arbiter.json'
doc_version: '1.0.0'
status: active
last_review: '2026-09-22'
owner: ''
canonical_id: '123'
enforces: ['INV-150']
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-123: Declared architecture components/deny in arbiter.json

**Project:** arbiter
**Date:** 2026-09-22
**Status:** Accepted — scoped to what is enforced today: the `architecture` config
section validates on load (INV-150) and renders into `eslint.config.boundaries.mjs`.
The gate itself stays `soft: true` until the follow-up ADR removes it (see Decision) —
that follow-up will need its own `enforces:` claim once it lands.

## Context

The `*-boundaries` generators (`src/generators/{boundaries,rust-boundaries,go-boundaries,
python-boundaries}.ts`) already emit a cross-language forbidden-import gate
(`scripts/check-boundaries.mjs`) delegating to each language's native toolchain
(eslint-plugin-boundaries, import-linter, ruff, clippy). But the TS/eslint generator
hardcodes a fixed 4-layer hexagonal shape — `domain`/`application`/`adapters`/
`infrastructure` — directly in `src/templates/boundaries/eslint.config.boundaries.mjs.ejs`,
and only activates when `architectureStyle === 'hexagonal'`. A project with real
components (`api`, `billing`, `search`) had no way to declare what it actually looks like.

A companion tool (`forma`) built a different answer to "does the architecture drift from
the code" — a file-count diff between a hand-authored model and `src/`. Run against real
repos it failed on "you added a file", with a suggested fix of "regenerate the model". A
gate whose remedy is "regenerate to match" is a checksum, not a gate: it never caught a
forbidden relationship and it never shipped in any fleet CI. The lesson taken from that:
declaring more file structure is not the missing piece; declaring **permitted
relationships between components you name yourself** is.

## Decision

Add an optional `architecture` section to `arbiter.json`:

```json
"architecture": {
  "components": { "api": ["src/api/**"], "core": ["src/core/**"], "db": ["src/db/**"] },
  "deny": ["db -> api", "core -> *"]
}
```

- `components`: name -> glob patterns. Any component may be declared; there is no fixed
  vocabulary.
- `deny`: forbidden edges as `"from -> to"` strings; `to` may be `*` to forbid a component
  from importing any other declared component. An edge not listed is allowed by default —
  declaring a component is never itself a violation.

When present, `src/generators/boundaries.ts` (TS/eslint) renders these components/deny
into `eslint.config.boundaries.mjs` in place of the fixed hexagonal layers, and the
generator's internal `architectureStyle !== 'hexagonal'` gate is relaxed so a declared
architecture is not conditioned on opting into the hexagonal style. When absent, output is
byte-identical to today.

**Explicitly deferred to a follow-up ADR:** removing `soft: true` from the `ts-boundaries`
entry in `src/templates/scripts/gate-registry.yml.ejs` so the gate actually fails CI. That
file has 14 worktrees stacked on the #2773 lineage at the time of this decision; this ADR
covers the declaration only. Until the follow-up lands, the gate is advisory.

Also deferred: Rust/Go/Python declared-architecture support, `allow`/stale-edge detection,
per-component `sealed` (import-from-outside-declared-globs) enforcement.

**Invariant added:** adding a file to a declared component's glob is never itself a
violation. Only an import along a `deny`-listed edge is. No file-count check is introduced
by this config section, on principle — see Context.

## Consequences

### Positive

- A repo with a non-hexagonal shape can declare its own components and get the same
  cross-language deny-edge gate hexagonal repos already have.
- Zero new runtime dependency: the TS/eslint path already shells the emitted script to
  `npx eslint`; declared architecture only changes what gets rendered into the eslint
  flat-config, not how the gate itself runs.
- Absent-section behavior is byte-identical, so no round-trip regression for existing
  hexagonal repos.

### Negative

- Ships advisory (`soft: true` unchanged) until the follow-up ADR lands — a declared
  architecture with `deny` edges does not yet fail anyone's CI on its own.
- Only the TS/eslint generator is updated in this slice; Rust/Go/Python `*-boundaries`
  generators keep their existing hexagonal-only behavior.
- The legacy `.eslintrc-boundaries.cjs` (retained for non-flat-config tooling, not read by
  the gate itself) is intentionally left on the hardcoded hexagonal shape — updating a file
  the gate doesn't consume was out of scope.

## Links

- Related ADRs: none yet (follow-up ADR pending for the `soft: true` removal)
- Issues: #2834
