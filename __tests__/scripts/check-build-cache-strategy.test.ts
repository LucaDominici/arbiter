// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-build-cache-strategy.mjs')

function run(dir: string) {
  const r = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'build-cache-strategy-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeAction(parentDir: string, content: string): void {
  const actionDir = join(parentDir, 'src', 'templates', 'github', 'actions', 'build-cache')
  mkdirSync(actionDir, { recursive: true })
  writeFileSync(join(actionDir, 'action.yml.ejs'), content)
}

// A minimal but fully valid build-cache action template carrying every invariant
// the gate enforces: all four strategies, an immutable run-id artifact key, and a
// non-blocking restore with a gated rebuild fallback.
const VALID = [
  '<% const strategies = { "node-workspace": 1, "python-wheel": 1, "maven-reactor": 1, "gradle": 1 }; %>',
  'name: Build cache',
  'runs:',
  '  using: composite',
  '  steps:',
  '    - name: Restore cached workspace build (non-blocking)',
  '      id: build-cache-restore',
  "      if: ${{ inputs.op == 'restore' }}",
  '      uses: actions/cache/restore@sha',
  '      with:',
  '        path: dist',
  '        key: build-cache-<%= strat %>-${{ github.run_id }}',
  '    - name: Rebuild fallback (cache unavailable)',
  "      if: ${{ steps.build-cache-restore.outputs.cache-hit != 'true' }}",
  '      shell: bash',
  '      run: npm run build',
  '    - name: Save workspace build (run-id keyed)',
  "      if: ${{ inputs.op == 'save' }}",
  '      uses: actions/cache/save@sha',
  '      with:',
  '        path: dist',
  '        key: build-cache-<%= strat %>-${{ github.run_id }}',
].join('\n')

describe('check-build-cache-strategy.mjs — valid template', () => {
  it('exits 0 when all invariants are satisfied', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeAction(dir, VALID)
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })
})

describe('check-build-cache-strategy.mjs — parametric strategy coverage', () => {
  for (const strat of ['node-workspace', 'python-wheel', 'maven-reactor', 'gradle']) {
    it(`exits 1 when strategy "${strat}" is absent (not parametric)`, () => {
      const { dir, cleanup } = makeTemp()
      try {
        // Remove the strategy token from the template.
        writeAction(dir, VALID.split(strat).join('OMITTED'))
        const result = run(dir)
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(strat)
      } finally {
        cleanup()
      }
    })
  }
})

describe('check-build-cache-strategy.mjs — immutable run-id key', () => {
  it('exits 1 when the artifact key drops github.run_id (mutable/colliding key)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // Replace the run-id expression with a static key — collides across runs.
      writeAction(dir, VALID.split('${{ github.run_id }}').join('latest'))
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('run-id')
    } finally {
      cleanup()
    }
  })
})

describe('check-build-cache-strategy.mjs — non-blocking rebuild fallback', () => {
  it('exits 1 when restore uses a hand-rolled download instead of actions/cache (regression risk)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // A hand-rolled `gh run download` script can regress into a hard failure on
      // a miss — actions/cache/restore is non-blocking BY CONSTRUCTION; anything
      // else must be rejected.
      const blocking = VALID.split('uses: actions/cache/restore@sha').join(
        'run: gh run download "${{ github.run_id }}"',
      )
      writeAction(dir, blocking)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('actions/cache/restore')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when the rebuild-fallback step is missing entirely', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeAction(dir, VALID.split('Rebuild fallback').join('Some other step'))
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('fallback')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a rebuild-fallback step exists but is NOT gated on the restore outcome (fake-green)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // Adversarial: keep the "Rebuild fallback" name but ungate it — a vacuous
      // fallback that never actually depends on the restore having missed.
      const ungated = VALID.split(
        "if: ${{ steps.build-cache-restore.outputs.cache-hit != 'true' }}",
      ).join('if: ${{ always() }}')
      writeAction(dir, ungated)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('fallback')
    } finally {
      cleanup()
    }
  })
})

describe('check-build-cache-strategy.mjs — fail-closed', () => {
  it('exits 2 when the build-cache action template is missing', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('ERROR')
    } finally {
      cleanup()
    }
  })
})

describe('check-build-cache-strategy.mjs — integration on real template', () => {
  it('exits 0 against the actual arbiter repo template', () => {
    const repoRoot = resolve('.')
    const r = spawnSync('node', [SCRIPT, '--dir', repoRoot], { encoding: 'utf-8' })
    const status = r.status ?? 1
    if (status !== 0) {
      process.stderr.write(r.stdout)
      process.stderr.write(r.stderr)
    }
    expect(status).toBe(0)
  })
})
