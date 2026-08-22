#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Gate: verify every .mjs file in .claude/hooks/ is documented in
 * docs/internal/SYSTEM/HOOK-CONTRACTS.md and vice-versa, AND that every one of them
 * actually LOADS (#2324).
 *
 * Exits 1 if any hook is undocumented, any doc entry has no matching file, or any hook
 * fails to load.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// `--root <dir>` (same convention as probe-hooks.mjs) exists so the checks below can be
// driven over a fixture tree with a planted defect — a gate never observed to flip is a
// gate nobody has verified. Defaults to this repo.
const rootFlag = process.argv.indexOf('--root')
const root =
  rootFlag !== -1 && process.argv[rootFlag + 1] !== undefined
    ? resolve(process.argv[rootFlag + 1])
    : resolve(import.meta.dirname, '..')
const hooksDir = join(root, '.claude', 'hooks')
const docPath = join(root, 'docs', 'internal', 'SYSTEM', 'HOOK-CONTRACTS.md')

if (!existsSync(docPath)) {
  process.stderr.write(`check-hook-contracts: HOOK-CONTRACTS.md not found at ${docPath}\n`)
  process.exit(1)
}

// Collect .mjs filenames from the hooks directory
const filesInDir = new Set(
  readdirSync(hooksDir)
    .filter((f) => f.endsWith('.mjs'))
    .sort(),
)

// Collect hook filenames referenced in the doc (backtick-quoted *.mjs)
const docContent = readFileSync(docPath, 'utf-8')
const docMatches = docContent.matchAll(/`([a-z][a-z0-9-]*\.mjs)`/g)
const filesInDoc = new Set([...docMatches].map((m) => m[1]))

/**
 * #2324 — a hook that cannot LOAD enforces nothing. `pre-edit-ssot-guard.mjs` imported
 * `isPathInThisRepo` from a `.claude/hooks/lib.mjs` that never exported it and crashed on
 * every Edit/Write for 18 days; the whole-file divergence pin on `hooks/lib.mjs` hid the
 * drift, and the empirical suite builds its fixture from the TEMPLATE pair, so it is
 * self-consistent by construction and structurally cannot observe self-pair drift.
 *
 * Spawned as a child process, never `import()`ed: these hooks execute on load — the SSOT
 * guard calls `process.exit(0)` at top level, others read stdin and write files — so
 * importing them would terminate this checker or fire real side effects.
 *
 * The payload is deliberately `{}`. ESM resolution happens BEFORE any user code runs, so a
 * missing export or unresolvable specifier surfaces regardless of payload, while an empty
 * one makes every hook bail at its first field check instead of doing real work.
 *
 * Only a load failure is a failure here. A hook that exits 0 (allow) or 2 (block) is
 * healthy — that distinction is the whole check.
 */
const LOAD_FAILURE = [
  'SyntaxError',
  'does not provide an export named',
  'Cannot find module',
  'ERR_MODULE_NOT_FOUND',
  'ERR_UNSUPPORTED_DIR_IMPORT',
]

function loadFailureFor(file) {
  const result = spawnSync(process.execPath, [join(hooksDir, file)], {
    input: '{}',
    encoding: 'utf-8',
    timeout: 30_000,
    cwd: root,
  })
  if (result.error) return `could not spawn: ${result.error.message}`
  const stderr = result.stderr ?? ''
  const signature = LOAD_FAILURE.find((needle) => stderr.includes(needle))
  if (signature === undefined) return null
  const detail = stderr
    .split('\n')
    .find((line) => line.includes(signature))
    ?.trim()
  return detail !== undefined && detail !== '' ? detail : signature
}

const unloadable = [...filesInDir]
  .map((file) => ({ file, failure: loadFailureFor(file) }))
  .filter((row) => row.failure !== null)

const undocumented = [...filesInDir].filter((f) => !filesInDoc.has(f))
const phantom = [...filesInDoc].filter((f) => !filesInDir.has(f))

let ok = true

if (undocumented.length > 0) {
  process.stderr.write(
    `check-hook-contracts: hooks present in directory but missing from HOOK-CONTRACTS.md:\n` +
      undocumented.map((f) => `  - ${f}`).join('\n') +
      '\n',
  )
  ok = false
}

if (unloadable.length > 0) {
  process.stderr.write(
    `check-hook-contracts: hooks that FAIL TO LOAD (they enforce nothing):\n` +
      unloadable.map((r) => `  - ${r.file}: ${r.failure}`).join('\n') +
      '\n',
  )
  ok = false
}

if (phantom.length > 0) {
  process.stderr.write(
    `check-hook-contracts: hooks documented in HOOK-CONTRACTS.md but not found in directory:\n` +
      phantom.map((f) => `  - ${f}`).join('\n') +
      '\n',
  )
  ok = false
}

if (ok) {
  process.stdout.write(
    `check-hook-contracts: OK — ${filesInDir.size} hooks documented and loadable\n`,
  )
  process.exit(0)
} else {
  process.exit(1)
}
