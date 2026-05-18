# Cost-Optimized Phase Handoff (Phase 3.5)

> This recipe documents R1.S15 — the hard model-switch boundary between planning and
> implementation phases. Full content added in Stage D of #703.

## Overview

Planning phases run on Opus (deep reasoning); a hard `/clear` session boundary is enforced
at the plan→implementation transition; implementation phases run on Sonnet (fast TDD cycles).

See `src/capabilities/host-probe.ts` for host capability detection and `src/commands/task.ts`
for `TaskStatus` handoff fields (`handoffStrategy`, `planningHandoffReady`, `postClearResumed`).
