// SPDX-License-Identifier: Apache-2.0
// #2435 AC-6 — `docs/REFERENCE/fix-on-red.md` declares "reproduce the failed gate locally
// before push" a floor invariant at every autonomy level. The sole required check
// (`ci-required`) needed jobs no local command could reproduce, so the floor was
// unsatisfiable by construction. Every needed job now resolves to a local twin, or is
// declared CI-only in exactly one place.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-local-ci-parity.mjs')
const TEMPLATE = 'src/templates/scripts/check-local-ci-parity.mjs.ejs'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function run(cwd: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, PARITY_REQUIRED_JOBS_ONLY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

function fixture(needs: string, extraJobs = ''): string {
  const d = mkdtempSync(join(tmpdir(), 'ci-required-twin-'))
  dirs.push(d)
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true })
  writeFileSync(
    join(d, '.github', 'workflows', 'pr.yml'),
    `name: pr\non: [pull_request]\njobs:\n  gate:\n    runs-on: ubuntu-latest\n${extraJobs}  ci-required:\n    needs: [${needs}]\n    runs-on: ubuntu-latest\n`,
    'utf-8',
  )
  writeFileSync(join(d, 'Makefile'), '.PHONY: help gate\n\nhelp:\n\t@true\n\ngate:\n\t@true\n', 'utf-8')
  return d
}

describe('#2435 AC-6 — every ci-required dependency has a local twin or a CI-only declaration', () => {
  it("arbiter's own ci-required job passes the twin check (AC-6)", () => {
    const { code, out } = run(process.cwd())
    expect(out).not.toMatch(/no local counterpart/)
    expect(code).toBe(0)
  })

  it('fails when a needed job has no local twin and no declaration (AC-6)', () => {
    const dir = fixture(
      'gate, mystery-job',
      '  mystery-job:\n    runs-on: ubuntu-latest\n',
    )
    const { code, out } = run(dir)
    expect(code).toBe(1)
    expect(out).toContain('mystery-job')
  })

  it('accepts a job whose name is a Makefile target (AC-6)', () => {
    const dir = fixture('gate')
    const { code } = run(dir)
    expect(code).toBe(0)
  })

  it('declares dependency-review and iac-scan CI-only with a stated reason (AC-6)', () => {
    const source = readFileSync(SCRIPT, 'utf-8')
    const start = source.indexOf('CI_ONLY_REQUIRED_JOBS')
    expect(start, 'no single-place CI-only declaration found').toBeGreaterThan(-1)
    const block = source.slice(start, start + 4000)
    for (const job of ['dependency-review', 'iac-scan']) {
      const entry = block.match(new RegExp(`\\['${job}',\\s*\\n?\\s*'([^']+)'`))
      expect(entry, `${job} is not declared CI-only`).not.toBeNull()
      expect((entry as RegExpMatchArray)[1].length).toBeGreaterThan(30)
    }
  })

  it('mirrors the check into the emitted template twin (AC-6)', () => {
    const tpl = readFileSync(TEMPLATE, 'utf-8')
    expect(tpl).toContain('PARITY_REQUIRED_JOBS_ONLY')
    expect(tpl).toContain('CI_ONLY_REQUIRED_JOBS')
  })
})
