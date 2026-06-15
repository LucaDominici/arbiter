// SPDX-License-Identifier: Apache-2.0
// Guard #6 (skip-critical-e2e, #1412): a critical-path e2e test that is skipped is a falso-green —
// the highest-value end-to-end signal goes green without running. Scans playwright/e2e spec dirs
// for skipped specs tagged @critical-path (or any test.skip inside an e2e dir). If NO e2e config
// exists the verdict is NA (exit 0) — there is nothing to skip, never a manufactured fail.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-skip-critical-e2e.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), 'skip-e2e-'))
}

describe('check-skip-critical-e2e (guard #6, #1412)', () => {
  it('--help exits 0', () => {
    const dir = mkTmp()
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('no e2e config present → NA (exit 0), never a fail', () => {
    const dir = mkTmp()
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/NA|no e2e/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('e2e config + clean spec → PASS (exit 0)', () => {
    const dir = mkTmp()
    try {
      writeFileSync(join(dir, 'playwright.config.ts'), 'export default {}\n')
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      writeFileSync(join(dir, 'e2e', 'login.spec.ts'), "test('login', async () => {})\n")
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skipped @critical-path spec → FAIL (exit 1)', () => {
    const dir = mkTmp()
    try {
      writeFileSync(join(dir, 'playwright.config.ts'), 'export default {}\n')
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      writeFileSync(
        join(dir, 'e2e', 'checkout.spec.ts'),
        "// @critical-path\ntest.skip('checkout flow', async () => {})\n",
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/critical|skip/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('plain test.skip in an e2e dir → FAIL (exit 1)', () => {
    const dir = mkTmp()
    try {
      writeFileSync(join(dir, 'playwright.config.ts'), 'export default {}\n')
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      writeFileSync(join(dir, 'e2e', 'smoke.spec.ts'), "test.skip('smoke', async () => {})\n")
      const r = run(dir)
      expect(r.status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
