// SPDX-License-Identifier: Apache-2.0
// Render test (INV-48 / CANON-04) for scripts/check-test-scope-tier.mjs.ejs — the test-scope ↔
// tier integrity guard shipped into generated projects (A4, #1497). Proves the consumer template
// renders to a self-contained, EJS-tag-free guard that FAILS on a declared-but-unwired category
// and PASSES when the category is wired or marked deferred.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(): string {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>
  return renderTemplate('scripts/check-test-scope-tier.mjs.ejs', data)
}

describe('scripts/check-test-scope-tier.mjs.ejs (A4, #1497)', () => {
  it('renders a self-contained guard with no EJS-tag leak', () => {
    const content = render()
    expect(content).toMatch(/^#!/)
    expect(content).toContain('--help')
    expect(content).toContain('INV-89')
    expect(content).toContain('test-pyramid.json')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
    // No lib import — must run in a project that has no arbiter install.
    expect(content).not.toContain("from './lib/")
  })

  it('the rendered guard fires on a declared-but-unwired category and passes when deferred', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scope-tier-render-'))
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'check-test-scope-tier.mjs'), render())
      writeFileSync(
        join(dir, 'scripts', 'check-all.mjs'),
        "runCheck('unit tests','npm',['run','test:unit'])\n",
      )
      const manifest = (levels: unknown[]) =>
        writeFileSync(
          join(dir, 'test-pyramid.json'),
          JSON.stringify({ archetype: 'backend-web-db', levels }, null, 2),
        )
      const run = () =>
        spawnSync('node', ['scripts/check-test-scope-tier.mjs'], { cwd: dir, encoding: 'utf-8' })
          .status ?? 1

      const unit = {
        id: 'L1',
        name: 'L1 Unit',
        globs: ['__tests__/**/*.test.ts'],
        status: 'required',
      }
      const perf = {
        id: 'L5',
        name: 'L5 Performance',
        globs: ['perf/**/*.perf.ts'],
        status: 'required',
      }

      manifest([unit, perf])
      expect(run()).toBe(1) // L5 Performance declared required but no gate runs it

      manifest([
        unit,
        { ...perf, status: 'n/a', rationale: 'deferred until a load env exists in CI' },
      ])
      expect(run()).toBe(0) // deferred → exempt
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
