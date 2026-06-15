// SPDX-License-Identifier: Apache-2.0
// CATALOG: Frontend quality enforcement generator — emits mechanical gate scripts
// CATALOG: (tokens, i18n, coverage, VRT, perf, render-smoke) for frontend-spa and
// CATALOG: frontend-lane projects. Companion to frontend-governance.ts (docs). (#1127)
// CATALOG: #1366: also scaffolds the render-smoke behavioural spec (INV-127) for TS frontends.
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { injectDevDependency } from '../utils/pkg.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface FrontendQualityResult {
  files: WriteResult[]
}

export function generateFrontendQuality(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): FrontendQualityResult {
  const isFrontend = config.archetype === 'frontend-spa' || config.lanes.includes('frontend')
  if (!isFrontend) return { files: [] }

  const base = config.targetDir
  // Safe-default: frontend may be absent on pre-existing frontend-spa projects.
  const templateData = { ...config, frontend: config.frontend ?? {} }

  // Render all templates before writing to avoid partial-write state.
  const tokensDef = renderTemplate('frontend/design-tokens.json.ejs', templateData)
  const verifyTokens = renderTemplate('scripts/verify-tokens.mjs.ejs', templateData)
  const i18nScanner = renderTemplate('scripts/i18n-literal-scanner.mjs.ejs', templateData)
  const i18nParity = renderTemplate('scripts/verify-i18n-parity.mjs.ejs', templateData)
  const feCoverage = renderTemplate('scripts/verify-fe-coverage.mjs.ejs', templateData)
  const vitestBrowser = renderTemplate('coverage/vitest.browser.config.ts.ejs', templateData)
  const vrtSetup = renderTemplate('frontend/vrt-setup.md.ejs', templateData)
  const lighthouseRc = renderTemplate('perf/lighthouserc.json.ejs', templateData)
  const bundleBudget = renderTemplate('perf/bundle-budget.json.ejs', templateData)
  const checkBundleSize = renderTemplate('scripts/check-bundle-size.mjs.ejs', templateData)
  const stylelintRc = renderTemplate('static-analysis/stylelintrc.json.ejs', templateData)
  // #1366 (INV-127): render-smoke behavioural spec — a Playwright(TS) headless-browser
  // boot of the built SPA that asserts the app shell mounts without console errors.
  // The spec is TypeScript/Playwright-based, so it is emitted only for TS frontends;
  // the presence gate (check-render-smoke.mjs) is language-agnostic and emitted
  // unconditionally by check-all.ts.
  const isTsFrontend = config.language === 'typescript'
  const renderSmokeSpec = isTsFrontend
    ? renderTemplate('e2e/playwright-ts/render-smoke.spec.ts.ejs', templateData)
    : null

  const result = {
    files: [
      // S2: Design tokens (W3C DTCG format) — INV-105 seed file
      writeFile(resolvedPath(base, 'design-tokens.json'), tokensDef, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // S2: Token discipline gate script — INV-105 enforcement
      writeFile(resolvedPath(base, 'scripts', 'verify-tokens.mjs'), verifyTokens, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // S3: i18n raw-literal scanner — INV-106 enforcement
      writeFile(resolvedPath(base, 'scripts', 'i18n-literal-scanner.mjs'), i18nScanner, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // S3: i18n locale key-parity gate — INV-106 enforcement
      writeFile(resolvedPath(base, 'scripts', 'verify-i18n-parity.mjs'), i18nParity, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // S4: FE per-layer coverage ratchet
      writeFile(resolvedPath(base, 'scripts', 'verify-fe-coverage.mjs'), feCoverage, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // S5: Vitest browser-mode config (real Chromium via Playwright)
      writeFile(resolvedPath(base, 'vitest.browser.config.ts'), vitestBrowser, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // S5: VRT setup README
      writeFile(resolvedPath(base, 'docs', 'GOVERNANCE', 'VRT_SETUP.md'), vrtSetup, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // S6: Lighthouse CI config with Core Web Vitals 2026 budgets
      writeFile(resolvedPath(base, '.lighthouserc.json'), lighthouseRc, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // S6: Bundle size budget config
      writeFile(resolvedPath(base, 'bundle-budget.json'), bundleBudget, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // S6: Bundle size gate script
      writeFile(resolvedPath(base, 'scripts', 'check-bundle-size.mjs'), checkBundleSize, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // #352: stylelint design-token config — the lint:css gate runs `npx stylelint`
      writeFile(resolvedPath(base, '.stylelintrc.json'), stylelintRc, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // #1366 (INV-127): render-smoke behavioural spec (TS frontends only).
      ...(renderSmokeSpec !== null
        ? [
            writeFile(resolvedPath(base, 'tests', 'e2e', 'render-smoke.spec.ts'), renderSmokeSpec, {
              skipIfExists: true,
              dryRun: opts.dryRun,
            }),
          ]
        : []),
    ],
  }

  // #352: ensure the CI lint:css gate resolves (`npx stylelint` needs the tool present).
  injectDevDependency(base, 'stylelint', '^16.0.0', opts.dryRun)

  return result
}
