// SPDX-License-Identifier: Apache-2.0
// #2675 Codex round-3 — three residual gaps:
//   1. `--dir=value` (inline-equals form) was never recognized at all: only `--dir value`
//      (space-separated) was scanned, so `--dir=value` was silently ignored and the LIVE cwd
//      was scanned instead of the requested target.
//   2. `--dir --help` swallowed `--help` as --dir's OWN value (a flag-shaped value), and the
//      generic --help scan ran first, so the process printed help and exited 0 instead of
//      refusing the malformed --dir it actually received.
//   3. check-suppression-expiry.mjs: `--max-days --dir <valid>` parses '--dir' as the number
//      via parseInt, yielding NaN; every `diffDays > NaN` comparison is false, so the check
//      silently stops enforcing its own configured window instead of refusing the bad flag.
// Parametrized over the same 9 --dir entry points as the round-2 suite, PLUS the 4 templates
// that had never been touched by round-1/2 at all (their real-script counterparts use the
// shared parseHelpAndDir; the templates carry their own now-fixed copy) — run by copying each
// .ejs body verbatim to a .mjs (none of the touched code paths are behind an EJS <% %> tag) and
// spawning it directly, proving the EMITTED artifact, not just its real-script counterpart.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'dir-eq-flag-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const PARSE_HELP_AND_DIR_CONSUMERS = [
  'scripts/check-workflow-runners.mjs',
  'scripts/check-docker-action-runner-safety.mjs',
  'scripts/check-workflow-test-integrity.mjs',
  'scripts/check-workflow-parallelism.mjs',
  'scripts/check-unwired-guards.mjs',
  'scripts/check-secret-presence.mjs',
  'scripts/check-continue-on-error.mjs',
]

const STANDALONE_DIR_SCRIPTS = [
  'scripts/check-pr-size-gate.mjs',
  'scripts/check-suppression-expiry.mjs',
  'scripts/check-suppression-rationale.mjs',
]

const ALL_REAL_DIR_SCRIPTS = [...PARSE_HELP_AND_DIR_CONSUMERS, ...STANDALONE_DIR_SCRIPTS]

// The 4 templates Codex found still on the OLD unsafe fallback, plus the 3 standalone templates
// already fixed in round-1 — all copied verbatim (no active EJS tag on the touched lines) to a
// real .mjs so the EMITTED artifact is what gets spawned and asserted on.
const EMITTED_TEMPLATES = [
  'check-workflow-runners.mjs.ejs',
  'check-workflow-test-integrity.mjs.ejs',
  'check-secret-presence.mjs.ejs',
  'check-continue-on-error.mjs.ejs',
  'check-unwired-guards.mjs.ejs',
  'check-pr-size-gate.mjs.ejs',
  'check-suppression-expiry.mjs.ejs',
  'check-suppression-rationale.mjs.ejs',
]

let renderedDir: string
beforeAll(() => {
  renderedDir = mkdtempSync(join(tmpdir(), 'dir-eq-flag-templates-'))
  for (const name of EMITTED_TEMPLATES) {
    const body = readFileSync(join('src/templates/scripts', name), 'utf-8')
    writeFileSync(join(renderedDir, name.replace(/\.ejs$/, '')), body)
  }
})
afterAll(() => {
  rmSync(renderedDir, { recursive: true, force: true })
})

function emittedScriptPath(templateName: string): string {
  return join(renderedDir, templateName.replace(/\.ejs$/, ''))
}

describe('#2675 Codex round-3 — --dir=value is accepted (real scripts)', () => {
  for (const script of ALL_REAL_DIR_SCRIPTS) {
    it(`${script}: --dir=<valid> is accepted`, () => {
      withTmp((dir) => {
        const r = spawnSync('node', [resolve(script), `--dir=${dir}`], { encoding: 'utf-8' })
        expect(r.status).not.toBe(2)
      })
    })

    it(`${script}: --dir= (empty, inline-equals form) is refused`, () => {
      const r = spawnSync('node', [resolve(script), '--dir='], { encoding: 'utf-8' })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/--dir requires a path argument/)
    })

    it(`${script}: --dir --help refuses (flag-shaped value), never prints help`, () => {
      const r = spawnSync('node', [resolve(script), '--dir', '--help'], { encoding: 'utf-8' })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/--dir requires a path argument/)
      expect(r.stdout).not.toMatch(/Usage:/)
    })
  }

  it('check-unwired-guards refuses --dir -h instead of treating the value as help', () => {
    const r = spawnSync('node', [resolve('scripts/check-unwired-guards.mjs'), '--dir', '-h'], {
      encoding: 'utf-8',
    })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/--dir requires a path argument/)
    expect(r.stdout).not.toMatch(/Usage:/)
  })
})

describe('#2675 Codex round-3 — the emitted templates carry the same fail-closed guard', () => {
  for (const template of EMITTED_TEMPLATES) {
    it(`${template}: emitted script refuses a bare --dir`, () => {
      const r = spawnSync('node', [emittedScriptPath(template), '--dir'], { encoding: 'utf-8' })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/--dir requires a path argument/)
    })

    it(`${template}: emitted script refuses --dir=`, () => {
      const r = spawnSync('node', [emittedScriptPath(template), '--dir='], { encoding: 'utf-8' })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/--dir requires a path argument/)
    })

    it(`${template}: emitted script accepts --dir=<valid>`, () => {
      withTmp((dir) => {
        const r = spawnSync('node', [emittedScriptPath(template), `--dir=${dir}`], {
          encoding: 'utf-8',
        })
        expect(r.status).not.toBe(2)
      })
    })
  }

  it('the emitted unwired-guards script refuses --dir -h', () => {
    const r = spawnSync(
      'node',
      [emittedScriptPath('check-unwired-guards.mjs.ejs'), '--dir', '-h'],
      { encoding: 'utf-8' },
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/--dir requires a path argument/)
    expect(r.stdout).not.toMatch(/Usage:/)
  })
})

describe('#2675 Codex round-3 — check-suppression-expiry --max-days rejects NaN', () => {
  it('a --max-days value that is not numeric (swallowed the next flag) exits 2', () => {
    withTmp((dir) => {
      const r = spawnSync(
        'node',
        [resolve('scripts/check-suppression-expiry.mjs'), '--max-days', '--dir', dir],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/--max-days .* must be a positive integer/)
    })
  })

  it('the emitted template rejects the same NaN case', () => {
    withTmp((dir) => {
      const r = spawnSync(
        'node',
        [emittedScriptPath('check-suppression-expiry.mjs.ejs'), '--max-days', '--dir', dir],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/--max-days .* must be a positive integer/)
    })
  })
})
