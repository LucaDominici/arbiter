// SPDX-License-Identifier: Apache-2.0
// Render + discrimination tests (INV-48/CANON-04) for check-oracle-discrimination.mjs.ejs (#2160).
// Proves the template renders self-contained (no EJS tags, no lib import) and DISCRIMINATES:
// a non-discriminating E2E oracle (inline testid form AND neutral-variable form, AC-1) must FAIL,
// a discriminating one must PASS, a missing baseline is fail-closed (AC-2), and --update-baseline
// ratchets without ever being invoked automatically by the guard itself.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(): string {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>
  return renderTemplate('scripts/check-oracle-discrimination.mjs.ejs', data)
}

function stage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oracle-disc-render-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'check-oracle-discrimination.mjs'), render())
  return dir
}
const run = (dir: string, argv: string[] = []): { status: number; stdout: string; stderr: string } => {
  const r = spawnSync('node', [join('scripts', 'check-oracle-discrimination.mjs'), ...argv], {
    cwd: dir,
    encoding: 'utf-8',
  })
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}
const seedBaseline = (dir: string) =>
  writeFileSync(join(dir, 'oracle-discrimination-baseline.json'), JSON.stringify({ count: 0, sites: [] }))

describe('check-oracle-discrimination.mjs.ejs render (#2160)', () => {
  it('renders as a self-contained, tag-free guard with no lib import', () => {
    const content = render()
    expect(content).toMatch(/^#!/)
    expect(content).toContain('--update-baseline')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
    expect(content).not.toContain("from './lib/")
  })

  it('AC-2: a missing baseline is fail-closed (exit 1), never auto-generated', () => {
    const dir = stage()
    try {
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      writeFileSync(join(dir, 'e2e', 'flow.spec.ts'), "test('flow', async () => {})\n")
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/baseline missing/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-1: fires on a non-discriminating oracle — INLINE testid form', () => {
    const dir = stage()
    try {
      seedBaseline(dir)
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      const spec = join(dir, 'e2e', 'flow.spec.ts')
      writeFileSync(
        spec,
        "test('flow', async ({ page }) => {\n" +
          "  await expect(\n" +
          "    page.getByTestId('list').or(page.getByTestId('error-state')),\n" +
          '  ).toBeVisible()\n' +
          '})\n',
      )
      expect(run(dir).status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-1: fires on a non-discriminating oracle — NEUTRAL VARIABLE form (false-negative demonstrated in viafera, spool N63)', () => {
    const dir = stage()
    try {
      seedBaseline(dir)
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      const spec = join(dir, 'e2e', 'flow.spec.ts')
      writeFileSync(
        spec,
        "test('flow', async ({ page }) => {\n" +
          "  const list = page.getByTestId('list')\n" +
          "  const alt = page.getByTestId('error-state')\n" +
          '  await expect(list.or(alt)).toBeVisible()\n' +
          '})\n',
      )
      expect(run(dir).status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-1: passes when the state is discriminated right after the wait', () => {
    const dir = stage()
    try {
      seedBaseline(dir)
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      const spec = join(dir, 'e2e', 'flow.spec.ts')
      writeFileSync(
        spec,
        "test('flow', async ({ page }) => {\n" +
          "  const list = page.getByTestId('list')\n" +
          "  const errorState = page.getByTestId('error-state')\n" +
          '  await expect(list.or(errorState)).toBeVisible()\n' +
          '  if (await errorState.isVisible()) throw new Error("errore visibile")\n' +
          '})\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-2/ratchet: --update-baseline writes the baseline and is never invoked implicitly', () => {
    const dir = stage()
    try {
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      writeFileSync(
        join(dir, 'e2e', 'flow.spec.ts'),
        "test('flow', async ({ page }) => {\n" +
          "  const list = page.getByTestId('list')\n" +
          "  const alt = page.getByTestId('error-state')\n" +
          '  await expect(list.or(alt)).toBeVisible()\n' +
          '})\n',
      )
      const upd = run(dir, ['--update-baseline'])
      expect(upd.status).toBe(0)
      const baseline = JSON.parse(readFileSync(join(dir, 'oracle-discrimination-baseline.json'), 'utf-8'))
      expect(baseline.count).toBe(1)
      // Now the SAME (unbaselined-growth) run passes — it's the known site, not a regression.
      expect(run(dir).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
