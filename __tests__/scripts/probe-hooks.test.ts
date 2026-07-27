// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/probe-hooks.mjs')
const ADVISORY_HOOK = 'debug-state-on-failure.mjs'

function fixture(hook = ADVISORY_HOOK, hookBody?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-probe-hooks-'))
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
  writeFileSync(
    join(dir, '.arbiter-generated-manifest.json'),
    JSON.stringify({
      $schemaVersion: 1,
      files: { [`.claude/hooks/${hook}`]: 'recorded-render-hash' },
    }),
  )
  if (hookBody !== undefined) {
    writeFileSync(join(dir, '.claude', 'hooks', hook), hookBody)
  }
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'probe' + '@' + 'example.invalid'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Probe'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'test fixture'], { cwd: dir, stdio: 'ignore' })
  return dir
}

function run(dir: string) {
  return spawnSync('node', [SCRIPT, '--root', dir, '--language', 'typescript'], {
    cwd: dir,
    encoding: 'utf-8',
  })
}

describe('probe-hooks liveness contract (#2135)', () => {
  it('accepts an advisory hook only when it executes successfully in both states', () => {
    const dir = fixture(ADVISORY_HOOK, 'process.exit(0)\n')
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      const report = JSON.parse(result.stdout)
      expect(report.rows).toHaveLength(4)
      expect(report.rows.every((row: { verdict: string }) => row.verdict === 'ADVISORY')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('turns advisory exit 1 into a probe error instead of a healthy classification', () => {
    const dir = fixture(ADVISORY_HOOK, 'process.exit(1)\n')
    try {
      const result = run(dir)
      expect(result.status).toBe(2)
      const report = JSON.parse(result.stdout)
      expect(report.failures).toEqual(
        expect.arrayContaining([expect.objectContaining({ verdict: 'PROBE-ERROR' })]),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('turns a missing emitted advisory hook into a probe error', () => {
    const dir = fixture(ADVISORY_HOOK)
    try {
      const result = run(dir)
      expect(result.status).toBe(2)
      expect(result.stdout).toContain('PROBE-ERROR')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maps a signalled advisory child to operational ERROR (exit 2)', () => {
    const dir = fixture(ADVISORY_HOOK, "process.kill(process.pid, 'SIGTERM')\n")
    try {
      const result = run(dir)
      expect(result.status).toBe(2)
      expect(JSON.parse(result.stdout).failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            verdict: 'PROBE-ERROR',
            diagnostic: expect.stringContaining('SIGTERM'),
          }),
        ]),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exercises HARD hooks in every declared applicable state', () => {
    const dir = fixture('stop-dangerous.mjs', 'process.exit(2)\n')
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).rows).toEqual([
        expect.objectContaining({ state: 'BARE', verdict: 'BLOCKS' }),
        expect.objectContaining({ state: 'PRIMED', verdict: 'BLOCKS' }),
        expect.objectContaining({ state: 'CLOSE', verdict: 'NOT-APPLICABLE' }),
        expect.objectContaining({ state: 'VERIFICATION', verdict: 'NOT-APPLICABLE' }),
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails a HARD hook that stays inert and an owned hook with no probe contract', () => {
    const inert = fixture('stop-dangerous.mjs', 'process.exit(0)\n')
    const unknown = fixture('unknown-owned-hook.mjs', 'process.exit(2)\n')
    try {
      expect(run(inert).status).toBe(1)
      const unknownResult = run(unknown)
      expect(unknownResult.status).toBe(1)
      expect(unknownResult.stdout).toContain('NO-PROBE')
    } finally {
      rmSync(inert, { recursive: true, force: true })
      rmSync(unknown, { recursive: true, force: true })
    }
  })

  it('marks contextual HARD hooks not-applicable only outside their declared state', () => {
    const dir = fixture('pre-edit-plan-anchor.mjs', 'process.exit(2)\n')
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).rows).toEqual([
        expect.objectContaining({ state: 'BARE', verdict: 'NOT-APPLICABLE' }),
        expect.objectContaining({ state: 'PRIMED', verdict: 'BLOCKS' }),
        expect.objectContaining({ state: 'CLOSE', verdict: 'NOT-APPLICABLE' }),
        expect.objectContaining({ state: 'VERIFICATION', verdict: 'NOT-APPLICABLE' }),
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    ['closer-mode-guard.mjs', 'CLOSE'],
    ['guard-done-evidence.mjs', 'VERIFICATION'],
  ])('executes %s in its dedicated %s state', (hook, applicableState) => {
    const dir = fixture(hook, 'process.exit(2)\n')
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      const rows = JSON.parse(result.stdout).rows
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ state: applicableState, verdict: 'BLOCKS' }),
        ]),
      )
      expect(
        rows.filter(
          (row: { state: string; verdict: string }) =>
            row.state !== applicableState && row.verdict !== 'NOT-APPLICABLE',
        ),
      ).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses exit 2 for malformed invocation', () => {
    const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8' })
    expect(result.status).toBe(2)
  })
})
