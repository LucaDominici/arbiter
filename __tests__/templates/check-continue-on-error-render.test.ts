// SPDX-License-Identifier: Apache-2.0
// Render test (INV-48 / CANON-04) for scripts/check-continue-on-error.mjs.ejs — the parser-backed
// swallowed-gate guard shipped into generated projects (A3, #1497). Proves the consumer template
// renders to a self-contained, EJS-tag-free guard that catches the YAML-1.1 truthy forms.
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
  return renderTemplate('scripts/check-continue-on-error.mjs.ejs', data)
}

describe('scripts/check-continue-on-error.mjs.ejs (A3, #1497)', () => {
  it('renders a self-contained guard with no EJS-tag leak', () => {
    const content = render()
    expect(content).toMatch(/^#!/)
    expect(content).toContain('--help')
    expect(content).toContain('INV-89')
    expect(content).toContain('TRUTHY_TOKENS')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
    // No lib import — must run in a project that has no arbiter install.
    expect(content).not.toContain("from './lib/")
  })

  it('the rendered guard fires on the YAML-1.1 `on` trap and passes when removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coe-render-'))
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'check-continue-on-error.mjs'), render())
      const wf = join(dir, '.github', 'workflows', 'ci.yml')
      const run = () =>
        spawnSync('node', ['scripts/check-continue-on-error.mjs'], { cwd: dir, encoding: 'utf-8' })
          .status ?? 1

      writeFileSync(
        wf,
        `name: ci
on: [push]
jobs:
  gate:
    runs-on: ubuntu-latest
    continue-on-error: on
    steps:
      - run: node scripts/check-all.mjs L1
`,
      )
      expect(run()).toBe(1) // YAML-1.1 `on` → truthy → swallowed gate caught

      writeFileSync(
        wf,
        `name: ci
on: [push]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-all.mjs L1
`,
      )
      expect(run()).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
