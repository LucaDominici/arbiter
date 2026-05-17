// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(process.cwd())
const SCRIPT = join(REPO_ROOT, 'scripts/visual-verify.mjs')

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'visual-verify-test-'))
})

afterAll(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function runScript(args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: '1', ...extraEnv },
  })
}

describe('visual-verify — skill file exists', () => {
  it('SKILL.md exists', () => {
    expect(existsSync(join(REPO_ROOT, '.claude/skills/visual-verification/SKILL.md'))).toBe(true)
  })

  it('script file exists', () => {
    expect(existsSync(SCRIPT)).toBe(true)
  })
})

describe('visual-verify — graceful skip when Playwright absent', () => {
  it('--skip-if-missing exits 0 and writes skip marker', () => {
    const evidenceDir = join(tmpDir, 'evidence-skip')
    mkdirSync(evidenceDir, { recursive: true })
    const r = runScript(['--skip-if-missing', '--evidence-dir', evidenceDir], {
      PATH: '/usr/bin:/bin',
      PLAYWRIGHT_SKIP: '1',
    })
    expect(r.status).toBe(0)
    const skipMarker = join(evidenceDir, 'visual-verify-skipped.json')
    expect(existsSync(skipMarker)).toBe(true)
    const marker = JSON.parse(readFileSync(skipMarker, 'utf-8'))
    expect(marker).toHaveProperty('skipped', true)
    expect(marker).toHaveProperty('reason')
  })
})

describe('visual-verify — required flags', () => {
  it('exits without unhandled exception when run bare', () => {
    const r = runScript([])
    expect(r.signal).toBeNull()
    expect(typeof r.status).toBe('number')
  })

  it('--help exits 0 with usage info', () => {
    const r = runScript(['--help'])
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/usage|playwright|visual/i)
  })
})

describe('visual-verify — no shell injection risk', () => {
  it('script does not use execSync (prefers spawnSync)', () => {
    const src = readFileSync(SCRIPT, 'utf-8')
    expect(src).not.toMatch(/\bexecSync\b/)
  })
})
