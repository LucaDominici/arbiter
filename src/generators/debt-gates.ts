// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { mutatePackageJson } from '../utils/pkg.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface DebtGatesGeneratorResult {
  files: WriteResult[]
}

function injectTestScripts(targetDir: string, dryRun: boolean): void {
  mutatePackageJson(targetDir, dryRun, (pkg) => {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>
    // Mirror arbiter's own dogfooded test-tier convention (path-based, not vitest
    // `--project`): the generated vitest.config.ts defines no `projects`, so
    // `vitest run --project <tier>` crashed every generated TS project's gate
    // (#1324). The optional tiers add --passWithNoTests so a greenfield project
    // that has not yet added contract/integration/behavioral tests stays green.
    // #1840 F4 tranche-3: `test:unit` is scoped to `src` (a vitest CLI path
    // filter, same substring-match mechanism the other three tiers already use)
    // — an unscoped `vitest run` also swept up tests/api/**  (api-e2e.ts,
    // INV-126) and tests/e2e/** (playwright-ts.ts a11y), which need `supertest`/
    // `@playwright/test` and a live server. Those never ship as devDependencies
    // (they run via tests/api/run.sh / a dedicated e2e job, not `vitest run`),
    // so a fresh `backend-web-db` init RED'd on `Cannot find package 'supertest'`
    // before any team code was added — surfaced while promoting that archetype's
    // TS fixture to the functional bake-and-run tier.
    const testScripts: Record<string, string> = {
      'test:unit': 'vitest run src',
      'test:contract': 'vitest run --passWithNoTests __tests__/contract',
      'test:integration': 'vitest run --passWithNoTests __tests__/integrations',
      'test:behavioral': 'vitest run --passWithNoTests __tests__/behavioral',
    }
    let changed = false
    for (const [key, value] of Object.entries(testScripts)) {
      if (!scripts[key]) {
        scripts[key] = value
        changed = true
      }
    }
    if (changed) pkg.scripts = scripts
    return changed
  })
}

function injectDepCruiserPackageJson(targetDir: string, dryRun: boolean): void {
  mutatePackageJson(targetDir, dryRun, (pkg) => {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
    let changed = false
    if (!scripts['check:arch']) {
      scripts['check:arch'] = 'depcruise src'
      pkg.scripts = scripts
      changed = true
    }
    if (!devDeps['dependency-cruiser']) {
      devDeps['dependency-cruiser'] = '^16.0.0'
      pkg.devDependencies = devDeps
      changed = true
    }
    return changed
  })
}

// The toolchain the generated L1/L2 gate actually invokes (tsc, prettier, eslint,
// vitest). Without these declared, a plain `npm install` after `arbiter init`
// leaves the gate's `npx eslint`/`vitest` unresolved (exit 127) — the gate is RED
// on first run for a reason that is arbiter's own under-declaration (B4, #1491).
// Pinned to registry versions (caret) so the install is reproducible (#1314).
const TS_GATE_DEVDEPS: Record<string, string> = {
  typescript: '^5.6.0',
  '@types/node': '^22.0.0',
  prettier: '^3.3.0',
  eslint: '^9.13.0',
  '@eslint/js': '^9.13.0',
  'typescript-eslint': '^8.10.0',
  vitest: '^3.0.0',
  '@vitest/coverage-v8': '^3.0.0',
}

function injectTsGateToolchain(targetDir: string, dryRun: boolean): void {
  mutatePackageJson(targetDir, dryRun, (pkg) => {
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
    let changed = false
    for (const [name, version] of Object.entries(TS_GATE_DEVDEPS)) {
      // Respect a version the user already pinned — only fill in what is absent so a
      // brownfield project's existing toolchain versions are never overwritten.
      if (!devDeps[name] && !(pkg.dependencies as Record<string, string> | undefined)?.[name]) {
        devDeps[name] = version
        changed = true
      }
    }
    if (changed) pkg.devDependencies = devDeps
    return changed
  })
}

// Gate-essential TypeScript config files — every one is consumed by the generated
// L1 gate (typecheck→tsconfig, format→.prettierrc/.prettierignore, lint→
// eslint.config.mjs, static analysis→eslint.config.static.mjs). Emitted on EVERY
// TS init regardless of enableDebtGates, so init→install→check-all is green (B4).
function emitTsGateScaffold(base: string, data: object, dryRun: boolean): WriteResult[] {
  const files: [string, string][] = [
    // tsconfig.json — TS greenfield baseline (was emitted by the GitHub-gated
    // `root` generator, so non-GitHub inits had no tsconfig → typecheck RED).
    ['tsconfig.json', 'root/tsconfig.json.ejs'],
    ['.prettierrc.json', 'static-analysis/prettierrc.json.ejs'],
    // .prettierignore — scopes `prettier --check .` to the user's source so
    // arbiter's own generated docs/config/hooks do not turn the format gate RED.
    ['.prettierignore', 'static-analysis/prettierignore.ejs'],
    // Flat ESLint configs (v9+): main (lint gate) + isolated static-analysis gate.
    // The legacy eslintrc (.eslintrc-static.json) is retained for compatibility but
    // is no longer consumable by ESLint v9 — the gate now loads the flat configs.
    ['eslint.config.mjs', 'static-analysis/eslint.config.mjs.ejs'],
    ['eslint.config.static.mjs', 'static-analysis/eslint.config.static.mjs.ejs'],
    ['.eslintrc-static.json', 'static-analysis/eslintrc-static.json.ejs'],
  ]
  return files.map(([rel, tmpl]) =>
    writeFile(resolvedPath(base, rel), renderTemplate(tmpl, data), { skipIfExists: true, dryRun }),
  )
}

