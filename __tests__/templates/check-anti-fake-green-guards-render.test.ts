// SPDX-License-Identifier: Apache-2.0
// Render tests (INV-48 / CANON-04) for the file-scan anti-fake-green guards shipped into generated
// projects (A5, #1497): check-muted-test, check-skip-critical-e2e, check-no-stub-redirects, and
// check-grace-window. Each proves the consumer template renders to a self-contained, EJS-tag-free,
// lib-free guard AND discriminates (RED on a planted defect, GREEN/NO-DATA clean) — the anti-vacuous
// proof that the guard is not a validator that always passes.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(tpl: string): string {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}

const GUARD_TEMPLATES = [
  'scripts/check-muted-test.mjs.ejs',
  'scripts/check-skip-critical-e2e.mjs.ejs',
  'scripts/check-no-stub-redirects.mjs.ejs',
  'scripts/check-grace-window.mjs.ejs',
]

describe('anti-fake-green file-scan guard templates (A5, #1497)', () => {
  it.each(GUARD_TEMPLATES)('renders %s as a self-contained, tag-free guard', (tpl) => {
    const content = render(tpl)
    expect(content).toMatch(/^#!/)
    expect(content).toContain('--help')
    expect(content).toContain('anti-fake-green')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
    // No lib import — must run in a project that has no arbiter install.
    expect(content).not.toContain("from './lib/")
  })

  function stage(tpl: string, name: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'afg-render-'))
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', name), render(tpl))
    return dir
  }
  const run = (dir: string, name: string): number =>
    spawnSync('node', [join('scripts', name)], { cwd: dir, encoding: 'utf-8' }).status ?? 1

  it('check-muted-test fires on a planted skip and passes when removed', () => {
    const dir = stage('scripts/check-muted-test.mjs.ejs', 'check-muted-test.mjs')
    try {
      mkdirSync(join(dir, '__tests__'), { recursive: true })
      const spec = join(dir, '__tests__', 'a.test.ts')
      writeFileSync(spec, "it('x', () => { expect(1).toBe(1) })\n")
      expect(run(dir, 'check-muted-test.mjs')).toBe(0)
      writeFileSync(spec, "it.skip('x', () => { expect(1).toBe(1) })\n")
      expect(run(dir, 'check-muted-test.mjs')).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('check-skip-critical-e2e is NA without e2e config and fires on a skipped spec', () => {
    const dir = stage('scripts/check-skip-critical-e2e.mjs.ejs', 'check-skip-critical-e2e.mjs')
    try {
      // No e2e config → NA → PASS.
      expect(run(dir, 'check-skip-critical-e2e.mjs')).toBe(0)
      writeFileSync(join(dir, 'playwright.config.ts'), 'export default {}\n')
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      const spec = join(dir, 'e2e', 'flow.spec.ts')
      writeFileSync(spec, "test('flow', async () => {})\n")
      expect(run(dir, 'check-skip-critical-e2e.mjs')).toBe(0)
      writeFileSync(spec, "test.skip('flow', async () => {})\n")
      expect(run(dir, 'check-skip-critical-e2e.mjs')).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('check-no-stub-redirects fires on a stub husk and passes on a real doc', () => {
    const dir = stage('scripts/check-no-stub-redirects.mjs.ejs', 'check-no-stub-redirects.mjs')
    try {
      const doc = join(dir, 'page.md')
      writeFileSync(doc, '# Real Page\n\nThis is a real document with substance and content.\n')
      expect(run(dir, 'check-no-stub-redirects.mjs')).toBe(0)
      writeFileSync(doc, '# Moved\n\nThis page has moved. See [the new page](./other.md).\n')
      expect(run(dir, 'check-no-stub-redirects.mjs')).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('check-grace-window is NO-DATA-PASS clean and fires on an over-long grace', () => {
    const dir = stage('scripts/check-grace-window.mjs.ejs', 'check-grace-window.mjs')
    try {
      const cfg = join(dir, 'arbiter.json')
      // No grace → NO-DATA → PASS.
      writeFileSync(cfg, JSON.stringify({ governanceLevel: 'L2' }))
      expect(run(dir, 'check-grace-window.mjs')).toBe(0)
      // Over-long hand-edited grace (far future) → FAIL.
      const farFuture = new Date(Date.now() + 365 * 86400000).toISOString()
      writeFileSync(
        cfg,
        JSON.stringify({ governanceLevel: 'L2', graceFromLevel: 'L1', graceEndsAt: farFuture }),
      )
      expect(run(dir, 'check-grace-window.mjs')).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
