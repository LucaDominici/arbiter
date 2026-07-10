// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from init.ts — generator execution, plugin
// loading, dry-run preview, and rollback/verification of generation output. Pure
// extraction, no behavior change.
import { existsSync, copyFileSync, unlinkSync } from 'node:fs'
import { resolve, join, normalize, isAbsolute, sep } from 'node:path'
import { ArbiterError } from '../../utils/errors.js'
import { t } from '../../i18n/index.js'
import { getLogger } from '../../utils/logger.js'
import { buildMigrationPlan } from '../../wizard/prompts.js'
import type { ArbiterConfig } from '../../utils/config.js'
import { levelAtLeast } from '../../config/levels.js'
import { buildRegistry, runGeneratorsFromRegistry } from '../../generators/registry.js'
import type { GeneratorFailure } from '../../generators/registry.js'
import { loadPlugin } from '../../utils/plugin-loader.js'
import { renderFromAbsPath } from '../../utils/render.js'
import { writeFile } from '../../utils/fs.js'
import type { WriteResult } from '../../utils/fs.js'
import { runCli } from '../../utils/run-cli.js'
import type { ProjectConfig } from '../../wizard/types.js'

export function runGenerators(config: ProjectConfig): WriteResult[] {
  return runGeneratorsFromRegistry(buildRegistry(config), [], { dryRun: false })
}

/**
 * Same as {@link runGenerators} but also returns generator failures collected
 * by `safeRun` (#483). Callers that surface command-level exit codes must use
 * this variant and surface any non-empty `errors` array via a non-zero exit
 * (INV-53 status=error → exit 2). The plain `runGenerators` wrapper is kept
 * for legacy callers (brownfield integration tests) that only consume results.
 */
export function runGeneratorsWithErrors(
  config: ProjectConfig,
  installedSkills: Parameters<typeof buildRegistry>[1] = [],
): {
  results: WriteResult[]
  errors: GeneratorFailure[]
} {
  const errors: GeneratorFailure[] = []
  const results = runGeneratorsFromRegistry(buildRegistry(config, installedSkills), errors, {
    dryRun: false,
  })
  return { results, errors }
}

/** Throws if resolvedPath does not start with safeRoot + path separator. */
function assertPathContained(resolvedPath: string, safeRoot: string, rawPath: string): void {
  if (!resolvedPath.startsWith(safeRoot + sep)) {
    throw new Error(`Plugin output path escapes target directory: ${rawPath}`)
  }
}

