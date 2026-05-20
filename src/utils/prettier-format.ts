// SPDX-License-Identifier: Apache-2.0
// Post-emit prettier helper — apply target project's prettier config to a generated file
// so the file conforms to the target project's style, not arbiter's internal style (#933 F13).
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { runCli, CliError } from './run-cli.js'
import { getLogger } from './logger.js'

/**
 * Run `prettier --write` on `filePath` using the target project's `.prettierrc`
 * (or `.prettierrc.json`) config. Best-effort: warns on failure but never throws.
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
  try {
    runCli('npx', ['--no-install', 'prettier', '--write', ...configArgs, filePath], {
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
