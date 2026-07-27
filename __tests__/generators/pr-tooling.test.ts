// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit test for src/generators/pr-tooling.ts (#2098).
// CANON-04: render test for the scripts/*.ejs templates it emits.
// CANON-11: brownfield / skipIfExists test for the file-emitting generator.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'
import { generatePrTooling } from '../../src/generators/pr-tooling.js'
import { buildRegistry } from '../../src/generators/registry.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

const EMITTED = [
  'scripts/lib/exact-sha-policy.mjs',
  'scripts/lib/waiter-count.mjs',
  'scripts/pr-merge-watch.mjs',
  'scripts/capacity-probe.mjs',
]

// ─── CANON-05: generator unit tests ──────────────────────────────────────────

describe('generatePrTooling (#2098, CANON-05)', () => {
  it('emits every declared file to the target project', () => {
    const config = makeConfig(dir)
    const result = generatePrTooling(config)
    for (const rel of EMITTED) {
      const file = result.files.find((f) => f.path.endsWith(rel))
      expect(file, `missing ${rel}`).toBeDefined()
      expect(existsSync(file!.path)).toBe(true)
    }
  })

  it('emits exactly 4 files', () => {
    const config = makeConfig(dir)
    const result = generatePrTooling(config)
    expect(result.files).toHaveLength(4)
  })

  it.each(EMITTED)('%s contains SPDX header', (rel) => {
    const config = makeConfig(dir)
    generatePrTooling(config)
    const content = readFileSync(join(dir, rel), 'utf-8')
    expect(content).toContain('SPDX-License-Identifier: Apache-2.0')
  })

  it('emitted watcher uses atomic updateRefs and never the PR merge endpoint', () => {
    const config = makeConfig(dir)
    generatePrTooling(config)
    const content = readFileSync(join(dir, 'scripts/pr-merge-watch.mjs'), 'utf-8')
    expect(content).toContain("'gh'")
    expect(content).toContain('updateRefs')
    expect(content).not.toContain("'pr', 'merge'")
    expect(content).toContain('--self-test')
  })

  it('emitted capacity-probe.mjs imports the shared waiter-count helper', () => {
    const config = makeConfig(dir)
    generatePrTooling(config)
    const content = readFileSync(join(dir, 'scripts/capacity-probe.mjs'), 'utf-8')
    expect(content).toContain("from './lib/waiter-count.mjs'")
  })

  it('respects dryRun — no file written to disk', () => {
    const config = makeConfig(dir)
    generatePrTooling(config, { dryRun: true })
    for (const rel of EMITTED) {
      expect(existsSync(join(dir, rel))).toBe(false)
    }
  })
})

// ─── CANON-04: template render tests ─────────────────────────────────────────

describe('pr-tooling templates render (CANON-04)', () => {
  const templates = [
    'scripts/lib/waiter-count.mjs.ejs',
    'scripts/pr-merge-watch.mjs.ejs',
    'scripts/capacity-probe.mjs.ejs',
  ]

  it.each(templates)('%s renders without error and produces non-empty content', (tpl) => {
    const config = makeConfig(dir)
    const content = renderTemplate(tpl, config)
    expect(content.trim().length).toBeGreaterThan(0)
  })

  it.each(templates)('%s rendered output passes node --check (syntax-valid JS)', (tpl) => {
    const config = makeConfig(dir)
    const content = renderTemplate(tpl, config)
    mkdirSync(join(dir, 'render-check'), { recursive: true })
    const scriptPath = join(dir, 'render-check', `${tpl.replace(/\//g, '__')}.mjs`)
    writeFileSync(scriptPath, content)
    const r = spawnSync('node', ['--check', scriptPath], { encoding: 'utf-8' })
    expect(r.status, `node --check failed:\n${r.stderr}`).toBe(0)
  })

  it.each(templates)('%s rendered output contains shebang on first line', (tpl) => {
    const config = makeConfig(dir)
    const content = renderTemplate(tpl, config)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env node')
  })
})

// ─── CANON-11: brownfield / skipIfExists test ─────────────────────────────────

describe('generatePrTooling brownfield re-init (CANON-11)', () => {
  it.each(EMITTED)('%s: second run does NOT overwrite a customised file', (rel) => {
    const config = makeConfig(dir)
    generatePrTooling(config)
    const firstContent = readFileSync(join(dir, rel), 'utf-8')

    const customContent = `${firstContent}\n// customised by team\n`
    writeFileSync(join(dir, rel), customContent)

    const secondResult = generatePrTooling(config)
    const skipped = secondResult.files.find((f) => f.path.endsWith(rel))
    expect(skipped?.action).toBe('skipped')
    expect(readFileSync(join(dir, rel), 'utf-8')).toBe(customContent)
  })
})

// ─── sole-emitter / no double-write (mirrors #1578 regression class) ─────────

describe('pr-tooling files are emitted by exactly one always-on registry generator', () => {
  it.each(EMITTED)('%s has exactly one emitter: pr-tooling', (rel) => {
    const config = makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' })
    const emitters: string[] = []
    for (const spec of buildRegistry(config)) {
      if (!spec.enabled) continue
      const hit = spec.run({ dryRun: true }).some((f) => f.path.endsWith(rel))
      if (hit) emitters.push(spec.key)
    }
    expect(emitters).toEqual(['pr-tooling'])
  })
})
