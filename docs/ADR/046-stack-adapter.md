---
title: 'ADR-046: Stack Adapter Model'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-046: Stack Adapter Model

**Status:** Accepted
**Date:** 2026-05-19
**Issue:** #881 (W5 — Stack Adapter Model)

## Context

arbiter generates project scaffolding for multiple language stacks (TypeScript, Java, Python, Go, Rust, Kotlin). As more language-specific generation logic accumulated in generators and templates, the lack of a formal abstraction layer caused:

- Fragmented per-language logic scattered across multiple generator files
- No clear contract for what language-specific customization points exist
- No enforcement that all supported languages have their customization implemented

W5 introduces a formal `StackAdapter` interface as the extension point for language-specific generation behaviour.

## Decision

Introduce a `StackAdapter` interface at `src/adapters/StackAdapter.ts` with the following contract:

```typescript
interface StackAdapter {
  readonly language: Language
  readonly isStub: boolean
  lintCommand(): string | null
  formatCommand(): string | null
  languageHooks(): LanguageHook[]
  supportsCoverage(): boolean
  supportsMutation(): boolean
}
```

Each language gets its own file in `src/adapters/<lang>.ts` that self-registers at import time via a module-level `registerAdapter()` call. The registry (`src/adapters/_registry.ts`) is a simple `Map<Language, StackAdapter>`.

Languages without full adapter implementations ship as stubs (`isStub: true`) with null-returning command methods and empty hook arrays.

**INV-88** enforces that every non-exempt language (`typescript`, `java`, `python`, `go`, `rust`) has an adapter file present. Exempt languages: `kotlin` (covered by Java JVM), `multi`, `unknown`.

## Consequences

**Positive:**

- Clear extension point: adding a new language means creating one adapter file
- Compile-time safety: `StackAdapter` interface enforces the contract
- Gate enforcement: `check-adapter-coverage.mjs` fails the L1 gate if adapters are missing
- Doctor integration: `arbiter doctor health` reports adapter coverage per project

**Negative / Trade-offs:**

- Self-registering module pattern (side-effect imports) is unusual in TypeScript; documented in barrel `src/adapters/index.ts`
- Stub adapters ship immediately, so stacks other than TypeScript don't get real command overrides yet (follow-up waves W6–W11)
- Registry is a module singleton; tests must call `_resetForTest()` in `afterEach`

## Alternatives Considered

1. **Config-file driven**: Store per-language config in `arbiter.json`. Rejected: would require schema changes for every new customisation point.
2. **Template-only approach**: Keep language logic in EJS templates. Rejected: harder to test, no TypeScript type safety.
3. **Plugin system**: Full plugin architecture with dynamic loading. Rejected: over-engineered for the current scope; adapters can evolve into plugins in a future ADR.
