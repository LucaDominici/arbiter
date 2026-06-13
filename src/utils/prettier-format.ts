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

// Resolve the prettier invocation (binary + base args + config args) for targetDir.
// Prefers arbiter's own bundled prettier (deterministic — a fresh target scaffold has
// no node_modules yet); falls back to the target's prettier via `npx --no-install`.
function resolvePrettierInvocation(targetDir: string): {
  cmd: string
  baseArgs: string[]
  configArgs: string[]
} {
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
  return { cmd, baseArgs, configArgs }
}

/**
 * Format `content` IN-MEMORY (via `prettier --stdin-filepath`) and return the
 * formatted string. Unlike a post-write `prettier --write` (which rewrites the file
 * on disk AFTER its render hash was recorded — desyncing the generated-manifest,
 * #1349), this lets a generator format BEFORE `writeFile`, so the recorded hash
 * matches the bytes that land on disk by construction.
 *
 * Best-effort: returns the original `content` unchanged when prettier is absent or
 * the format fails (e.g. a non-prettier file type), so callers never break.
 */
export function formatContent(content: string, filePath: string, targetDir: string): string {
  const { cmd, baseArgs, configArgs } = resolvePrettierInvocation(targetDir)
  try {
    const { stdout } = runCli(cmd, [...baseArgs, '--stdin-filepath', filePath, ...configArgs], {
      cwd: targetDir,
      timeoutMs: 30_000,
      input: content,
    })
    return stdout
  } catch (err) {
    const notFound = err instanceof CliError && err.notFound
    if (!notFound) {
      getLogger().warn(
        'prettier_format.failed',
        { filePath, err: String(err) },
        'formatContent: prettier --stdin-filepath failed (best-effort, returning unformatted)',
      )
    }
    return content
  }
}
