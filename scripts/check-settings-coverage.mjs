#!/usr/bin/env node
// #1121: every settable path in configure.ts ALLOWED_PATHS MUST appear in the
// settings.ts SETTINGS_CATALOG (and vice versa). Drift = build failure, so
// `arbiter settings` can never silently omit a configurable path.
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

// SETTINGS_CATALOG entries use `path: '...'`.
function catalogPaths(src) {
  const m = src.match(/SETTINGS_CATALOG[\s\S]*?\n\]/)
  if (!m) throw new Error('SETTINGS_CATALOG not found in settings.ts')
  return new Set([...m[0].matchAll(/path:\s*'([^']+)'/g)].map((x) => x[1]))
}

function main() {
  const configureSrc = readFileSync(resolve(root, 'src/commands/configure.ts'), 'utf-8')
  const settingsSrc = readFileSync(resolve(root, 'src/commands/settings.ts'), 'utf-8')

  const allowed = allowedPaths(configureSrc)
  const catalog = catalogPaths(settingsSrc)

  // Fail closed: an empty extraction means the source shape changed and the
  // check would otherwise pass vacuously.
  if (allowed.size === 0) throw new Error('extracted zero ALLOWED_PATHS — parser out of date')

  let violations = 0
  for (const p of [...allowed].filter((x) => !catalog.has(x))) {
    process.stdout.write(`  MISSING from settings.ts SETTINGS_CATALOG: ${p}\n`)
    violations++
  }
  for (const p of [...catalog].filter((x) => !allowed.has(x))) {
    process.stdout.write(`  EXTRA in settings.ts (not an ALLOWED_PATH): ${p}\n`)
    violations++
  }

  if (violations > 0) {
    process.stdout.write(
      `[check-settings-coverage] FAIL: ${violations} settings-coverage drift(s) between configure.ts and settings.ts\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `[check-settings-coverage] OK — all ${allowed.size} settable paths surfaced in arbiter settings\n`,
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
