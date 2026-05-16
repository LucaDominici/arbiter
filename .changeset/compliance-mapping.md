---
'@arbiter/cli': minor
---

feat(#710): ISO 27001 / NIS2 / GDPR compliance mapping generator

Adds opt-in `generateCompliance` generator that emits `docs/COMPLIANCE_MAPPING.md`
mapping every arbiter-generated quality gate to the compliance control it satisfies.
Supports three independent frameworks via `enableIso27001Mapping`, `enableNis2Mapping`,
and `enableGdprMapping` flags. Includes audit preparation checklists per framework.
