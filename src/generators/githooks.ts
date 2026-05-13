import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GithooksGeneratorResult {
  files: WriteResult[]
}

const HOOK_MODE = 0o755

function writeHook(filePath: string, content: string): WriteResult {
  const result = writeFile(filePath, content, { skipIfExists: true })
  if (result.action !== 'skipped') {
    chmodSync(filePath, HOOK_MODE)
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
function injectPrepareScript(targetDir: string): void {
  const pkgPath = resolvedPath(targetDir, 'package.json')
  if (!existsSync(pkgPath)) return

  const raw = readFileSync(pkgPath, 'utf-8')
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // Malformed package.json — skip injection
    return
  }

  const hooksCmd = 'git config core.hooksPath .githooks'
  const scripts = (pkg.scripts ?? {}) as Record<string, string>

  const existing = scripts.prepare ?? ''
  if (existing.includes(hooksCmd)) {
    // Already injected — idempotent
    return
  }

  scripts.prepare = existing ? `${existing} && ${hooksCmd}` : hooksCmd
  pkg.scripts = scripts

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
}

export function generateGithooks(config: ProjectConfig): GithooksGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config as unknown as Record<string, unknown>

  const hooksDir = resolvedPath(base, '.githooks')

  results.push(
    writeHook(
      resolvedPath(hooksDir, 'pre-commit'),
      renderTemplate('githooks/pre-commit.ejs', data),
    ),
  )

  results.push(
    writeHook(resolvedPath(hooksDir, 'pre-push'), renderTemplate('githooks/pre-push.ejs', data)),
  )

  results.push(
    writeHook(
      resolvedPath(hooksDir, 'commit-msg'),
      renderTemplate('githooks/commit-msg.ejs', data),
    ),
  )

  if (isTypeScript(config)) {
    // TypeScript: auto-wire via package.json prepare script
    injectPrepareScript(base)
  } else {
    // Non-Node stacks: emit setup-hooks.sh
    const setupPath = resolvedPath(base, 'scripts', 'setup-hooks.sh')
    const setupResult = writeFile(setupPath, renderTemplate('githooks/setup-hooks.sh.ejs', data), {
      skipIfExists: true,
    })
    if (setupResult.action !== 'skipped') {
      chmodSync(setupPath, HOOK_MODE)
    }
    results.push(setupResult)
  }

  return { files: results }
}
