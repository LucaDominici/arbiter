---
'@arbiter/cli': minor
---

first-class FE governance — WCAG 2.2, W3C DTCG tokens, Vitest browser mode + VRT, Core Web Vitals gates, framework-aware (react/vue/svelte); arbiter is now genuinely full-stack.

Supersedes #1124 (initial frontend-governance generator — FE constitution + design principles).

## New generators

- **`frontend-governance`** (#1124): emits `FRONTEND_CONSTITUTION.md` + `FE_DESIGN_PRINCIPLES.md`.
- **`frontend-quality`** (#1127): emits all mechanical enforcement scripts (tokens, i18n, coverage, VRT, perf, bundle).

## Framework-awareness fix (#1127 S0)

Fixed framework-blindness bug: `.eslintrc-frontend-spa.cjs` now branches on `config.frontend.framework` — Vue gets `.vue` globs + `vuejs-accessibility`, Svelte gets `.svelte` + `eslint-plugin-svelte`, React gets `.tsx/.jsx` + `jsx-a11y`. Before this, all frontend-spa projects received React-shaped output.

Auto-detection: `init.ts` now derives `frontend.framework` from the detected `config.framework` for frontend-spa projects (vue→vue, react→react, next→react, svelte→svelte).

New `vue-frontend-spa` fixture proves non-React output (INV-32 matrix compliance).

## WCAG 2.2 upgrade (#1127 S1)

`run-axe.ts.ejs` upgraded from WCAG 2.1 AA to full WCAG 2.2 AA tag set (`wcag2a + wcag2aa + wcag21a + wcag21aa + wcag22aa`). Covers target-size (2.5.8), focus-appearance (2.4.11), accessible-auth (3.3.8).

`16-frontend-quality.yml.ejs` a11y step is now blocking (removed `|| true`; routes through Playwright harness).

## New enforcement artifacts (emitted by `frontend-quality` generator)

| Artifact                           | Purpose                                   | Invariant |
| ---------------------------------- | ----------------------------------------- | --------- |
| `design-tokens.json`               | W3C DTCG token seed                       | INV-105   |
| `scripts/verify-tokens.mjs`        | raw hex/phantom token gate                | INV-105   |
| `scripts/i18n-literal-scanner.mjs` | raw UI text literal gate                  | INV-106   |
| `scripts/verify-i18n-parity.mjs`   | locale key-parity gate                    | INV-106   |
| `scripts/verify-fe-coverage.mjs`   | per-layer coverage ratchet                | —         |
| `vitest.browser.config.ts`         | Vitest browser mode (Playwright/Chromium) | —         |
| `docs/GOVERNANCE/VRT_SETUP.md`     | VRT baseline capture guide                | —         |
| `.lighthouserc.json`               | CWV 2026 blocking budgets (LCP/CLS/INP)   | —         |
| `bundle-budget.json`               | bundle size budget config                 | —         |
| `scripts/check-bundle-size.mjs`    | bundle size gate vs dist/                 | —         |

## New invariants

INV-102 API-layer isolation, INV-103 headless domain purity, INV-104 state-mgmt discipline, INV-105 token discipline, INV-106 i18n parity. All tier=operational, languages=[typescript], minGovernanceLevel=L2.

**Blast radius:** Projects with `frontend-spa` archetype or `lanes: ["frontend"]` receive new enforcement artifacts on next `arbiter update` (all `skipIfExists: true` — no overwrite).
