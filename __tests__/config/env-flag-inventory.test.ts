// SPDX-License-Identifier: Apache-2.0
// Inventory guard for the ARBITER_* env-flag registry (#1538).
//
// Fails when a raw `process.env['ARBITER_…']` (or string-literal) read in `src/`
// or `scripts/` targets a flag name that is NOT declared in
// `src/config/env-registry.ts`. This is the typo / undocumented-flag drift guard:
// a fat-fingered or unregistered gate-bypass switch silently no-ops at runtime,
// so the only safe place to catch it is statically, here.
//
// Pure node:fs (no shell exec) per INV-12 / CANON-12 (check-no-direct-spawn.mjs).
// Paths anchored to repo root via import.meta.url — independent of process.cwd().

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  ARBITER_ENV_FLAGS,
  KNOWN_ARBITER_FLAGS,
  getBoolFlag,
  type EnvFlagType,
} from '../../src/config/env-registry.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')

/** Repo-relative path for readable failure messages. */
function rel(file: string): string {
  return file.startsWith(ROOT) ? file.slice(ROOT.length).replace(/^\//, '') : file
}

const SCAN_DIRS = ['src', 'scripts']
const EXTS = ['.ts', '.mts', '.cts', '.mjs', '.js', '.ejs']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])
// The registry itself declares every name as a string literal — exclude it, and
// exclude this test (it embeds the patterns in its own regex source).
const EXCLUDE = new Set([join(ROOT, 'src/config/env-registry.ts'), fileURLToPath(import.meta.url)])

// Env-flag read forms: process.env access, aliased `env` access, shell `${VAR}`,
// and quoted string-literal names passed to env-reading helpers (parseTimeoutEnv,
// checkBypass, …). Any of these is a flag reference by naming convention.
const READ_PATTERNS: readonly RegExp[] = [
  /process\.env(?:\.(ARBITER_[A-Z0-9_]+)|\[\s*['"`](ARBITER_[A-Z0-9_]+)['"`]\s*\])/g,
  /(?<![.\w])env(?:\.(ARBITER_[A-Z0-9_]+)|\[\s*['"`](ARBITER_[A-Z0-9_]+)['"`]\s*\])/g,
  /\$\{?(ARBITER_[A-Z0-9_]+)/g,
  /['"`](ARBITER_[A-Z0-9_]+(?:__)?)['"`]/g,
]

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(p, out)
    } else if (EXTS.some((ext) => entry.name.endsWith(ext)) && !EXCLUDE.has(p)) {
      out.push(p)
    }
  }
}

/** Map of every scanned ARBITER_* flag name → first file it was read in. */
function scanEnvFlagReads(): Map<string, string> {
  const files: string[] = []
  for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files)

  const found = new Map<string, string>()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const re of READ_PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const name = m[1] ?? m[2] ?? m[3]
        if (name && !found.has(name)) found.set(name, rel(file))
      }
    }
  }
  return found
}

describe('ARBITER_* env-flag registry — inventory guard (#1538)', () => {
  const scanned = scanEnvFlagReads()

  it('the scanner actually finds env-flag reads (guards against a vacuous pass)', () => {
    expect(scanned.size).toBeGreaterThanOrEqual(20)
    // Sentinels: known gate-bypass reads must be discoverable.
    expect(scanned.has('ARBITER_SKIP_TDD')).toBe(true)
    expect(scanned.has('ARBITER_SSOT_BYPASS')).toBe(true)
  })

  it('every ARBITER_* read in src/ + scripts/ is declared in the registry', () => {
    const unregistered = [...scanned.entries()]
      .filter(([name]) => !KNOWN_ARBITER_FLAGS.has(name))
      .map(([name, file]) => `${name} (first read in ${file})`)
    expect(
      unregistered,
      `Unregistered ARBITER_* flag(s) found. Add them to src/config/env-registry.ts:\n  ${unregistered.join('\n  ')}`,
    ).toEqual([])
  })
})

describe('ARBITER_* env-flag registry — well-formedness', () => {
  const VALID_TYPES = new Set<EnvFlagType>(['boolean', 'number', 'string', 'enum', 'prefix'])

  it('flag names are unique', () => {
    const names = ARBITER_ENV_FLAGS.map((f) => f.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every flag name starts with ARBITER_ and has a non-empty purpose', () => {
    for (const f of ARBITER_ENV_FLAGS) {
      expect(f.name.startsWith('ARBITER_'), `${f.name} must start with ARBITER_`).toBe(true)
      expect(f.purpose.length, `${f.name} must have a purpose`).toBeGreaterThan(0)
    }
  })

  it('every flag type is valid; enum flags declare their values', () => {
    for (const f of ARBITER_ENV_FLAGS) {
      expect(VALID_TYPES.has(f.type), `${f.name} has invalid type ${f.type}`).toBe(true)
      if (f.type === 'enum') {
        expect((f.enumValues?.length ?? 0) > 0, `${f.name} enum must list values`).toBe(true)
      }
    }
  })

  it('the gate-bypass surface (isGateBypass) is fully boolean-typed', () => {
    for (const f of ARBITER_ENV_FLAGS) {
      if (f.isGateBypass) {
        expect(f.type, `${f.name} is a gate bypass and must be boolean`).toBe('boolean')
      }
    }
    // The registry must actually contain bypass flags (the highest-stakes surface).
    expect(ARBITER_ENV_FLAGS.some((f) => f.isGateBypass)).toBe(true)
  })
})

describe('getBoolFlag — typed boolean getter', () => {
  it('parses truthy/falsy forms consistently via parseBooleanEnv', () => {
    expect(getBoolFlag('ARBITER_SKIP_TDD', { ARBITER_SKIP_TDD: '1' })).toBe(true)
    expect(getBoolFlag('ARBITER_SKIP_TDD', { ARBITER_SKIP_TDD: 'true' })).toBe(true)
    expect(getBoolFlag('ARBITER_SKIP_TDD', { ARBITER_SKIP_TDD: 'on' })).toBe(true)
    expect(getBoolFlag('ARBITER_SKIP_TDD', { ARBITER_SKIP_TDD: '0' })).toBe(false)
    expect(getBoolFlag('ARBITER_SKIP_TDD', { ARBITER_SKIP_TDD: 'false' })).toBe(false)
  })

  it('falls back to the declared default when unset or unrecognised', () => {
    expect(getBoolFlag('ARBITER_SKIP_TDD', {})).toBe(false)
    expect(getBoolFlag('ARBITER_SKIP_TDD', { ARBITER_SKIP_TDD: 'maybe' })).toBe(false)
  })

  it('throws for an unregistered or non-boolean flag name (the typo guard)', () => {
    expect(() => getBoolFlag('ARBITER_NOT_A_REAL_FLAG', {})).toThrow(/not a registered boolean/)
    expect(() => getBoolFlag('ARBITER_LOG_LEVEL', {})).toThrow(/not a registered boolean/)
  })
})
