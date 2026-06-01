// SPDX-License-Identifier: Apache-2.0
// CANON-22: duplication (DRY) gate generator. Emits a jscpd config + injects the
// jscpd devDep so the `npx jscpd` gate wired into the generated check-all is not
// dead-on-arrival (CANON-01: arbiter dogfoods the same gate at scripts/check-all.mjs).
import { existsSync, readFileSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { getLogger } from '../utils/logger.js'
import type { GovernanceLevel, ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface DuplicationGeneratorResult {
  files: WriteResult[]
}

/**
 * Duplication ceiling (% duplicated tokens) by governance level. The ratchet
 * tightens beyond this; the ceiling is the absolute fail line for a fresh repo.
 */
function duplicationThresholdFor(level: GovernanceLevel): number {
  if (level === 'L1') return 10
  if (level === 'L2') return 5
  return 3 // L3 / L4 — strict
}

/**
 * Inject the jscpd devDependency into the target package.json so the emitted
 * `npx jscpd` gate resolves. Single-writer; skips silently if package.json is
 * absent or unparseable (non-TS targets never reach here).
 */
function injectJscpdDevDep(targetDir: string, dryRun: boolean): void {
  if (dryRun) return
  const pkgPath = resolvedPath(targetDir, 'package.json')
  if (!existsSync(pkgPath)) return
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    getLogger().warn(
      'duplication.inject_devdep_parse_failed',
      { path: pkgPath, err: String(err) },
      'injectJscpdDevDep: failed to parse package.json',
    )
    return
  }
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
  if (!devDeps['jscpd']) {
    devDeps['jscpd'] = '^4.2.4'
    pkg.devDependencies = devDeps
    // Route through the fs façade (honours --dry-run; INV / direct-write gate).
    writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', { dryRun })
  }
}

export function generateDuplication(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): DuplicationGeneratorResult {
  // jscpd is a TS/JS clone detector. TypeScript only: the generated check-all
  // duplication step is rendered inside the `language === 'typescript'` L2 block,
  // so emitting config for other stacks (incl. `multi`) would be dead-on-arrival.
  // Other stacks get duplication via native tooling (PMD-CPD for Java, etc.).
  if (config.language !== 'typescript') return { files: [] }
  if (!config.enableDebtGates) return { files: [] }

  const data = {
    ...config,
    duplicationThreshold: duplicationThresholdFor(config.governanceLevel),
  }

  const files: WriteResult[] = [
    writeFile(
      resolvedPath(config.targetDir, '.jscpd.json'),
      renderTemplate('static-analysis/jscpd.json.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]

  injectJscpdDevDep(config.targetDir, opts.dryRun)

  return { files }
}
