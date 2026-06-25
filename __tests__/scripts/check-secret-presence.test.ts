// SPDX-License-Identifier: Apache-2.0
// Secret-presence guard (#1497): a CI step that depends on a secret which is EMPTY must FAIL loudly,
// never silently skip and report green. This guard scans .github/workflows run-steps for the
// silent-skip-on-empty-secret idiom (an emptiness test on a secret-backed var reaching `exit 0`
// with no explicit `vars.SKIP_<NAME>` opt-out). FAILS closed on the unguarded skip, PASSes on the
// sanctioned opt-out form, on a loud `exit 1` branch, on GITHUB_TOKEN, on informational workflows,
// and on NO-DATA (no workflows / no secret steps).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-secret-presence.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, '--dir', dir, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'secret-presence-'))
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeWf(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, '.github', 'workflows', name), body)
}

// An unguarded silent-skip-on-empty-secret step: the fake-green this guard targets.
const UNGUARDED = `name: deploy
on: [push]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - name: k6 smoke gate
        env:
          BASE_URL: \${{ secrets.TEST_BASE_URL }}
        run: |
          [[ -z "$BASE_URL" ]] && { echo "no url — skip"; exit 0; }
          k6 run smoke.js
`

// The sanctioned shape: the skip is gated by an explicit vars.SKIP_ opt-out; the empty-secret
// branch otherwise fails loud.
const SANCTIONED = `name: deploy
on: [push]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - name: k6 smoke gate
        env:
          BASE_URL: \${{ secrets.TEST_BASE_URL }}
          SKIP_SMOKE: \${{ vars.SKIP_SMOKE }}
        run: |
          test -n "$BASE_URL" || { [ "\${SKIP_SMOKE}" = "true" ] && exit 0 || { echo "::error::empty secret"; exit 1; }; }
          k6 run smoke.js
`

describe('check-secret-presence (anti-fake-green, #1497)', () => {
  it('--help exits 0', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('NO-DATA when no workflows → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('unguarded skip-on-empty-secret step → FAIL (the fake-green)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(dir, 'deploy.yml', UNGUARDED)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/skips on empty secret/)
      expect(r.stderr).toMatch(/TEST_BASE_URL|BASE_URL/)
    } finally {
      cleanup()
    }
  })

  it('sanctioned vars.SKIP_ opt-out + loud fail branch → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(dir, 'deploy.yml', SANCTIONED)
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('a loud `exit 1` empty-secret branch (no skip) → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'deploy.yml',
        `name: deploy
on: [push]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - name: gate
        env:
          BASE_URL: \${{ secrets.TEST_BASE_URL }}
        run: |
          test -n "$BASE_URL" || { echo "::error::empty secret"; exit 1; }
          k6 run smoke.js
`,
      )
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('GITHUB_TOKEN skip-on-empty is exempt (always provided) → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'ci.yml',
        `name: ci
on: [push]
jobs:
  x:
    runs-on: ubuntu-latest
    steps:
      - name: token step
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          [[ -z "$GH_TOKEN" ]] && { echo "skip"; exit 0; }
          gh pr list
`,
      )
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('informational workflow (notify) skip-on-empty-secret is exempt → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(dir, '_post-merge-notify.yml', UNGUARDED.replace('name: deploy', 'name: notify'))
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('a bogus comment opt-out (`# SKIP_FAKE=true`) does NOT disarm the guard → FAIL', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'deploy.yml',
        `name: deploy
on: [push]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - name: gate
        env:
          BASE_URL: \${{ secrets.TEST_BASE_URL }}
        run: |
          # SKIP_FAKE=true (bogus marker — does not actually gate the exit 0 below)
          [[ -z "$BASE_URL" ]] && { echo "skip"; exit 0; }
          k6 run smoke.js
`,
      )
      const r = run(dir)
      expect(r.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('a step that USES a secret but has no skip-on-empty → PASS (not flagged)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'publish.yml',
        `name: publish
on: [push]
jobs:
  pub:
    runs-on: ubuntu-latest
    steps:
      - name: publish
        env:
          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
        run: |
          npm publish
`,
      )
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
