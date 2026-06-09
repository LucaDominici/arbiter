// SPDX-License-Identifier: Apache-2.0
// Post-emit prettier helper — apply target project's prettier config to a generated file
// so the file conforms to the target project's style, not arbiter's internal style (#933 F13).
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runCli, CliError } from './run-cli.js'
import { getLogger } from './logger.js'

/**
 * Resolve the prettier CLI entrypoint bundled with arbiter's own dependency tree.
 * Returns null when prettier is not installed alongside arbiter (production installs
 * where prettier is a devDependency).
 */
function resolveOwnPrettierBin(): string | null {
  try {
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('prettier/package.json')
    const bin = join(dirname(pkgPath), 'bin/prettier.cjs')
    return existsSync(bin) ? bin : null
  } catch {
    return null
  }
}

/**
 * Run `prettier --write` on `filePath` using the target project's `.prettierrc`
 * (or `.prettierrc.json`) config. Best-effort: warns on failure but never throws.
 *
 * Prefers arbiter's own bundled prettier (deterministic — a fresh target scaffold
 * has no node_modules yet, and `npx` resolution from the target dir silently depends
 * on the npx cache matching the registry's latest version). Falls back to the
 * target's own prettier via `npx --no-install`, and skips silently when neither
 * is available.
 *
 * Called after emitting static template files that use arbiter's internal code style
 * (single-quotes, no-semicolons) when the target project may have different style settings.
 */
export function prettierFormat(filePath: string, targetDir: string): void {
  const prettierRc = join(targetDir, '.prettierrc')
  const prettierRcJson = join(targetDir, '.prettierrc.json')
  const configFile = existsSync(prettierRc)
    ? prettierRc
    : existsSync(prettierRcJson)
      ? prettierRcJson
      : null
  const configArgs: string[] = configFile ? ['--config', configFile] : []
  const ownBin = resolveOwnPrettierBin()
  const [cmd, baseArgs]: [string, string[]] = ownBin
    ? ['node', [ownBin]]
    : ['npx', ['--no-install', 'prettier']]
  try {
    runCli(cmd, [...baseArgs, '--write', ...configArgs, filePath], {
      cwd: targetDir,
      timeoutMs: 30_000,
    })
  } catch (err) {
    const notFound = err instanceof CliError && err.notFound
    if (notFound) return // prettier not installed in target — silently skip
    getLogger().warn(
      'prettier_format.failed',
      { filePath, err: String(err) },
      'prettierFormat: prettier --write failed (best-effort, continuing)',
    )
  }
}
