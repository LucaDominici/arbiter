---
generated: true
source: 'docs/case-studies/incidents/03-inv12-no-pii-generator.md'
source_sha: '652dff469e7cc20ad7e7aca6ab0c7ffee416f011'
last_updated: '2026-06-08'
---

# Incident: INV-12 (no PII / no direct spawn) caught in a generator

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/case-studies/incidents/03-inv12-no-pii-generator.md](../docs/case-studies/incidents/03-inv12-no-pii-generator.md)

# Incident: INV-12 (no PII / no direct spawn) caught in a generator

**Invariant:** INV-12 — no PII in committed files; no direct process spawn  
**Hook:** `check-no-pii.mjs` + `check-no-direct-spawn.mjs` (PostToolUse → Edit|Write)  
**Gate:** `node scripts/pii-scan.mjs` (L1)

---

## What happened

A generator for the `debt-gates` tool needed to write a sample configuration
file. The developer hard-coded a placeholder that used a realistic-looking
email address as an example value:

```typescript
// src/generators/debt-gates.ts  (violating version)
const exampleConfig = {
  notify: 'dev-lead@company.com', // placeholder — INV-12 violation
  threshold: 5,
}
```

In the same commit, an early draft of the generator ran a validation command
via a direct Node.js spawn instead of the approved `run-cli.ts` utility —
also an INV-12 violation (unapproved spawn path).

## How arbiter caught it

Two hooks fired in sequence after the file was saved:

```
PostToolUse hook: check-no-pii
VIOLATION: src/generators/debt-gates.ts:14
  PII pattern detected: email address
  Fix: use a placeholder like "user@example.com" or a non-PII template variable

PostToolUse hook: check-no-direct-spawn
VIOLATION: src/generators/debt-gates.ts:19
  Direct spawn detected — INV-12
  Fix: use src/utils/run-cli.ts instead (approved spawn path)
```

## The fixes

```typescript
// PII fix — use RFC 2606 example domain:
const exampleConfig = {
  notify: 'user@example.com',
  threshold: 5,
}

// Spawn fix — use the approved utility:
import { runCli } from '../utils/run-cli.js'
await runCli('npx', ['debt-report', '--validate'])
```

## Impact

The email address `dev-lead@company.com` was likely a real address from a
previous project. Committing it would have embedded PII in the public git
history, which is difficult to fully expunge (requires history rewrite +
force push + cache invalidation on all forks).

The direct spawn call bypassed error handling and timeout enforcement
built into `run-cli.ts`, which would have caused silent failures on slow CI
runners.

## Takeaway

PII in example values is a common oversight — developers reach for "realistic"
examples without considering that example values end up in the public repo.
RFC 2606 reserves `example.com` precisely for this use. INV-12 enforces this
boundary automatically.
