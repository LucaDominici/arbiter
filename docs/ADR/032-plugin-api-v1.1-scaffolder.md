---
title: 'ADR-032: Plugin API v1.1 — Scaffolder and Memory Interface'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-032: Plugin API v1.1 — Scaffolder and Memory Interface

**Date:** 2026-05-13
**Status:** Accepted
**Extends:** ADR-031 (Plugin API v1)

---

## Context

ADR-031 shipped the Plugin API v1 with `arbiter plugin add | remove | list` commands and the `ArbiterPlugin` interface. Two gaps were explicitly deferred to v1.1:

1. **No scaffolder** — developers had to manually create the package structure (package.json, tsconfig.json, src/index.ts, templates/) and make sure it conformed to the `ArbiterPlugin` shape.
2. **No memory interface** — plugins that needed to persist context (e.g. for AI-assisted workflows with long-running memory) had no standard contract for doing so.

---

## Decision

### E1: `arbiter plugin init <name>` scaffolder

Introduce `arbiter plugin init <name>` that scaffolds a buildable plugin package at `./arbiter-plugin-<name>/`.

Generated structure:

```
arbiter-plugin-<name>/
  package.json          # name, main: dist/index.js, types: dist/index.d.ts
  tsconfig.json         # NodeNext, strict, types: [node]
  src/
    index.ts            # ArbiterPlugin implementation stub
    __tests__/
      plugin.test.ts    # Render test scaffold
  templates/
    .gitkeep            # Placeholder — plugins own their templateRoot
```

**Idempotency:** If the target directory already exists, files that are already present are skipped. This allows re-running `plugin init` without overwriting customizations.

**Implementation:** `runPluginInit` in `src/commands/plugin.ts`. Content generation is split into pure builder functions (`buildPluginPackageJson`, `buildPluginIndexTs`, `buildPluginTsconfig`, `buildPluginTestTs`) to keep the command function under the 100-line complexity ceiling (INV-05, ESLint `max-lines-per-function`).

### E2: `ArbiterMemoryPlugin` interface

Introduce a minimal memory interface in `src/types/memory.ts`:

```typescript
export interface ArbiterMemoryPlugin {
  store(key: string, value: unknown): Promise<void>
  retrieve(key: string): Promise<unknown>
  search(query: string): Promise<Array<{ key: string; value: unknown }>>
}
```

**Integration:** `PluginContext` gains an optional `memory?: ArbiterMemoryPlugin` field. This allows plugins to use memory without requiring it — the field is injected by the host only when a memory plugin is configured.

**Isolation:** `ArbiterMemoryPlugin` is plugin-only. Core modules (`src/generators/`, `src/commands/`) must not import it. This is enforced by a test in `__tests__/types/memory.test.ts`.

**Example adapter:** `examples/plugins/claude-mem/index.ts` provides a reference stub implementation using an in-process Map.

---

## Rationale

### Scaffolder design

Inline templates (string arrays joined with `\n`) rather than EJS files. The generated content is short and stable; introducing an EJS template for a one-off scaffolding command would add template test obligations (INV-48) with no benefit. The builder functions are pure and unit-testable without filesystem setup.

### Memory interface minimalism

Three methods cover the use cases:

- `store` — write
- `retrieve` — read by exact key
- `search` — read by fuzzy query (for AI-style nearest-neighbor lookup)

No transaction semantics, no TTL, no eviction. Those are implementation concerns for the adapter. The interface stays minimal so multiple backends (in-process Map, redis, vector DB, claude-mem SDK) can implement it without breaking changes.

### Optional field on PluginContext

Making `memory` optional means existing plugins written against the v1 interface continue to work without changes. The host injects memory only when explicitly configured.

---

## Consequences

### Positive

- Plugin authors have a one-command bootstrap with correct tsconfig and test scaffold
- Memory-aware plugins have a standard contract that works across any backend
- Re-running `plugin init` is safe (idempotent file writes)

### Negative

- Scaffolder generates TypeScript source; plugin authors must build before using
- Memory interface is synchronous from the caller's perspective (all methods return Promise) — sync-only backends must wrap their APIs
- No validation that the injected memory backend actually works; plugin bears responsibility for error handling

---

## Out of scope (v1.1)

- Memory plugin discovery/configuration in `arbiter.json`
- Memory TTL or eviction semantics
- Sandboxing of plugin memory access

---

## See Also

- ADR-031: Plugin API v1
- `src/types/memory.ts` — ArbiterMemoryPlugin interface
- `src/types/plugin.ts` — PluginContext with optional memory field
- `src/commands/plugin.ts` — runPluginInit implementation
- `examples/plugins/claude-mem/` — reference stub adapter
