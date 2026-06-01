---
'arbiter': minor
---

feat(frontend): emit #352 stylelint design-token config + wire the lint:css gate

`frontend-quality` now emits `.stylelintrc.json` (HARD design-token rules: `color-no-hex` → `var(--color-*)`, `length-zero-no-unit`, `custom-property-no-missing-var-function`) and injects the `stylelint` devDep, so the generated `lint:css` gate (which #1137 made gate-on-present) actually runs and resolves in CI for frontend-spa / frontend-lane targets. Core stylelint rules only — no `extends`/plugins — so it enforces design tokens without flooding a brownfield project with general-CSS findings.

Refactor (DRY, dogfoods CANON-22): extracted a shared `injectDevDependency` helper (`src/utils/pkg.ts`) used by both the jscpd (duplication) and stylelint generators, replacing the per-tool inline inject functions so a second near-identical copy doesn't accrue.
