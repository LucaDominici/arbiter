// SPDX-License-Identifier: Apache-2.0
// Parser-backed swallowed-gate guard (A3, #1497): a GATING job/step carrying a const-true
// `continue-on-error` swallows its own failure — a red gate goes green. Unlike the regex sibling
// (check-workflow-test-integrity), the truthy value is read through the YAML 1.1 boolean grammar,
// so the const-true forms a regex misses are caught: `on`/`yes` (YAML-1.1 → true) and `${{ true }}`.
// The sole sanctioned step is an artifact up/download; informational workflows and an audited
// `# arbiter-allow-continue-on-error` marker are exempt; NO-DATA (no workflows) is a PASS.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { isConstTrueValue } from '../../scripts/lib/continue-on-error-core.mjs'

const SCRIPT = resolve('scripts/check-continue-on-error.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, '--dir', dir, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'continue-on-error-'))
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeWf(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, '.github', 'workflows', name), body)
}

// A gate step whose failure is swallowed by a literal-true continue-on-error: the fake-green.
const GATE_TRUE = `name: ci
on: [push]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - name: L1 gate
        run: node scripts/check-all.mjs L1
        continue-on-error: true
`

// Same fake-green expressed via the YAML-1.1 `on` boolean — a plain regex for `true` MISSES this.
const GATE_ON = GATE_TRUE.replace('continue-on-error: true', 'continue-on-error: on')

describe('check-continue-on-error (anti-fake-green A3, #1497)', () => {
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
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('gate step with continue-on-error: true → FAIL (the swallowed gate)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(dir, 'ci.yml', GATE_TRUE)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/swallows a GATING step/)
    } finally {
      cleanup()
    }
  })

  it('YAML-1.1 `on` boolean trap → FAIL (a regex for `true` would miss it)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(dir, 'ci.yml', GATE_ON)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/swallows a GATING/)
    } finally {
      cleanup()
    }
  })

  it('const-true `${{ true }}` expression on a gate job → FAIL', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'ci.yml',
        `name: ci
on: [push]
jobs:
  gate:
    runs-on: ubuntu-latest
    continue-on-error: \${{ true }}
    steps:
      - run: npm test
`,
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/swallows a GATING job/)
    } finally {
      cleanup()
    }
  })

  it('removing the swallow → PASS (the green half of the flip-test)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(dir, 'ci.yml', GATE_TRUE.replace(/\s+continue-on-error: true/, ''))
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('artifact-upload step is the sole sanctioned exception → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'ci.yml',
        `name: ci
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: gate
        run: node scripts/check-all.mjs L1
      - name: Upload report
        uses: actions/upload-artifact@v4
        continue-on-error: true
        with:
          name: report
          path: report/
`,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('a non-gating step (notification/comment) with continue-on-error → PASS (not a gate)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'ci.yml',
        `name: ci
on: [push]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: comment
        uses: actions/github-script@v7
        continue-on-error: true
        with:
          script: github.rest.issues.createComment({})
`,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('an audited `# arbiter-allow-continue-on-error` marker → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'ci.yml',
        `name: ci
on: [push]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - name: parity (non-blocking — opens a drift issue on mismatch)
        # arbiter-allow-continue-on-error: parity mismatch opens an issue, must not fail nightly
        run: node scripts/check-local-ci-parity.mjs
        continue-on-error: true
`,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('an EMPTY-reason `# arbiter-allow-continue-on-error:` marker does NOT bypass → FAIL (#1499)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'ci.yml',
        `name: ci
on: [push]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - name: L1 gate
        # arbiter-allow-continue-on-error:
        run: node scripts/check-all.mjs L1
        continue-on-error: true
`,
      )
      const r = run(dir)
      expect(r.status).not.toBe(0)
      expect(r.stderr).toMatch(/swallows a GATING/)
    } finally {
      cleanup()
    }
  })

  it('a dynamic (non-const) expression is indeterminate → PASS (conservative)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'ci.yml',
        `name: ci
on: [push]
jobs:
  gate:
    runs-on: ubuntu-latest
    continue-on-error: \${{ github.event_name == 'schedule' }}
    steps:
      - run: npm test
`,
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('informational workflow (nightly) is exempt → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(dir, '06-nightly.yml', GATE_TRUE.replace('name: ci', 'name: nightly'))
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('continue-on-error: false is never a violation → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeWf(
        dir,
        'ci.yml',
        GATE_TRUE.replace('continue-on-error: true', 'continue-on-error: false'),
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('isConstTrueValue: YAML-1.1 truthy tokens + ${{ true }}, not dynamic/false', () => {
    for (const v of ['true', 'on', 'yes', 'y', 'True', 'ON', '${{ true }}', 'true # comment']) {
      expect(isConstTrueValue(v)).toBe(true)
    }
    for (const v of ['false', 'off', 'no', "${{ github.event_name == 'x' }}", '<%= flag %>', '']) {
      expect(isConstTrueValue(v)).toBe(false)
    }
  })
})
