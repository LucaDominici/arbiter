---
title: 'ADR-021: Archetype Axis and Architecture Style Knob'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-021: Archetype Axis and Architecture Style Knob

**Status:** Accepted
**Date:** 2026-04-15
**Deciders:** Luca Dominici
**Issue:** #82

## Context

Arbiter generates governance and enforcement for target projects across five language stacks. Before this ADR, two silent assumptions distorted every generator:

**C1 — Single-project bias.** All generators implicitly assumed a `backend-web-db` topology: DB migrations were implied, public API invariants were always emitted, the SSOT_CORE_SET document listed DB and API sections unconditionally. A TypeScript CLI project or a Rust library received the same enforcement surface as a Spring Boot service, even though large portions were irrelevant.

**C2 — Invisible architecture assumption.** The Java ArchUnit template baked hexagonal (prior-art baseline) vs. layered (Archivio) rules as a compile-time constant. Choosing one style silently excluded the other. There was no way to declare "this project has no enforced architecture style" — the only option was language-level exclusion (`language !== "java"`).

Both gaps were discovered during prior-art baseline/Archivio cross-project analysis (see the alignment doc (removed)). They form the foundation blockers for Phase 9.5 milestones MB, MG, MH, MJ, and ML, all of which depend on explicit project shape to scope their enforcement.

## Decision

Introduce five orthogonal axis fields on `ProjectConfig` (required) and `ArbiterConfig` (optional, additive):

| Field               | Type                | Default     |
| ------------------- | ------------------- | ----------- |
| `archetype`         | `Archetype`         | `"library"` |
| `architectureStyle` | `ArchitectureStyle` | `"none"`    |
| `isMultiTenant`     | `boolean`           | `false`     |
| `hasDatabase`       | `boolean`           | `false`     |
| `hasPublicApi`      | `boolean`           | `false`     |

Where:

- `Archetype = "backend-web-db" | "cli" | "library" | "data-pipeline" | "frontend-spa" | "embedded"`
- `ArchitectureStyle = "hexagonal" | "layered" | "modular-monolith" | "none"`

**Gate rule (core C2 fix):** No generator emits architecture constraints unless `architectureStyle !== "none"`. Specifically, `generateArchUnit` only emits `ArchitectureTest.java` when `architectureStyle` is explicitly set to a non-none value.

**Archetype detection:** A companion function `detectArchetypeHint(dir, language, framework)` maps known framework slugs to reliable archetype hints (e.g. `spring-boot` → `backend-web-db`, `react` → `frontend-spa`). It returns `null` for languages where heuristics are unreliable (go, python, unknown); callers default to `"library"`.

**Backward compat:** Fields are required on `ProjectConfig` but optional on `ArbiterConfig`. Existing `arbiter.json` files without the axis fields load cleanly — generators use direct field access (no `??`) on `ProjectConfig`, while commands reading from stored config apply `?? "library"` / `?? "none"` / `?? false` before constructing `ProjectConfig`.

## Rationale

**Archetype is orthogonal to language.** A TypeScript CLI and a Python CLI share archetype invariants (no DB schema, no REST contract obligations) regardless of language. Encoding this in the `language` field would conflate two independent dimensions.

**ArchitectureStyle is orthogonal to archetype.** A `backend-web-db` project may use hexagonal, layered, or no enforced style. A `library` project is unlikely to enforce one at all. These are independent choices and must be declared separately.

**Capability flags are orthogonal to both.** `hasDatabase` and `hasPublicApi` are not derivable from archetype alone (a `data-pipeline` may or may not have a public API; a `backend-web-db` may skip migrations in tests). Explicit flags prevent overfitting to the most common configuration.

**Opt-in semantics replace implicit defaults.** Generators default to "off". This prevents enforcement surface from leaking into projects where it is irrelevant, which was the root cause of C1.

### Alternatives rejected

- **Encode archetype inside the `framework` string** — rejected: already overloaded (`express`, `spring-boot`, `tauri`). Framework is a technical dependency, not a topology.
- **Derive architectureStyle from framework** — rejected: multiple frameworks support multiple styles (Spring Boot works for both hexagonal and layered). This would remove the user's explicit intent.
- **Single composite `projectKind` field** — rejected: collapses four independent dimensions into one opaque string. Gates would have to string-match on values like `"backend-web-db-hexagonal-multitenant"`, producing a combinatorial explosion.
- **Per-generator config files** — rejected: increases surface, violates the single-source principle of `arbiter.json`.

## Consequences

**Positive:**

- Generators are self-documenting about which project shapes they apply to. The C2 bug (ArchUnit emitting wrong rules) is structurally impossible — the generator must be explicitly opted in.
- SSOT_CORE_SET.md documents the actual project shape: Data and API sections appear only when the corresponding capability flag is true.
- `detectArchetypeHint` provides sensible defaults for `--yes` flows without asking users of known frameworks.
- Existing `arbiter.json v0.1` files remain readable without migration — the five fields are additive and optional in storage.
- All downstream Phase 9.5 milestones (MB, MG, MH, MJ, ML) can scope their enforcement surface by inspecting the axis fields.

**Negative:**

- The wizard now asks five more questions. Mitigated by smart defaults from `detectArchetypeHint` and clear conditional defaults (`hasDatabase` defaults to true when `archetype === "backend-web-db"`).
- Any future generator must self-guard on archetype/architectureStyle. This is a conscious design constraint, not accidental friction.
