// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
// execFileSync is safe: arguments are constant strings, no shell interpolation
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

const SCRIPT = join(process.cwd(), 'scripts/check-adapter-coverage.mjs')
const REQUIRED = ['typescript', 'java', 'python', 'go', 'rust']

function makeTmpDir(): string {
  const dir = join(tmpdir(), `adapter-cov-test-${randomBytes(4).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function makeAdaptersDir(base: string, files: string[]): void {
  const adaptersDir = join(base, 'src', 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  for (const f of files) {
    writeFileSync(join(adaptersDir, f), '// stub\n')
  }
}

function runScript(cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync('node', [SCRIPT], {
      cwd,
      env: { ...process.env, GIT_CWD: cwd },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout, stderr: '', code: 0 }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      code: err.status ?? 1,
    }
  }
}

describe('check-adapter-coverage.mjs', () => {
  it('exits 0 when all required adapter files are present', () => {
    const tmp = makeTmpDir()
    try {
      const allFiles = REQUIRED.map((l) => `${l}.ts`)
      makeAdaptersDir(tmp, allFiles)
      const { code, stdout } = runScript(tmp)
      expect(code).toBe(0)
      expect(stdout).toContain('adapter coverage OK')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('exits 1 when one adapter is missing', () => {
    const tmp = makeTmpDir()
    try {
      const partial = REQUIRED.filter((l) => l !== 'go').map((l) => `${l}.ts`)
      makeAdaptersDir(tmp, partial)
      const { code, stderr } = runScript(tmp)
      expect(code).toBe(1)
      expect(stderr).toContain('go')
      expect(stderr).toContain('INV-88')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('exits 1 when no adapter files present', () => {
    const tmp = makeTmpDir()
    try {
      makeAdaptersDir(tmp, [])
      const { code, stderr } = runScript(tmp)
      expect(code).toBe(1)
      expect(stderr).toContain('INV-88')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('exits 1 when src/adapters/ directory missing', () => {
    const tmp = makeTmpDir()
    try {
      const { code, stderr } = runScript(tmp)
      expect(code).toBe(1)
      expect(stderr).toContain('src/adapters/')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('ignores StackAdapter.ts and _registry.ts when counting coverage', () => {
    const tmp = makeTmpDir()
    try {
      const allFiles = REQUIRED.map((l) => `${l}.ts`)
      // Add the infra files — they should not count as language adapters
      makeAdaptersDir(tmp, [...allFiles, 'StackAdapter.ts', '_registry.ts'])
      const { code, stdout } = runScript(tmp)
      expect(code).toBe(0)
      expect(stdout).not.toContain('StackAdapter')
      expect(stdout).not.toContain('_registry')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('includes all required languages in coverage output', () => {
    const tmp = makeTmpDir()
    try {
      makeAdaptersDir(
        tmp,
        REQUIRED.map((l) => `${l}.ts`),
      )
      const { code, stdout } = runScript(tmp)
      expect(code).toBe(0)
      for (const lang of REQUIRED) {
        expect(stdout).toContain(lang)
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
