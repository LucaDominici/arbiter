// SPDX-License-Identifier: Apache-2.0
// TDD guard for #1756 — docker-container actions (e.g. bridgecrewio/checkov-action)
// bind-mount the workspace from the DOCKER HOST when the runner itself executes
// inside a container (self-hosted "slot" runners), not from the containerized
// runner slot's own checkout — so the action sees stale/missing/host-path content
// instead of the PR head SHA. GitHub-hosted runners (ubuntu-latest et al.) are not
// containerized this way and are unaffected. A job that mixes a docker-container
// action with a self-hosted-capable `runs-on:` (any GitHub Actions expression,
// e.g. `${{ fromJSON(vars.RUNNER_LABELS_TEST || '["ubuntu-latest"]') }}`) risks
// silently reading the wrong workspace; this gate fails such a combination closed.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-docker-action-runner-safety.mjs')

function run(dir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: dir })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'check-docker-action-runner-safety-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-docker-action-runner-safety.mjs (#1756)', () => {
  it('fails when a docker-container action runs under an expression-based (self-hosted-capable) runner', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        [
          'jobs:',
          '  iac-scan:',
          '    runs-on: ${{ fromJSON(vars.RUNNER_LABELS_TEST || \'["ubuntu-latest"]\') }}',
          '    steps:',
          '      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
          '      - uses: bridgecrewio/checkov-action@99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
          '',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('bridgecrewio/checkov-action')
      expect(result.stderr).toContain('iac-scan')
    } finally {
      cleanup()
    }
  })

  it('fails on a bare docker:// action reference under a self-hosted-capable runner', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        [
          'jobs:',
          '  scan:',
          '    runs-on: ${{ fromJSON(vars.RUNNER_LABELS_TEST || \'["ubuntu-latest"]\') }}',
          '    steps:',
          '      - uses: docker://alpine:3.18',
          '',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('docker://alpine:3.18')
    } finally {
      cleanup()
    }
  })

  it('passes when the docker-container action job is pinned to a literal GitHub-hosted runner', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        [
          'jobs:',
          '  iac-scan:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
          '      - uses: bridgecrewio/checkov-action@99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
          '',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('passes when no docker-container action is present, regardless of runner expression', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        [
          'jobs:',
          '  build:',
          '    runs-on: ${{ fromJSON(vars.RUNNER_LABELS_TEST || \'["ubuntu-latest"]\') }}',
          '    steps:',
          '      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
          '      - uses: actions/setup-node@abc0000000000000000000000000000000000000',
          '',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('also scans workflow templates (.ejs) under src/templates, not just .github/workflows', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'src', 'templates', 'github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'templates', 'github', 'workflows', '01-pr-fast.yml.ejs'),
        [
          'jobs:',
          '  iac-scan:',
          '    runs-on: ${{ fromJSON(vars.RUNNER_LABELS_TEST || \'["ubuntu-latest"]\') }}',
          '    steps:',
          '      - uses: bridgecrewio/checkov-action@99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
          '',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('01-pr-fast.yml.ejs')
    } finally {
      cleanup()
    }
  })

  it('reports clean with no workflow or template files present', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails on the bare EJS output-tag indirection pattern used by workflow templates (<%- _runner %>)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'src', 'templates', 'github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'templates', 'github', 'workflows', '06-nightly-lite.yml.ejs'),
        [
          '<%',
          'const _runner = "${{ fromJSON(vars.RUNNER_LABELS_TEST || \'[\\"ubuntu-latest\\"]\') }}";',
          '%>jobs:',
          '  iac-scan:',
          '    runs-on: <%- _runner %>',
          '    steps:',
          '      - uses: bridgecrewio/checkov-action@99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
          '',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('bridgecrewio/checkov-action')
    } finally {
      cleanup()
    }
  })

  it('fails when a docker-container action runs under a literal, non-GitHub-hosted (custom self-hosted) label', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        [
          'jobs:',
          '  iac-scan:',
          '    runs-on: arbiter-slot-build-4',
          '    steps:',
          '      - uses: bridgecrewio/checkov-action@99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
          '',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('arbiter-slot-build-4')
    } finally {
      cleanup()
    }
  })

  it.each([
    ['zaproxy/action-full-scan', 'd2a07475d467566c9a3e3c700f31f47724aa1060'],
    ['zaproxy/action-baseline', '66042c8e7e24680119199a017e5b0e8603bf4dae'],
  ])(
    'fails when the Docker-outside-of-Docker action %s runs under a self-hosted-capable runner',
    (action, sha) => {
      const { dir, cleanup } = makeDir()
      try {
        mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
        writeFileSync(
          join(dir, '.github', 'workflows', 'ci.yml'),
          [
            'jobs:',
            '  scan:',
            '    runs-on: ${{ fromJSON(vars.RUNNER_LABELS_TEST || \'["ubuntu-latest"]\') }}',
            '    steps:',
            `      - uses: ${action}@${sha}`,
            '',
          ].join('\n'),
        )
        const result = run(dir)
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(action)
      } finally {
        cleanup()
      }
    },
  )

  it('crashes non-zero (fail-closed) rather than reporting OK when a workflow file cannot be read', () => {
    const { dir, cleanup } = makeDir()
    try {
      const workflowsDir = join(dir, '.github', 'workflows')
      mkdirSync(workflowsDir, { recursive: true })
      const unreadable = join(workflowsDir, 'unreadable.yml')
      writeFileSync(unreadable, 'jobs:\n  build:\n    runs-on: ubuntu-latest\n')
      // Skip on CI where processes may run as root (root ignores chmod)
      if (process.getuid?.() === 0) return
      // 0 permissions makes readFileSync throw EACCES for a non-root process.
      chmodSync(unreadable, 0o000)
      const result = run(dir)
      expect(result.status).not.toBe(0)
      expect(result.stdout).not.toContain('OK')
    } finally {
      chmodSync(join(dir, '.github', 'workflows', 'unreadable.yml'), 0o644)
      cleanup()
    }
  })
})
