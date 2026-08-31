---
'@arbiter/cli': minor
---

Retire the five experimental tool generators (#2367, ADR-119). `cursor`,
`copilot`, `gemini`, `windsurf` and `aider` were retained-but-unreachable —
`parseTools` rejected the only values that could reach them — so their
generators, template trees and tests are deleted, along with the shared
`agent-file` factory whose only callers they were. ADR-119 also writes the
promotion criteria that were previously missing, derived from the `codex` track:
a runnable adapter, empirical tests against the live tool, an ADR-106
derive-from-Claude emission-parity gate (`check-codex-parity` /
`check-codex-self-parity` are the shape), and a fixture plus a generated
known-limitations table. No tool is promoted.

**Breaking (public type):** the exported `AiTool` union narrows from seven
members to `'claude' | 'codex'`; `AI_TOOLS`, the recipe `AiToolSchema` and the
`GeneratorKey` union narrow with it. No migration is required — an existing
`arbiter.json` naming a retired tool is coerced by `sanitizeCoercibleFields`
(unknown entries filtered, falling back to `['claude','codex']`) with a report
line, never rejected (ADR-105 never-brick). Brownfield _detection_ of
`.gemini/`, `windsurf-instructions.md` and `.aider.conf.yml` is deliberately
kept: detection is not emission, and ADR-011 still requires arbiter to back
those files up rather than clobber them.
