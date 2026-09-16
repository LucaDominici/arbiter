#!/usr/bin/env node
// #1121: every settable path in configure.ts ALLOWED_PATHS MUST appear in the
// settings.ts SETTINGS_CATALOG (and vice versa). Drift = build failure, so
// `arbiter configure show` can never silently omit a configurable path.
// CATALOG: reconciles configure.ts ALLOWED_PATHS against settings.ts SETTINGS_CATALOG.
// CATALOG: rejected fold-in into check-command-tests.mjs (tests-per-command, not field coverage).
// CATALOG: rejected fold-in into gen-cli-ref (command-level docs, not the settable-path catalog).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()

// ALLOWED_PATHS = new Set([ '...', '...' ]) — extract the quoted entries.
function allowedPaths(src) {
  const m = src.match(/ALLOWED_PATHS\s*=\s*new Set\(\[([\s\S]*?)\]\)/)
  if (!m) throw new Error('ALLOWED_PATHS not found in configure.ts')
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
}

// SETTINGS_DEFINITIONS entries default to editable; non-editable rows declare
// their classification explicitly and may describe unavailable/internal state.
function catalogRows(src) {
  const m = src.match(/SETTINGS_DEFINITIONS[\s\S]*?\n\]/)
  if (!m) throw new Error('SETTINGS_DEFINITIONS not found in settings.ts')
  const matches = [...m[0].matchAll(/path:\s*'([^']+)'([\s\S]*?)(?=\n\s*\{\s*path:|\n\s*\],)/g)]
  return new Map(
    matches.map((entry) => [
      entry[1],
      entry[2].match(/classification:\s*'([^']+)'/)?.[1] ?? 'editable',
    ]),
  )
}

function main() {
  const configureSrc = readFileSync(resolve(root, 'src/commands/configure.ts'), 'utf-8')
  const settingsSrc = readFileSync(resolve(root, 'src/commands/settings.ts'), 'utf-8')

  const allowed = allowedPaths(configureSrc)
  const catalog = catalogRows(settingsSrc)

  // Fail closed: an empty extraction means the source shape changed and the
  // check would otherwise pass vacuously.
  if (allowed.size === 0) throw new Error('extracted zero ALLOWED_PATHS — parser out of date')

  let violations = 0
  for (const p of [...allowed].filter((x) => catalog.get(x) !== 'editable')) {
    process.stdout.write(`  MISSING editable SETTINGS_CATALOG row: ${p}\n`)
    violations++
  }
  for (const [p, classification] of catalog) {
    if (classification !== 'editable' || allowed.has(p)) continue
    process.stdout.write(`  EDITABLE row is not an ALLOWED_PATH: ${p}\n`)
    violations++
  }

  if (violations > 0) {
    process.stdout.write(
      `[check-settings-coverage] FAIL: ${violations} settings-coverage drift(s) between configure.ts and settings.ts\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `[check-settings-coverage] OK — all ${allowed.size} settable paths have editable catalog rows\n`,
  )
}

try {
  main()
} catch (err) {
  process.stderr.write(
    `[check-settings-coverage] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
