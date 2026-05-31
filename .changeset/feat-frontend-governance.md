---
'@arbiter/cli': minor
---

feat(#1124): frontend governance generator — FE constitution + design principles

Adds `frontend-governance` generator that emits `docs/GOVERNANCE/FRONTEND_CONSTITUTION.md`
and `docs/GOVERNANCE/FE_DESIGN_PRINCIPLES.md` for projects with `archetype: frontend-spa`
or `lanes: ["frontend"]`. Templates cover FE001–FE006 architectural rules and P1–P9 design
principles, parameterized by `frontend.framework` (vue|react|svelte), `frontend.stateManager`,
and `frontend.validationLib`.

**New config field:** `frontend?: { framework?, stateManager?, validationLib? }` in `arbiter.json`.

**Blast radius:** Projects with `frontend-spa` archetype or `lanes: ["frontend"]` receive
two new governance docs on next `arbiter update` (skipIfExists — no overwrite of existing files).
