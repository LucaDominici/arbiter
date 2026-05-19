import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = join(process.cwd(), 'scripts', 'check-local-ci-parity.mjs')

function runParity(cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, PARITY_STATIC_CHECK_ONLY: '1' },
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function writeMakefile(dir: string, targets: string[]): void {
  const phony = `.PHONY: ${targets.join(' ')}\n`
  const rules = targets.map((t) => `${t}:\n\techo ${t}\n`).join('\n')
  writeFileSync(join(dir, 'Makefile'), phony + '\n' + rules)
}

function writeWorkflow(dir: string, jobs: string[]): void {
  const wfDir = join(dir, '.github', 'workflows')
  mkdirSync(wfDir, { recursive: true })
  const jobBlock = jobs.map((j) => `  ${j}:\n    runs-on: ubuntu-latest\n    steps: []\n`).join('')
  writeFileSync(join(wfDir, 'ci.yml'), `name: CI\non: [push]\njobs:\n${jobBlock}`)
}

describe('check-local-ci-parity.mjs — static Makefile↔workflow check (#879, W3)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-parity-static-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('Fixture C: empty workflows dir → skip-neutral (exit 0)', () => {
    writeMakefile(dir, ['check', 'gate', 'ci'])
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    const r = runParity(dir)
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/\[skip\]/i)
  })

  it('Fixture D: Makefile absent → skip-neutral (exit 0)', () => {
    writeWorkflow(dir, ['check', 'gate'])
    const r = runParity(dir)
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/\[skip\]/i)
  })

  it('Fixture A: matching targets → exit 0', () => {
    writeMakefile(dir, ['check', 'gate', 'ci'])
    writeWorkflow(dir, ['check', 'gate', 'ci'])
    const r = runParity(dir)
    expect(r.status).toBe(0)
  })

  it('Fixture B: Makefile has extra target not in workflow → exit 1 with diff', () => {
    writeMakefile(dir, ['check', 'gate', 'ci', 'extra-local-target'])
    writeWorkflow(dir, ['check', 'gate', 'ci'])
    const r = runParity(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('extra-local-target')
  })

  it('Fixture E: Makefile present but no .PHONY declaration → exit 2 (structural error)', () => {
    writeWorkflow(dir, ['check', 'gate'])
    writeFileSync(join(dir, 'Makefile'), 'check:\n\techo check\ngate:\n\techo gate\n')
    const r = runParity(dir)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('PHONY')
  })
})