function pushJavaDebtGates(
  results: WriteResult[],
  base: string,
  data: object,
  dryRun: boolean,
): void {
  const files: [string, string][] = [
    [resolvedPath(base, 'config', 'pmd-ruleset.xml'), 'static-analysis/pmd-ruleset.xml.ejs'],
    [resolvedPath(base, 'config', 'checkstyle.xml'), 'static-analysis/checkstyle.xml.ejs'],
    [
      resolvedPath(base, 'config', 'spotbugs-exclude.xml'),
      'static-analysis/spotbugs-exclude.xml.ejs',
    ],
    [resolvedPath(base, 'spotless.gradle'), 'static-analysis/spotless.gradle.ejs'],
    [resolvedPath(base, 'config', 'pitest-setup.md'), 'mutation/pitest-l2-setup.md.ejs'],
    [resolvedPath(base, 'spotbugs.gradle'), 'static-analysis/spotbugs.gradle.ejs'],
    [resolvedPath(base, 'scripts', 'verify-spotbugs.mjs'), 'scripts/verify-spotbugs.mjs.ejs'],
    [resolvedPath(base, 'spotbugs-baseline.json'), 'scripts/spotbugs-baseline.json.ejs'],
  ]
  for (const [path, tmpl] of files) {
    results.push(writeFile(path, renderTemplate(tmpl, data), { skipIfExists: true, dryRun }))
  }
}

export function generateDebtGates(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): DebtGatesGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = { ...config, strictnessTier: config.strictnessTier ?? 'practical' }

  // Universal config-lint configs (#1546, closing #1506/#1507). Language-agnostic:
  // every generated repo has non-workflow YAML and/or shell, and the config-lint CI
  // lane + pre-commit hook run at every governance level. Committed + tunable, they
  // are auto-discovered by yamllint/shellcheck — making the rules explicit and
  // project-tunable rather than relying on the relaxed/default fallback. Emitted for
  // ALL archetypes, before any language or enableDebtGates gating.
  for (const [rel, tmpl] of [
    ['.yamllint.yml', 'static-analysis/.yamllint.yml.ejs'],
    ['.shellcheckrc', 'static-analysis/.shellcheckrc.ejs'],
  ] as const) {
    results.push(
      writeFile(resolvedPath(base, rel), renderTemplate(tmpl, data), {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    )
  }

  if (config.language === 'typescript' || config.language === 'multi') {
    injectTestScripts(base, opts.dryRun)
    // Gate-essential TS scaffold — emitted for EVERY TS init (even L1, where
    // enableDebtGates is false) because the generated L1 gate already runs
    // typecheck/format/lint/static-analysis/unit for TS. Without these the gate is
    // RED on first install (B4, #1491). The debt-only extras (knip, dep-cruiser)
    // stay below the enableDebtGates guard.
    results.push(...emitTsGateScaffold(base, data, opts.dryRun))
    injectTsGateToolchain(base, opts.dryRun)
  }

  if (config.language === 'python') {
    // Gate-essential Python scaffold — emitted on EVERY Python init (even L1, where
    // enableDebtGates is false) because the generated L1 gate runs ruff (lint +
    // format) and pytest. ruff.toml supplies arbiter's lint config; requirements-
    // dev.txt declares the toolchain the gate invokes (B4, #1491).
    results.push(
      writeFile(
        resolvedPath(base, 'ruff.toml'),
        renderTemplate('static-analysis/ruff.toml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, 'requirements-dev.txt'),
        renderTemplate('static-analysis/requirements-dev.txt.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  if (!config.enableDebtGates) return { files: results }

  if (config.language === 'typescript' || config.language === 'multi') {
    results.push(
      writeFile(
        resolvedPath(base, 'knip.json'),
        renderTemplate('static-analysis/knip.json.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, '.dependency-cruiser.cjs'),
        renderTemplate('static-analysis/.dependency-cruiser.cjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    injectDepCruiserPackageJson(base, opts.dryRun)
  }

  if (config.language === 'rust') {
    results.push(
      writeFile(
        resolvedPath(base, 'rustfmt.toml'),
        renderTemplate('static-analysis/rustfmt.toml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  if (config.language === 'go') {
    results.push(
      writeFile(
        resolvedPath(base, '.golangci.yml'),
        renderTemplate('static-analysis/.golangci.yml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  if (config.language === 'java' || config.language === 'multi') {
    pushJavaDebtGates(results, base, data, opts.dryRun)
  }

  // NOTE: ruff.toml + requirements-dev.txt for Python are emitted above, before the
  // enableDebtGates guard, so the L1 gate (ruff/pytest) has its config on first run.

  if (config.language === 'kotlin') {
    pushKotlinDebtGates(results, base, data, opts.dryRun)
  }

  return { files: results }
}

function pushKotlinDebtGates(
  results: WriteResult[],
  base: string,
  data: object,
  dryRun: boolean,
): void {
  results.push(
    writeFile(
      resolvedPath(base, 'config', 'detekt', 'detekt.yml'),
      renderTemplate('static-analysis/detekt.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  )
}
