// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit test for src/generators/conformance.ts (#1398, INV-128).
// CANON-04: render test for src/templates/scripts/conformance.mjs.ejs.
// CANON-11: brownfield / skipIfExists test for the file-emitting generator.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'
import { generateConformanceScript } from '../../src/generators/conformance.js'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { buildRegistry } from '../../src/generators/registry.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

/** Normalise an absolute emitted path to a POSIX-style path relative to the project dir. */
function relPathOf(base: string, abs: string): string {
  return abs.startsWith(base)
    ? abs
        .slice(base.length)
        .replace(/^[/\\]/, '')
        .replace(/\\/g, '/')
    : abs
}

/** Keys of the enabled registry generators that emit a given relative path (dryRun). */
function registryEmittersOf(config: ReturnType<typeof makeConfig>, relPath: string): string[] {
  const emitters: string[] = []
  for (const spec of buildRegistry(config)) {
    if (!spec.enabled) continue
    const hit = spec
      .run({ dryRun: true })
      .some((f) => relPathOf(config.targetDir, f.path) === relPath)
    if (hit) emitters.push(spec.key)
  }
  return emitters
}

// ─── CANON-05: generator unit tests ──────────────────────────────────────────

describe('generateConformanceScript (#1398, CANON-05)', () => {
  it('emits scripts/conformance.mjs to the target project', () => {
    const config = makeConfig(dir)
    const result = generateConformanceScript(config)
    const scriptFile = result.files.find((f) => f.path.endsWith('scripts/conformance.mjs'))
    expect(scriptFile).toBeDefined()
    expect(existsSync(scriptFile!.path)).toBe(true)
  })

  it('emits exactly one file', () => {
    const config = makeConfig(dir)
    const result = generateConformanceScript(config)
    expect(result.files).toHaveLength(1)
  })

  it('emitted script contains arbiter conformance invocation', () => {
    const config = makeConfig(dir)
    generateConformanceScript(config)
    const content = readFileSync(join(dir, 'scripts', 'conformance.mjs'), 'utf-8')
    expect(content).toContain('arbiter')
    expect(content).toContain('conformance')
  })

  it('emitted script contains SPDX header', () => {
    const config = makeConfig(dir)
    generateConformanceScript(config)
    const content = readFileSync(join(dir, 'scripts', 'conformance.mjs'), 'utf-8')
    expect(content).toContain('SPDX-License-Identifier: Apache-2.0')
  })

  it('respects dryRun — no file written to disk', () => {
    const config = makeConfig(dir)
    generateConformanceScript(config, { dryRun: true })
    expect(existsSync(join(dir, 'scripts', 'conformance.mjs'))).toBe(false)
  })
})

// ─── CANON-04: template render test ──────────────────────────────────────────

describe('conformance.mjs.ejs render (CANON-04)', () => {
  it('renders without error and produces non-empty content', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('scripts/conformance.mjs.ejs', config)
    expect(content.trim().length).toBeGreaterThan(0)
  })

  it('rendered output passes node --check (syntax-valid JS)', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('scripts/conformance.mjs.ejs', config)
    const scriptPath = join(dir, 'scripts', 'conformance-render-check.mjs')
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(scriptPath, content)
    const r = spawnSync('node', ['--check', scriptPath], { encoding: 'utf-8' })
    expect(r.status, `node --check failed:\n${r.stderr}`).toBe(0)
  })

  it('rendered output contains shebang on first line', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('scripts/conformance.mjs.ejs', config)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env node')
  })
})

// ─── CANON-11: brownfield / skipIfExists test ─────────────────────────────────

describe('generateConformanceScript brownfield re-init (CANON-11)', () => {
  it('skipIfExists: second run returns skipped action and does NOT overwrite existing file', () => {
    const config = makeConfig(dir)
    generateConformanceScript(config)
    const firstContent = readFileSync(join(dir, 'scripts', 'conformance.mjs'), 'utf-8')

    // Simulate a customised script
    const customContent = firstContent + '\n// customised by team\n'
    writeFileSync(join(dir, 'scripts', 'conformance.mjs'), customContent)

    const secondResult = generateConformanceScript(config)
    const skipped = secondResult.files.find((f) => f.path.endsWith('scripts/conformance.mjs'))
    expect(skipped?.action).toBe('skipped')
    // File should still contain customisation
    expect(readFileSync(join(dir, 'scripts', 'conformance.mjs'), 'utf-8')).toBe(customContent)
  })
})

// ─── #1578: sole-emitter — conformance owns scripts/conformance.mjs ───────────

describe('scripts/conformance.mjs sole emitter (#1578)', () => {
  // #1578: generateCheckAll must NOT also emit conformance.mjs — the dedicated
  // generateConformanceScript owner (which runs later in the registry) is the sole
  // emitter. A second always-on emitter re-introduced the #1318.2 double-write class:
  // a false "already exist" warning on fresh init + a duplicated, over-counted entry
  // in `arbiter diff`.
  it('generateCheckAll does NOT emit scripts/conformance.mjs (dedup, #1578)', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    const result = generateCheckAll(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/conformance.mjs'))).toBe(false)
  })

  it('conformance.mjs is emitted by exactly one enabled registry generator (#1578)', () => {
    const config = makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' })
    const emitters = registryEmittersOf(config, 'scripts/conformance.mjs')
    expect(emitters).toEqual(['conformance'])
  })

  it('gold-audit.mjs is emitted by exactly one enabled registry generator (#1578)', () => {
    const config = makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' })
    const emitters = registryEmittersOf(config, 'scripts/gold-audit.mjs')
    expect(emitters).toEqual(['gold-kit'])
  })

  // Durable guard for the #1318.2 / #1578 regression class: no relative path may be
  // produced by two distinct always-on (enabled) generators in a full registry run.
  it('no path is double-emitted across always-on registry generators (#1578)', () => {
    const config = makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' })
    const byPath = new Map<string, Set<string>>()
    for (const spec of buildRegistry(config)) {
      if (!spec.enabled) continue
      for (const f of spec.run({ dryRun: true })) {
        const rel = relPathOf(config.targetDir, f.path)
        const keys = byPath.get(rel) ?? new Set<string>()
        keys.add(spec.key)
        byPath.set(rel, keys)
      }
    }
    const duplicated = [...byPath.entries()]
      .filter(([, keys]) => keys.size > 1)
      .map(([rel, keys]) => `${rel} ← ${[...keys].join(', ')}`)
    expect(duplicated).toEqual([])
  })

  it('generated check-all.mjs L2 still wires conformance advisory (#1578)', () => {
    const config = makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' })
    generateCheckAll(config)
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('conformance.mjs')
    expect(checkAll).toContain('runWarnCheck')
  })
})

// ─── INV-128 id-stability: catalog entry ─────────────────────────────────────

describe('INV-128 id-stability (catalog)', () => {
  it('catalog has exactly 1 entry with id INV-128', () => {
    const entries = INVARIANT_CATALOG.filter((inv) => inv.id === 'INV-128')
    expect(entries).toHaveLength(1)
  })

  it('INV-128 has selfOnly: false (targets, not just arbiter-self)', () => {
    const inv = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-128')
    expect(inv?.selfOnly).toBe(false)
  })

  it('INV-128 is operational tier', () => {
    const inv = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-128')
    expect(inv?.tier).toBe('operational')
  })

  it('INV-128 has minGovernanceLevel L1', () => {
    const inv = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-128')
    expect(inv?.minGovernanceLevel).toBe('L1')
  })
})
