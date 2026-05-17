# Skill Detector — Per-Session Cache

**Date:** 2026-05-17
**Origin:** #798 — "full superpowers skill-detector"

## What changed

`src/integrations/skill-detector.ts` now caches the result of
`detectInstalledSkills` keyed by `(targetDir, claudeHome)`.

## Why

The detector walks up to 4 directory trees per call. `arbiter init` and
`arbiter update` each invoke it; a single CLI invocation may hit the
detector multiple times via different generators. Per-session caching
avoids repeated `readdirSync` / `statSync` calls.

## Behaviour contract

- **Same key, repeated call** → cache hit; returns the same array reference (object identity preserved).
- **FS mutation between calls** → cache hit; new SKILL.md files are invisible until `clearSkillCache()` is called. Long-running processes that mutate skills on disk MUST call `clearSkillCache()` between mutations.
- **Different `targetDir` or `claudeHome`** → distinct cache entry; each project / home pair scanned independently.

## Cache invalidation

Cache is process-local (Map in module scope). Restart-on-invalidation
is the default for CLI invocations. For test suites and any other
long-running process, call `clearSkillCache()`:

```ts
import { clearSkillCache } from '../../src/integrations/skill-detector.js'

beforeEach(() => {
  clearSkillCache()
})
```

## Test coverage

`__tests__/integrations/skill-detector.test.ts` adds four cache tests:

- returns identical reference on second call (same key)
- does NOT re-scan after FS mutation (cache is sticky)
- `clearSkillCache` forces a fresh scan
- different `targetDir` keys produce distinct cache entries

## Out of scope

- TTL-based invalidation (no use case yet; CLI invocations are short-lived).
- File-watcher invalidation (no daemon currently needs it; the explicit
  `clearSkillCache` hook is sufficient).
