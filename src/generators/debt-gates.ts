// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { getLogger } from '../utils/logger.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface DebtGatesGeneratorResult {
  files: WriteResult[]
}

function injectTestScripts(targetDir: string, dryRun: boolean): void {
  if (dryRun) return
  const pkgPath = resolvedPath(targetDir, 'package.json')
  if (!existsSync(pkgPath)) return
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    getLogger().warn(
      'debt_gates.inject_test_scripts_parse_failed',
      { path: pkgPath, err: String(err) },
      'injectTestScripts: failed to parse package.json',
    )
    return
  }
  const scripts = (pkg.scripts ?? {}) as Record<string, string>
  // Mirror arbiter's own dogfooded test-tier convention (path-based, not vitest
  // `--project`): the generated vitest.config.ts defines no `projects`, so
  // `vitest run --project <tier>` crashed every generated TS project's gate
  // (#1324). The optional tiers add --passWithNoTests so a greenfield project
  // that has not yet added contract/integration/behavioral tests stays green.
  const testScripts: Record<string, string> = {
    'test:unit': 'vitest run',
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
  if (changed) {
    pkg.scripts = scripts
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  }
}

function injectDepCruiserPackageJson(targetDir: string, dryRun: boolean): void {
  if (dryRun) return
  const pkgPath = resolvedPath(targetDir, 'package.json')
  if (!existsSync(pkgPath)) return
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    getLogger().warn(
      'debt_gates.inject_depcruiser_parse_failed',
      { path: pkgPath, err: String(err) },
      'injectDepCruiserPackageJson: failed to parse package.json',
    )
    return
  }
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
  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  }
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
  if (config.language === 'typescript' || config.language === 'multi') {
    injectTestScripts(config.targetDir, opts.dryRun)
  }

  if (!config.enableDebtGates) return { files: [] }

  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config

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
        resolvedPath(base, '.eslintrc-static.json'),
        renderTemplate('static-analysis/eslintrc-static.json.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, '.prettierrc.json'),
        renderTemplate('static-analysis/prettierrc.json.ejs', data),
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

  if (config.language === 'python') {
    results.push(
      writeFile(
        resolvedPath(base, 'ruff.toml'),
        renderTemplate('static-analysis/ruff.toml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

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
