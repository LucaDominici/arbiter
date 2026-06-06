---
generated: true
source: 'docs/SYSTEM/detector-error-policy.md'
source_sha: '7e40c36eb8ff26adaaba9edcb88c09904a3047df'
last_updated: '2026-06-06'
---

# Detector Error Policy

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/SYSTEM/detector-error-policy.md](../docs/SYSTEM/detector-error-policy.md)

# Detector Error Policy

## Rule

All file reads in `src/detectors/` MUST go through the shared helpers in
`src/utils/safe-read.ts`. Direct `readFileSync` calls are forbidden in detectors.

## Helpers

| Helper                     | Returns on ENOENT | Returns on other error |
| -------------------------- | ----------------- | ---------------------- |
| `readFileSafe(path)`       | `''` (silent)     | `''` + `console.warn`  |
| `readPackageJsonSafe(dir)` | `{}` (silent)     | `{}` + `console.warn`  |

## Rationale

Detectors run against arbitrary target projects. A missing file is normal and
expected — silently returning a neutral value keeps the UX clean. Any other
read failure (permissions, corrupt FS) is unexpected and should surface to the
operator via a warning, not silently degrade or crash.

Prior to this policy, detectors used bare `readFileSync` inside try/catch blocks
that swallowed all errors uniformly. This masked non-ENOENT problems that
operators need to see (#684).

## Scope

Applies to: `src/detectors/build.ts`, `src/detectors/framework.ts`,
`src/detectors/modules.ts`, and any future detector added under `src/detectors/`.

Does NOT apply to test helpers or scripts.
