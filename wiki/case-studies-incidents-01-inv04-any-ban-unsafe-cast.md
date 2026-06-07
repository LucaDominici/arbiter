---
generated: true
source: 'docs/case-studies/incidents/01-inv04-any-ban-unsafe-cast.md'
source_sha: '0d290f830acd79dffc1175c5365bf4c17603eb31'
last_updated: '2026-06-07'
---

# Incident: INV-04 (`any` ban) catching an unsafe cast in the detector

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/case-studies/incidents/01-inv04-any-ban-unsafe-cast.md](../docs/case-studies/incidents/01-inv04-any-ban-unsafe-cast.md)

# Incident: INV-04 (`any` ban) catching an unsafe cast in the detector

**Invariant:** INV-04 — no `any` type in TypeScript source  
**Hook:** `check-no-any.mjs` (PostToolUse → Edit|Write)  
**Gate:** `npx tsc --noEmit` + ESLint `@typescript-eslint/no-explicit-any`

---

## What happened

During development of the cross-language compatibility detector
(`src/compatibility/`), a developer added a temporary cast to bypass a type
mismatch between the detector's output shape and the matrix schema:

```typescript
// src/compatibility/detector.ts
const result = runDetector(input) as any
const score = result.score // TypeScript would catch this mismatch without `as any`
```

The mismatch was between `DetectorResult` (which has `scorePercent`) and the
call-site which expected `score`. Using `as any` silenced the compiler error
but introduced a runtime field-name bug: `score` would always be `undefined`.

## How arbiter caught it

The `check-no-any.mjs` post-edit hook fired immediately after the file was
saved:

```
PostToolUse hook: check-no-any
VIOLATION: src/compatibility/detector.ts:47
  `any` type detected — INV-04
  Fix: use the correct type or add a type guard
```

The developer could not proceed without either fixing the cast or explicitly
marking it with a suppression (which requires a task ID and justification in
`suppressions/`).

## The fix

```typescript
// After fix:
const result: DetectorResult = runDetector(input)
const score = result.scorePercent // correct field name
```

The compiler immediately flagged `result.score` as non-existent on
`DetectorResult`, pointing directly to the root cause.

## Impact

Without INV-04, this bug would have shipped to users as a silent `undefined`
score in the compatibility report — no error, just wrong data. The hook caught
it in under one second, before the developer could run tests.

## Takeaway

`as any` is almost always a type-system lie. INV-04 forces the developer to
confront the actual type mismatch rather than paper over it. The two-second
hook cost saved a debugging session that would have started from "why is
score always undefined?"
