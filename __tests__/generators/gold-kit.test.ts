// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit test for src/generators/gold-kit.ts (#1419).
// CANON-04: render test for src/templates/scripts/gold-audit.mjs.ejs + standards/*.ejs.
// CANON-11: brownfield / skipIfExists test for the file-emitting generator.
//
// #1419: downstream gold-audit thin runner + consumer-DATA registries. The thin
// runner delegates to `npx arbiter gold-audit --check` (mirrors the W1 INV-128
// conformance.mjs.ejs precedent); the standards/* files are genuine per-project
// data so `arbiter init`/`update` install them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'
import { generateGoldKit } from '../../src/generators/gold-kit.js'
import { generateCheckAll } from '../../src/generators/check-all.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

// ─── CANON-05: generator unit tests ──────────────────────────────────────────

describe('generateGoldKit (#1419, CANON-05)', () => {
  it('emits scripts/gold-audit.mjs to the target project', () => {
    const config = makeConfig(dir)
    const result = generateGoldKit(config)
    const f = result.files.find((f) => f.path.endsWith('scripts/gold-audit.mjs'))
    expect(f).toBeDefined()
    expect(existsSync(f!.path)).toBe(true)
  })

  it('emits the consumer-data standards (registry, thresholds, doc-set, doc-profile)', () => {
    const config = makeConfig(dir)
    generateGoldKit(config)
    expect(existsSync(join(dir, 'standards', 'gold-registry.yml'))).toBe(true)
    expect(existsSync(join(dir, 'standards', 'thresholds.yml'))).toBe(true)
    expect(existsSync(join(dir, 'standards', 'gold-doc-set.yml'))).toBe(true)
    expect(existsSync(join(dir, 'standards', 'doc-profile'))).toBe(true)
  })

  it('emits a per-stack registry for the project language (typescript)', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGoldKit(config)
    expect(existsSync(join(dir, 'standards', 'gold-registry.typescript.yml'))).toBe(true)
  })

  it('emits the java per-stack registry for java projects', () => {
    const jdir = createTestProject('java')
    try {
      const config = makeConfig(jdir, { language: 'java' })
      generateGoldKit(config)
      expect(existsSync(join(jdir, 'standards', 'gold-registry.java.yml'))).toBe(true)
    } finally {
      cleanupTestProject(jdir)
    }
  })

  it('emitted thin runner delegates to `arbiter gold-audit` via npx', () => {
    const config = makeConfig(dir)
    generateGoldKit(config)
    const content = readFileSync(join(dir, 'scripts', 'gold-audit.mjs'), 'utf-8')
    expect(content).toContain('arbiter')
    expect(content).toContain('gold-audit')
    expect(content).toContain('npx')
  })

  it('emitted thin runner contains SPDX header', () => {
    const config = makeConfig(dir)
    generateGoldKit(config)
    const content = readFileSync(join(dir, 'scripts', 'gold-audit.mjs'), 'utf-8')
    expect(content).toContain('SPDX-License-Identifier: Apache-2.0')
  })

  it('does NOT emit a .gold-audit-baseline.json seed (no day-1 redness)', () => {
    const config = makeConfig(dir)
    generateGoldKit(config)
    expect(existsSync(join(dir, '.gold-audit-baseline.json'))).toBe(false)
  })

  it('respects dryRun — no files written to disk', () => {
    const config = makeConfig(dir)
    generateGoldKit(config, { dryRun: true })
    expect(existsSync(join(dir, 'scripts', 'gold-audit.mjs'))).toBe(false)
    expect(existsSync(join(dir, 'standards', 'gold-registry.yml'))).toBe(false)
  })
})

// ─── CANON-04: template render tests ─────────────────────────────────────────

