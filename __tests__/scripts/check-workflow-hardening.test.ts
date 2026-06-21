// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-workflow-hardening.mjs')

type RunResult = { status: number; stdout: string; stderr: string }

function run(dir: string, out: string, extraEnv?: Record<string, string>): RunResult {
  const r = spawnSync('node', [SCRIPT, '--dir', dir, '--out', out], {
    encoding: 'utf-8',
    env: { ...process.env, ...extraEnv },
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeTemp(): { dir: string; wf: string; out: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'wf-hardening-test-'))
  const wf = join(dir, '.github', 'workflows')
  mkdirSync(wf, { recursive: true })
  return {
    dir,
    wf,
    out: join(dir, 'report.json'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function write(wfDir: string, filename: string, content: string): void {
  writeFileSync(join(wfDir, filename), content.trim() + '\n')
}

function report(out: string): Record<string, number> {
  return JSON.parse(readFileSync(out, 'utf-8'))
}

// A fully-hardened PR workflow: pinned action, top-level permissions, concurrency, job timeout.
const HARDENED = `
name: Hardened
on:
  pull_request:
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
        run: echo hi
`

describe('check-workflow-hardening', () => {
  it('passes on a fully-hardened workflow and writes a zeroed report', () => {
    const t = makeTemp()
    try {
      write(t.wf, '01-pr.yml', HARDENED)
      const r = run(t.dir, t.out)
      expect(r.status).toBe(0)
      const rep = report(t.out)
      expect(rep.unpinnedActions).toBe(0)
      expect(rep.workflowsMissingPermissions).toBe(0)
      expect(rep.prPushWorkflowsMissingConcurrency).toBe(0)
      // timeout metric is emitted for visibility even when zero
      expect(typeof rep.jobsMissingTimeout).toBe('number')
    } finally {
      t.cleanup()
    }
  })

  it('fails and counts an unpinned action (tag ref, not 40-hex SHA)', () => {
    const t = makeTemp()
    try {
      write(t.wf, '01-pr.yml', HARDENED.replace('@b4ffde65f46336ab88eb53be808477a3936bae11', '@v4'))
      const r = run(t.dir, t.out)
      expect(r.status).toBe(1)
      expect(report(t.out).unpinnedActions).toBeGreaterThanOrEqual(1)
    } finally {
      t.cleanup()
    }
  })

  it('does not count a local (./) action reference as unpinned', () => {
    const t = makeTemp()
    try {
      write(
        t.wf,
        '01-pr.yml',
        HARDENED.replace(
          '- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11',
          '- uses: ./.github/actions/local',
        ),
      )
      const r = run(t.dir, t.out)
      expect(r.status).toBe(0)
      expect(report(t.out).unpinnedActions).toBe(0)
    } finally {
      t.cleanup()
    }
  })

  it('does not match `uses:` appearing inside a run-block shell string', () => {
    const t = makeTemp()
    try {
      const withRunString = HARDENED.replace(
        '        run: echo hi',
        '        run: grep -E "uses: foo/bar@v1" file.txt',
      )
      write(t.wf, '01-pr.yml', withRunString)
      const r = run(t.dir, t.out)
      expect(r.status).toBe(0)
      expect(report(t.out).unpinnedActions).toBe(0)
    } finally {
      t.cleanup()
    }
  })

  it('fails when a workflow lacks a top-level permissions block', () => {
    const t = makeTemp()
    try {
      write(t.wf, '01-pr.yml', HARDENED.replace('permissions:\n  contents: read\n', ''))
      const r = run(t.dir, t.out)
      expect(r.status).toBe(1)
      expect(report(t.out).workflowsMissingPermissions).toBeGreaterThanOrEqual(1)
    } finally {
      t.cleanup()
    }
  })

  it('fails when a pull_request/push workflow lacks concurrency', () => {
    const t = makeTemp()
    try {
      write(
        t.wf,
        '01-pr.yml',
        HARDENED.replace(
          'concurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true\n',
          '',
        ),
      )
      const r = run(t.dir, t.out)
      expect(r.status).toBe(1)
      expect(report(t.out).prPushWorkflowsMissingConcurrency).toBeGreaterThanOrEqual(1)
    } finally {
      t.cleanup()
    }
  })

  it('does not require concurrency on a non-PR/push (schedule-only) workflow', () => {
    const t = makeTemp()
    try {
      const scheduled = `
name: Nightly
on:
  schedule:
    - cron: '0 0 * * *'
permissions:
  contents: read
jobs:
  job:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
        run: echo hi
`
      write(t.wf, '06-nightly.yml', scheduled)
      const r = run(t.dir, t.out)
      expect(r.status).toBe(0)
      expect(report(t.out).prPushWorkflowsMissingConcurrency).toBe(0)
    } finally {
      t.cleanup()
    }
  })

  it('counts jobs missing timeout-minutes (visibility metric, not gated)', () => {
    const t = makeTemp()
    try {
      write(
        t.wf,
        '06-nightly.yml',
        `
name: Nightly
on:
  schedule:
    - cron: '0 0 * * *'
permissions:
  contents: read
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
        run: echo hi
`,
      )
      const r = run(t.dir, t.out)
      // missing timeout alone must NOT fail the gate in this phase
      expect(r.status).toBe(0)
      expect(report(t.out).jobsMissingTimeout).toBeGreaterThanOrEqual(1)
    } finally {
      t.cleanup()
    }
  })
})