export async function runPlugins(
  targetDir: string,
  plugins: string[],
  storedConfig: ArbiterConfig,
): Promise<WriteResult[]> {
  const all: WriteResult[] = []
  const writtenPaths = new Set<string>()
  const failures: string[] = []
  for (const pkg of plugins) {
    try {
      const plugin = await loadPlugin(pkg, targetDir)
      if (plugin.detect && !(await plugin.detect(storedConfig))) continue
      const ctx = {
        config: storedConfig,
        targetDir,
        renderTemplate(relPath: string, data: Record<string, unknown>): string {
          const safe = normalize(relPath)
          if (safe.startsWith('..') || isAbsolute(safe)) {
            throw new Error(`Invalid plugin template path: ${relPath}`)
          }
          return renderFromAbsPath(join(plugin.templateRoot, safe), data)
        },
      }
      const result = await plugin.generate(ctx)
      if (!Array.isArray(result.files)) {
        getLogger().warn(
          'init.plugin_invalid_result',
          { plugin: pkg },
          `Plugin "${pkg}" returned invalid result (no files array). Skipping.`,
        )
        continue
      }
      for (const file of result.files) {
        if (writtenPaths.has(file.path)) {
          getLogger().warn(
            'init.plugin_conflict',
            { plugin: pkg, path: file.path },
            `Plugin "${pkg}" conflict: "${file.path}" already written by a prior plugin. Skipping.`,
          )
          all.push({ path: file.path, action: 'skipped' })
          continue
        }
        const resolvedFilePath = resolve(targetDir, file.path)
        assertPathContained(resolvedFilePath, resolve(targetDir), file.path)
        writtenPaths.add(file.path)
        all.push(
          writeFile(resolvedFilePath, file.content, {
            backup: file.action === 'backup-and-replace',
            skipIfExists: file.action === 'skip',
          }),
        )
      }
    } catch (err) {
      failures.push(`Plugin "${pkg}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (failures.length > 0) {
    throw ArbiterError.fromKey('E_INIT_PLUGIN_FAILURES', 'errors.E_INIT_PLUGIN_FAILURES', {
      failures: failures.join('\n  '),
    })
  }
  return all
}

export interface DryRunPreview {
  created: string[]
  modified: string[]
  skipped: string[]
}

export function computeDryRunPreview(config: ProjectConfig): DryRunPreview {
  const plan = buildMigrationPlan(config.existing, config.tools, config.useGitHub)
  return {
    created: plan.created,
    modified: [...plan.replaced, ...plan.merged],
    skipped: plan.preserved,
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function rollbackGeneration(results: WriteResult[]): void {
  const rollbackErrors: string[] = []
  for (const result of results) {
    if (result.action === 'created') {
      try {
        if (existsSync(result.path)) unlinkSync(result.path)
      } catch (err) {
        rollbackErrors.push(`Could not remove ${result.path}: ${errMsg(err)}`)
      }
    } else if (result.action === 'backed-up-and-replaced') {
      const backup = `${result.path}.arbiter-backup`
      try {
        if (existsSync(backup)) {
          copyFileSync(backup, result.path)
          unlinkSync(backup)
        }
      } catch (err) {
        rollbackErrors.push(`Could not restore backup for ${result.path}: ${errMsg(err)}`)
      }
    }
  }
  if (rollbackErrors.length > 0) {
    process.stderr.write(`  Rollback partial — manual cleanup required:\n`)
    for (const e of rollbackErrors) process.stderr.write(`    ${e}\n`)
  }
}

export function maybeCaptureBaseline(
  config: ProjectConfig,
  targetDir: string,
  brownfield: boolean,
): void {
  // #1732 Step 3: floor check (not `=== 'L3'`) — the generated debt-report.mjs
  // is fail-closed at `isL3Plus` (L3 and L4), so init must fatally capture the
  // baseline at L4 too; a hand-rolled `=== 'L3'` literal silently skipped it.
  if (levelAtLeast(config.governanceLevel, 'L3') && config.enableDebtGates) {
    runBrownfieldCapture(targetDir, { fatal: true })
  } else if (brownfield && config.enableDebtGates) {
    runBrownfieldCapture(targetDir)
  }
}

function runBrownfieldCapture(
  targetDir: string,
  opts: { fatal: boolean } = { fatal: false },
): void {
  process.stdout.write(`${t('cli.init.capturing_baseline')}\n`)
  try {
    runCli('node', ['scripts/capture-debt-baseline.mjs'], {
      cwd: targetDir,
      timeoutMs: 600_000,
    })
    process.stdout.write(`${t('cli.init.baseline_captured')}\n`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (opts.fatal) {
      process.stderr.write(
        `  GATE FAIL: Baseline capture failed (${msg}). Fix toolchain or run: node scripts/capture-debt-baseline.mjs\n`,
      )
      process.exit(1)
    }
    getLogger().warn(
      'init.baseline_capture_failed',
      { err: msg },
      `Baseline capture failed (${msg}). Re-run manually: node scripts/capture-debt-baseline.mjs`,
    )
  }
}

/**
 * Post-write presence guard (M1/#1491). A generator result with action
 * `created`/`replaced`/`backed-up-and-replaced` asserts a file was written; if it
 * is not on disk the emission silently lost content. `skipped` files (including
 * `reason: 'not-applicable'` deliberate non-emissions and skipIfExists preserves)
 * are exempt — they are not expected to be (re)written.
 */
export function assertEmittedFilesPresent(results: WriteResult[]): void {
  const missing = results
    .filter((r) => r.action !== 'skipped' && r.action !== 'dry-run')
    .filter((r) => !existsSync(r.path))
    .map((r) => r.path)
  if (missing.length > 0) {
    throw new Error(
      `Emission integrity check failed — ${missing.length} file(s) reported written but ` +
        `not found on disk:\n${missing.map((p) => `    - ${p}`).join('\n')}\n` +
        `This is a generator bug (content silently dropped). Re-run init or file an issue.`,
    )
  }
}

export function printResults(results: WriteResult[], targetDir: string): void {
  for (const result of results) {
    // not-applicable files were deliberately NOT emitted — do not list them as
    // "skipped — already exists" (false claim on a clean project, M1/#1491).
    if (result.reason === 'not-applicable') continue
    const icon = result.action === 'skipped' ? '│  ' : '├──'
    const label =
      result.action === 'skipped'
        ? ' (skipped — already exists)'
        : result.action === 'backed-up-and-replaced'
          ? ' (backed up + replaced)'
          : ''
    const relPath = result.path.replace(targetDir + '/', '')
    process.stdout.write(`${t('cli.init.file_entry', { icon, relPath, label })}\n`)
  }
}

export function displayDryRunPreview(config: ProjectConfig): void {
  const preview = computeDryRunPreview(config)
  process.stdout.write(`${t('cli.init.dry_run_notice_full')}\n`)

  if (preview.created.length > 0) {
    process.stdout.write(`${t('cli.init.dry_run_create_header')}\n`)
    for (const entry of preview.created) {
      process.stdout.write(`${t('cli.init.dry_run_create_file', { entry })}\n`)
    }
  }
  if (preview.modified.length > 0) {
    process.stdout.write(`${t('cli.init.dry_run_modify_header')}\n`)
    for (const entry of preview.modified) {
      process.stdout.write(`${t('cli.init.dry_run_modify_file', { entry })}\n`)
    }
  }
  if (preview.skipped.length > 0) {
    process.stdout.write(`${t('cli.init.dry_run_skip_header')}\n`)
    for (const entry of preview.skipped) {
      process.stdout.write(`${t('cli.init.dry_run_skip_file', { entry })}\n`)
    }
  }

  process.stdout.write(`${t('cli.init.dry_run_run_hint')}\n`)
}