describe('gold-audit.mjs.ejs render (CANON-04, #1419)', () => {
  it('renders without error and produces non-empty content', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('scripts/gold-audit.mjs.ejs', config)
    expect(content.trim().length).toBeGreaterThan(0)
  })

  it('rendered output starts with shebang', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('scripts/gold-audit.mjs.ejs', config)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env node')
  })

  it('rendered output passes node --check (syntax-valid JS)', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('scripts/gold-audit.mjs.ejs', config)
    const scriptPath = join(dir, 'scripts', 'gold-audit-render-check.mjs')
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(scriptPath, content)
    const r = spawnSync('node', ['--check', scriptPath], { encoding: 'utf-8' })
    expect(r.status, `node --check failed:\n${r.stderr}`).toBe(0)
  })

  it('delegates with --check (no --require-baseline downstream)', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('scripts/gold-audit.mjs.ejs', config)
    expect(content).toContain('--check')
    expect(content).not.toContain('--require-baseline')
  })

  it('standards/gold-registry.yml.ejs renders valid non-empty YAML-ish content', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('standards/gold-registry.yml.ejs', config)
    expect(content).toContain('checks:')
    expect(content).toContain('GA-DOC-01')
  })

  it('standards/thresholds.yml.ejs renders the per-class threshold table', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('standards/thresholds.yml.ejs', config)
    expect(content).toContain('thresholds:')
    expect(content).toContain('gold:')
  })
})

// ─── CANON-11: brownfield / skipIfExists test ─────────────────────────────────

describe('generateGoldKit brownfield re-init (CANON-11)', () => {
  it('skipIfExists: a customised registry is NOT overwritten on re-run', () => {
    const config = makeConfig(dir)
    generateGoldKit(config)
    const custom = '# customised by team\nversion: x\n'
    writeFileSync(join(dir, 'standards', 'gold-registry.yml'), custom)
    const second = generateGoldKit(config)
    const skipped = second.files.find((f) => f.path.endsWith('standards/gold-registry.yml'))
    expect(skipped?.action).toBe('skipped')
    expect(readFileSync(join(dir, 'standards', 'gold-registry.yml'), 'utf-8')).toBe(custom)
  })
})

// ─── CANON-11: UNCONDITIONAL_EMISSIONS includes the gold thin runner ─────────

describe('generateCheckAll UNCONDITIONAL_EMISSIONS (#1419, CANON-11)', () => {
  it('generateCheckAll includes scripts/gold-audit.mjs', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    const result = generateCheckAll(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/gold-audit.mjs'))).toBe(true)
  })

  it('generated check-all.mjs wires gold-audit ADVISORY (runWarnCheck, plain --check)', () => {
    const config = makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' })
    generateCheckAll(config)
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('gold-audit.mjs')
    expect(checkAll).toContain('runWarnCheck')
    // NEVER --require-baseline downstream (would HARD-FAIL a fresh consumer).
    expect(checkAll).not.toContain('--require-baseline')
  })
})

// ─── #1419 ACCEPTANCE: a fresh consumer bootstraps with NO day-1 redness ──────
// Render the templated consumer-DATA registry + thresholds into a fresh tree, then
// run the bundled engine (what `arbiter gold-audit --check` delegates to) and assert
// the first run bootstraps (exit 0) and the second run holds no-regress (exit 0).
describe('downstream gold-audit acceptance (#1419)', () => {
  it('templated registry + engine --check bootstraps clean, then holds no-regress', () => {
    const config = makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' })
    generateGoldKit(config)
    writeFileSync(join(dir, 'README.md'), '# fresh consumer\n')

    const engine = resolve('scripts/gold-audit.mjs')
    const first = spawnSync('node', [engine, '--check'], { cwd: dir, encoding: 'utf-8' })
    expect(first.status, `bootstrap failed:\n${first.stdout}\n${first.stderr}`).toBe(0)
    expect(existsSync(join(dir, '.gold-audit-baseline.json'))).toBe(true)

    const second = spawnSync('node', [engine, '--check'], { cwd: dir, encoding: 'utf-8' })
    expect(second.status, `no-regress failed:\n${second.stdout}\n${second.stderr}`).toBe(0)
  })
})
