// SPDX-License-Identifier: Apache-2.0
// Post-emit prettier helper — apply target project's prettier config to a generated file
// so the file conforms to the target project's style, not arbiter's internal style (#933 F13).
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runCli, CliError } from './run-cli.js'
import { getLogger } from './logger.js'

/**
 * Resolve the prettier CLI entrypoint installed in arbiter's own dependency tree.
 * Prettier is a runtime `dependency` (package.json), so this resolves in every
 * published install — `npm i -g`/`npx` materialise `dependencies`. Returns null
 * only in a degraded tree where the package is somehow absent, so callers stay
 * best-effort rather than throwing (#1651).
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

// Arbiter's own scaffolded default (src/templates/static-analysis/prettierrc.json.ejs)
// expressed as CLI flags. Fallback ONLY: several generators call formatContent()
// before the debt-gates generator (which emits .prettierrc.json) has run in the same
// init session — generator order is not format-config-aware — so `configFile` below
// can be legitimately absent even though the target IS about to get this exact
// config (#1491-class fix: a generator formatting against prettier's built-in
// defaults instead of the project's real style bakes in a render that the L1 gate's
// later `prettier --check .` — which DOES see the config by then — flags as dirty on
// Day 1). Every field in the template that already equals prettier's own default
// (tabWidth, trailingComma, bracketSpacing, arrowParens, endOfLine) is omitted here;
// keep this in sync with the template if that file's values change.
const ARBITER_DEFAULT_PRETTIER_ARGS = ['--single-quote', '--no-semi', '--print-width', '100']

// Resolve the prettier invocation (binary + config args) for targetDir, or null when the
// bundled binary is not resolvable. STRICTLY arbiter's own dependency-tree prettier: it
// ships as a runtime dependency, and a fresh target scaffold has no node_modules, so the
// target's own prettier was never a usable second source anyway. The former
// `npx --no-install prettier` fallback let npm resolve a REGISTRY version instead of the
// pinned one and printed `npx canceled due to missing packages ... ["prettier@x.y.z"]`
// into the gate dump — registry-driven version resolution is nondeterminism by design (#2032).
function resolvePrettierInvocation(
  targetDir: string,
): { bin: string; configArgs: string[] } | null {
  const ownBin = resolveOwnPrettierBin()
  if (ownBin === null) return null
  const prettierRc = join(targetDir, '.prettierrc')
  const prettierRcJson = join(targetDir, '.prettierrc.json')
  const configFile = existsSync(prettierRc)
    ? prettierRc
    : existsSync(prettierRcJson)
      ? prettierRcJson
      : null
  const configArgs: string[] = configFile ? ['--config', configFile] : ARBITER_DEFAULT_PRETTIER_ARGS
  return { bin: ownBin, configArgs }
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
  const invocation = resolvePrettierInvocation(targetDir)
  if (invocation === null) return content
  const { bin, configArgs } = invocation
  try {
    const { stdout } = runCli('node', [bin, '--stdin-filepath', filePath, ...configArgs], {
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
