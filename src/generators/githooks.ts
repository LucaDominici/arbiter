// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { chmodTranslated, resolvedPath, writeFile } from '../utils/fs.js'
import { mutatePackageJson } from '../utils/pkg.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GithooksGeneratorResult {
  files: WriteResult[]
}

const HOOK_MODE = 0o755

function writeHook(filePath: string, content: string, dryRun: boolean): WriteResult {
  const result = writeFile(filePath, content, { skipIfExists: true, dryRun })
  if (!dryRun && result.action !== 'skipped') {
    chmodTranslated(filePath, HOOK_MODE)
  }
  return result
}

function isTypeScript(config: ProjectConfig): boolean {
  return config.language === 'typescript' || config.language === 'multi'
}

/**
 * Merge `git config core.hooksPath .githooks` into the prepare script of
 * package.json at targetDir. Idempotent: does nothing if already present.
 */
function injectPrepareScript(targetDir: string, dryRun: boolean): void {
  mutatePackageJson(targetDir, dryRun, (pkg) => {
    const hooksCmd = 'git config core.hooksPath .githooks'
    const scripts = (pkg.scripts ?? {}) as Record<string, string>

    const existing = scripts.prepare ?? ''
    if (existing.includes(hooksCmd)) {
      // Already injected — idempotent
      return false
    }

    scripts.prepare = existing ? `${existing} && ${hooksCmd}` : hooksCmd
    pkg.scripts = scripts
    return true
  })
}

export function generateGithooks(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): GithooksGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config

  const hooksDir = resolvedPath(base, '.githooks')

  results.push(
    writeHook(
      resolvedPath(hooksDir, 'pre-commit'),
      renderTemplate('githooks/pre-commit.ejs', data),
      opts.dryRun,
    ),
  )

  results.push(
    writeHook(
      resolvedPath(hooksDir, 'pre-push'),
      renderTemplate('githooks/pre-push.ejs', data),
      opts.dryRun,
    ),
  )

  results.push(
    writeHook(
      resolvedPath(hooksDir, 'commit-msg'),
      renderTemplate('githooks/commit-msg.ejs', data),
      opts.dryRun,
    ),
  )

  if (isTypeScript(config)) {
    // TypeScript: auto-wire via package.json prepare script
    injectPrepareScript(base, opts.dryRun)
  } else {
    // Non-Node stacks: emit setup-hooks.sh
    const setupPath = resolvedPath(base, 'scripts', 'setup-hooks.sh')
    const setupResult = writeFile(setupPath, renderTemplate('githooks/setup-hooks.sh.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    })
    if (!opts.dryRun && setupResult.action !== 'skipped') {
      chmodTranslated(setupPath, HOOK_MODE)
    }
    results.push(setupResult)
  }

  return { files: results }
}
