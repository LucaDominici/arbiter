---
title: 'Stack Adapter Contract'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Stack Adapter Contract

**Added:** W5 (#881)
**ADR:** [ADR-046](../ADR/046-stack-adapter.md)
**Invariant:** INV-88

## Overview

A `StackAdapter` is the extension point for language-specific generation behaviour in arbiter. Each supported language has one adapter file in `src/adapters/<lang>.ts`.

## Interface

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

### Methods

| Method               | Returns          | Description                                                                              |
| -------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `lintCommand()`      | `string \| null` | Lint command override. Null = use project config default. **Callers must null-check.**   |
| `formatCommand()`    | `string \| null` | Format command override. Null = use project config default. **Callers must null-check.** |
| `languageHooks()`    | `LanguageHook[]` | Language-specific hook scripts to generate. Does NOT replace common hooks.               |
| `supportsCoverage()` | `boolean`        | Whether coverage tooling is available for this language.                                 |
| `supportsMutation()` | `boolean`        | Whether mutation testing is available for this language.                                 |

### `isStub`

When `true`, the adapter is a placeholder: all command methods return null and hook/support arrays are empty. Stubs are replaced with full implementations in subsequent waves (W6–W11).

## Registry

```typescript
import { registerAdapter, resolveAdapter, listAdapters } from './src/adapters/_registry.js'
```

| Function                   | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `registerAdapter(adapter)` | Register an adapter. Throws if language already registered.         |
| `resolveAdapter(language)` | Look up adapter by language. Returns `undefined` if not registered. |
| `listAdapters()`           | Returns all registered adapters.                                    |
| `_resetForTest()`          | **Test only.** Clears the registry. Call in `afterEach`.            |

## Adding a New Language Adapter

1. Create `src/adapters/<lang>.ts` implementing `StackAdapter`
2. Call `registerAdapter(adapter)` at module load (side-effect import pattern)
3. Export the adapter constant: `export { langAdapter }`
4. Add the export to `src/adapters/index.ts`
5. If the language is a new `Language` value, add it to the `REQUIRED_LANGUAGES` list in `scripts/check-adapter-coverage.mjs` (or `EXEMPT_LANGUAGES` if exempt)
6. Run `node scripts/check-adapter-coverage.mjs` to verify the gate passes

## Exempt Languages

These languages are exempt from INV-88 and do not require an adapter file:

| Language  | Reason                                     |
| --------- | ------------------------------------------ |
| `kotlin`  | Covered by JVM / Java tooling              |
| `multi`   | Polyglot projects — no single adapter      |
| `unknown` | Language detection failed — not applicable |

## Test Isolation

The registry is a module singleton. Tests that import adapter files must call `_resetForTest()` in `afterEach` to prevent cross-test pollution:

```typescript
import { _resetForTest } from '../../src/adapters/_registry.js'

afterEach(() => {
  _resetForTest()
})
```

**Do not** import real adapter files in registry unit tests — build fake `StackAdapter` objects and call `registerAdapter()` directly.

## INV-88 Gate

`scripts/check-adapter-coverage.mjs` scans `src/adapters/` at L1 and fails if any required language adapter file is missing.

```bash
node scripts/check-adapter-coverage.mjs
# adapter coverage OK: typescript, java, python, go, rust
```

The gate is also reported in `arbiter doctor health` via the `stack-adapter` health check ID.

INV-88 is `selfOnly` — `src/adapters/<lang>.ts` files are an arbiter-internal artifact. The
`stack-adapter` doctor check therefore only enforces adapter coverage when run against arbiter
itself (detected by the unique package name `@arbiter/cli`). On a **client** repo the check is a
PASS advisory (skipped), so a Go-primary project with a frontend-lane `package.json` no longer
FAILs with a misleading hint pointing at an arbiter-internal path (#1343).
