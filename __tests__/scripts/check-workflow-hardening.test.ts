// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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

  // ---- cancel-in-progress classification (#1497): deploy/audit/release must not be cancellable ----
  // A scheduled audit workflow (no pull_request trigger) — each run produces a required result that
  // a later run does not reproduce, so a silent cancel is a false-green.
  const SCHEDULED_AUDIT = `
name: License Scan
on:
  schedule:
    - cron: '0 5 * * 1'
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: license-scan
  cancel-in-progress: CANCEL
jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
        run: echo hi
`

  it('fails when a deploy/audit/release workflow has cancellable concurrency (false-green)', () => {
    const t = makeTemp()
    try {
      write(t.wf, '14-license-scan.yml', SCHEDULED_AUDIT.replace('CANCEL', 'true'))
      const r = run(t.dir, t.out)
      expect(r.status).toBe(1)
      expect(report(t.out).cancellableDeployAuditWorkflows).toBeGreaterThanOrEqual(1)
      expect(r.stdout).toMatch(/cancel-in-progress must be false/)
    } finally {
      t.cleanup()
    }
  })

  it('passes when that same audit workflow sets cancel-in-progress: false', () => {
    const t = makeTemp()
    try {
      write(t.wf, '14-license-scan.yml', SCHEDULED_AUDIT.replace('CANCEL', 'false'))
      const r = run(t.dir, t.out)
      expect(r.status).toBe(0)
      expect(report(t.out).cancellableDeployAuditWorkflows).toBe(0)
    } finally {
      t.cleanup()
    }
  })

  it('also flags a cancellable expression (not a literal false) on a deploy workflow', () => {
    const t = makeTemp()
    try {
      write(
        t.wf,
        '10-deploy-prod.yml',
        SCHEDULED_AUDIT.replace('License Scan', 'Deploy Prod').replace(
          'cancel-in-progress: CANCEL',
          "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
        ),
      )
      const r = run(t.dir, t.out)
      expect(r.status).toBe(1)
      expect(report(t.out).cancellableDeployAuditWorkflows).toBeGreaterThanOrEqual(1)
    } finally {
      t.cleanup()
    }
  })

  it('does NOT flag a pull_request-triggered audit (codeql) with cancellable concurrency', () => {
    const t = makeTemp()
    try {
      // CodeQL on a PR: a new commit supersedes the in-flight scan — cancelling is correct.
      const codeql = `
name: CodeQL
on:
  pull_request:
  push:
  schedule:
    - cron: '0 4 * * 1'
permissions:
  contents: read
concurrency:
  group: codeql-\${{ github.head_ref || github.ref_name }}
  cancel-in-progress: true
jobs:
  analyze:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
        run: echo hi
`
      write(t.wf, '15-codeql.yml', codeql)
      const r = run(t.dir, t.out)
      expect(r.status).toBe(0)
      expect(report(t.out).cancellableDeployAuditWorkflows).toBe(0)
    } finally {
      t.cleanup()
    }
  })

  it('does NOT flag a non-deploy/audit workflow (heartbeat) that is schedule + cancellable', () => {
    const t = makeTemp()
    try {
      const heartbeat = `
name: Heartbeat
on:
  schedule:
    - cron: '*/30 * * * *'
permissions:
  contents: read
concurrency:
  group: heartbeat
  cancel-in-progress: true
jobs:
  ping:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
        run: echo hi
`
      write(t.wf, '09-heartbeat.yml', heartbeat)
      const r = run(t.dir, t.out)
      expect(r.status).toBe(0)
      expect(report(t.out).cancellableDeployAuditWorkflows).toBe(0)
    } finally {
      t.cleanup()
    }
  })

  it('fails when a numbered-tier job is missing timeout-minutes (#1485, now gated)', () => {
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
      expect(r.status).toBe(1)
      expect(report(t.out).jobsMissingTimeout).toBeGreaterThanOrEqual(1)
    } finally {
      t.cleanup()
    }
  })

  // #2123 (recurrence of #1987): `github.head_ref || github.ref` yields TWO different
  // group strings for the same branch — `task/x` on pull_request vs `refs/heads/task/x`
  // on push — so cancel-in-progress never fires across the pair and both runs execute
  // the full gate concurrently. `github.ref_name` strips `refs/heads/`, unifying them.
  it('fails when a concurrency group falls back to github.ref instead of github.ref_name', () => {
    const t = makeTemp()
    try {
      write(
        t.wf,
        '01-pr.yml',
        HARDENED.replace(
          'group: ${{ github.workflow }}-${{ github.ref }}',
          'group: pr-fast-${{ github.head_ref || github.ref }}',
        ),
      )
      const r = run(t.dir, t.out)
      expect(r.status).toBe(1)
      expect(report(t.out).concurrencyGroupRefFallback).toBeGreaterThanOrEqual(1)
    } finally {
      t.cleanup()
    }
  })

  it('accepts a concurrency group that falls back to github.ref_name', () => {
    const t = makeTemp()
    try {
      write(
        t.wf,
        '01-pr.yml',
        HARDENED.replace(
          'group: ${{ github.workflow }}-${{ github.ref }}',
          'group: pr-fast-${{ github.head_ref || github.ref_name }}',
        ),
      )
      const r = run(t.dir, t.out)
      expect(r.status).toBe(0)
      expect(report(t.out).concurrencyGroupRefFallback).toBe(0)
    } finally {
      t.cleanup()
    }
  })
})

// The gate above scans .github/workflows (what runs in arbiter's own CI). The same
// defect ships to every governed project through the EJS templates, which that gate
// never sees — this ratchet covers the emitted side (CANON-18 render parity).
describe('#2123 workflow templates never fall back to github.ref in a concurrency group', () => {
  function walkEjs(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walkEjs(join(dir, e.name))
        : e.name.endsWith('.ejs')
          ? [join(dir, e.name)]
          : [],
    )
  }

  it('every head_ref fallback in a workflow template uses github.ref_name', () => {
    const offenders = walkEjs(resolve('src/templates/github/workflows')).filter((f) =>
      /github\.head_ref\s*\|\|\s*github\.ref\s*}}/.test(readFileSync(f, 'utf-8')),
    )
    expect(offenders).toEqual([])
  })
})
