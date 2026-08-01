// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runDoctorToolPins } from '../../src/commands/doctor/tool-pins.js'
import {
  extractToolPins,
  compareSemVer,
  type SemVer,
} from '../../src/commands/doctor/tool-pin-extract.js'

// #2162 — arbiter doctor tool-pins: local toolchain vs CI workflow pins.
// AC-1: fixture with CI pin > local version → FAIL naming tool/local/pin/workflow:line.
// AC-2: tool absent + blocking gate → FAIL; absent + advisory-only → WARN.

let dirs: string[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'arbiter-doctor-toolpins-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

function writeWorkflow(dir: string, name: string, content: string): void {
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  writeFileSync(join(dir, '.github', 'workflows', name), content)
}

describe('extractToolPins (pure)', () => {
  it('extracts a download-url pin, naming the tool after the repo segment', () => {
    const yaml = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Install gitleaks',
      '        run: |',
      '          curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.24.3/gitleaks_8.24.3_linux_x64.tar.gz | tar -xz gitleaks',
      '',
    ].join('\n')
    const pins = extractToolPins(yaml, 'ci.yml')
    expect(pins).toContainEqual(
      expect.objectContaining({
        tool: 'gitleaks',
        version: { major: 8, minor: 24, patch: 3 },
        file: 'ci.yml',
      }),
    )
  })

  it('extracts an env-pin (TOOL_VERSION: X.Y.Z), lowercasing the prefix', () => {
    const yaml = ['env:', '  TRIVY_VERSION: "0.71.0"', 'jobs:', '  build:', '    steps: []'].join(
      '\n',
    )
    const pins = extractToolPins(yaml, 'ci.yml')
    expect(pins).toContainEqual(
      expect.objectContaining({ tool: 'trivy', version: { major: 0, minor: 71, patch: 0 } }),
    )
  })

  it('extracts an action-tag pin requiring at least major.minor', () => {
    const yaml = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: rhysd/actionlint@v1.7',
      '      - uses: actions/checkout@v4',
    ].join('\n')
    const pins = extractToolPins(yaml, 'ci.yml')
    expect(pins).toContainEqual(
      expect.objectContaining({ tool: 'actionlint', version: { major: 1, minor: 7, patch: 0 } }),
    )
    // bare @v4 (no minor) must never match — checkout is not a version-pinned gate tool.
    expect(pins.some((p) => p.tool === 'checkout')).toBe(false)
  })

  it('marks a pin as non-blocking when its job carries a truthy continue-on-error', () => {
    const yaml = [
      'jobs:',
      '  advisory:',
      '    continue-on-error: true',
      '    steps:',
      '      - name: Install hadolint',
      '        run: |',
      '          curl -sSfL https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint | true',
      '',
    ].join('\n')
    const pins = extractToolPins(yaml, 'ci.yml')
    expect(pins.find((p) => p.tool === 'hadolint')?.blocking).toBe(false)
  })

  it('marks a pin as blocking when its job has no continue-on-error', () => {
    const yaml = [
      'jobs:',
      '  gate:',
      '    steps:',
      '      - name: Install shellcheck',
      '        run: |',
      '          curl -sSfL https://github.com/koalaman/shellcheck/releases/download/v0.10.0/shellcheck | true',
      '',
    ].join('\n')
    const pins = extractToolPins(yaml, 'ci.yml')
    expect(pins.find((p) => p.tool === 'shellcheck')?.blocking).toBe(true)
  })

  it('treats every pin as blocking when the workflow has no jobs: key (safe default)', () => {
    const yaml = [
      'name: weird-fragment',
      'on: push',
      '# no jobs: key at all',
      'curl -sSfL https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint | true',
      '',
    ].join('\n')
    const pins = extractToolPins(yaml, 'ci.yml')
    expect(pins.find((p) => p.tool === 'hadolint')?.blocking).toBe(true)
  })
})

describe('compareSemVer (pure)', () => {
  it('compares major, then minor, then patch', () => {
    const a: SemVer = { major: 1, minor: 2, patch: 3 }
    const b: SemVer = { major: 1, minor: 2, patch: 4 }
    expect(compareSemVer(a, b)).toBeLessThan(0)
    expect(compareSemVer(b, a)).toBeGreaterThan(0)
    expect(compareSemVer(a, a)).toBe(0)
    expect(compareSemVer({ major: 2, minor: 0, patch: 0 }, b)).toBeGreaterThan(0)
  })
})

describe('runDoctorToolPins', () => {
  it('AC-1: local version older than the CI pin → FAIL naming tool/local/pin/workflow:line', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'ci.yml',
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install trivy',
        '        run: |',
        '          curl -sSfL https://github.com/aquasecurity/trivy/releases/download/v0.71.0/trivy_0.71.0.tar.gz | tar -xz trivy',
        '',
      ].join('\n'),
    )
    const result = runDoctorToolPins({ dir, localVersionOverride: { trivy: '0.55.2' } })
    const row = result.checks.find((c) => c.id === 'tool-pin-trivy')
    expect(row?.status).toBe('FAIL')
    expect(row?.detail).toContain('trivy')
    expect(row?.detail).toContain('0.55.2')
    expect(row?.detail).toContain('0.71.0')
    expect(row?.detail).toContain('ci.yml:')
    expect(result.exitCode).toBe(1)
  })

  it('AC-2: tool absent in a blocking gate → FAIL', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'ci.yml',
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install hadolint',
        '        run: |',
        '          curl -sSfL https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint | true',
        '',
      ].join('\n'),
    )
    const result = runDoctorToolPins({ dir, localVersionOverride: { hadolint: null } })
    const row = result.checks.find((c) => c.id === 'tool-pin-hadolint')
    expect(row?.status).toBe('FAIL')
    expect(result.exitCode).toBe(1)
  })

  it('AC-2: tool absent in an advisory-only (continue-on-error) gate → WARN', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'ci.yml',
      [
        'jobs:',
        '  advisory:',
        '    continue-on-error: true',
        '    steps:',
        '      - name: Install hadolint',
        '        run: |',
        '          curl -sSfL https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint | true',
        '',
      ].join('\n'),
    )
    const result = runDoctorToolPins({ dir, localVersionOverride: { hadolint: null } })
    const row = result.checks.find((c) => c.id === 'tool-pin-hadolint')
    expect(row?.status).toBe('WARN')
    // WARN never flips the exit code (doctor health convention).
    expect(result.exitCode).toBe(0)
  })

  it('local version at or above the pin → PASS', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'ci.yml',
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install trivy',
        '        run: |',
        '          curl -sSfL https://github.com/aquasecurity/trivy/releases/download/v0.71.0/trivy_0.71.0.tar.gz | tar -xz trivy',
        '',
      ].join('\n'),
    )
    const result = runDoctorToolPins({ dir, localVersionOverride: { trivy: '0.71.0' } })
    expect(result.checks.find((c) => c.id === 'tool-pin-trivy')?.status).toBe('PASS')
    expect(result.exitCode).toBe(0)
  })

  it('unparseable local --version output → WARN', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'ci.yml',
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install trivy',
        '        run: |',
        '          curl -sSfL https://github.com/aquasecurity/trivy/releases/download/v0.71.0/trivy_0.71.0.tar.gz | tar -xz trivy',
        '',
      ].join('\n'),
    )
    const result = runDoctorToolPins({ dir, localVersionOverride: { trivy: 'not-a-version' } })
    expect(result.checks.find((c) => c.id === 'tool-pin-trivy')?.status).toBe('WARN')
  })

  it('emits a --json envelope', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'ci.yml',
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install trivy',
        '        run: |',
        '          curl -sSfL https://github.com/aquasecurity/trivy/releases/download/v0.71.0/trivy_0.71.0.tar.gz | tar -xz trivy',
        '',
      ].join('\n'),
    )
    let written = ''
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written += chunk.toString()
        return true
      })
    try {
      runDoctorToolPins({ dir, json: true, localVersionOverride: { trivy: '0.71.0' } })
    } finally {
      spy.mockRestore()
    }
    const envelope = JSON.parse(written)
    expect(envelope.command).toBe('doctor tool-pins')
    expect(envelope.data.checks.length).toBeGreaterThan(0)
  })

  it('--json envelope reports status "error" when a check fails', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'ci.yml',
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install trivy',
        '        run: |',
        '          curl -sSfL https://github.com/aquasecurity/trivy/releases/download/v0.71.0/trivy_0.71.0.tar.gz | tar -xz trivy',
        '',
      ].join('\n'),
    )
    let written = ''
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written += chunk.toString()
        return true
      })
    try {
      runDoctorToolPins({ dir, json: true, localVersionOverride: { trivy: '0.55.2' } })
    } finally {
      spy.mockRestore()
    }
    expect(JSON.parse(written).status).toBe('error')
  })

  it('no .github/workflows dir on the target → zero checks, exit 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-doctor-toolpins-nowf-'))
    try {
      const result = runDoctorToolPins({ dir })
      expect(result.checks).toEqual([])
      expect(result.exitCode).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('defaults --dir to the current working directory when omitted', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'ci.yml',
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install trivy',
        '        run: |',
        '          curl -sSfL https://github.com/aquasecurity/trivy/releases/download/v0.71.0/trivy_0.71.0.tar.gz | tar -xz trivy',
        '',
      ].join('\n'),
    )
    const originalCwd = process.cwd()
    process.chdir(dir)
    try {
      const result = runDoctorToolPins({ localVersionOverride: { trivy: '0.71.0' } })
      expect(result.checks.find((c) => c.id === 'tool-pin-trivy')?.status).toBe('PASS')
    } finally {
      process.chdir(originalCwd)
    }
  })

  it('picks up a .yaml (not just .yml) workflow file', () => {
    const dir = tmpDir()
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(
      join(dir, '.github', 'workflows', 'ci.yaml'),
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install trivy',
        '        run: |',
        '          curl -sSfL https://github.com/aquasecurity/trivy/releases/download/v0.71.0/trivy_0.71.0.tar.gz | tar -xz trivy',
        '',
      ].join('\n'),
    )
    const result = runDoctorToolPins({ dir, localVersionOverride: { trivy: '0.71.0' } })
    expect(result.checks.find((c) => c.id === 'tool-pin-trivy')?.status).toBe('PASS')
  })

  it('dedupes the same tool pinned at two sites: keeps the max version, blocking if any site is', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'advisory.yml',
      [
        'jobs:',
        '  advisory:',
        '    continue-on-error: true',
        '    steps:',
        '      - name: Install trivy (advisory)',
        '        run: |',
        '          curl -sSfL https://github.com/aquasecurity/trivy/releases/download/v0.60.0/trivy_0.60.0.tar.gz | tar -xz trivy',
        '',
      ].join('\n'),
    )
    writeWorkflow(
      dir,
      'gate.yml',
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install trivy (blocking)',
        '        run: |',
        '          curl -sSfL https://github.com/aquasecurity/trivy/releases/download/v0.71.0/trivy_0.71.0.tar.gz | tar -xz trivy',
        '',
      ].join('\n'),
    )
    const result = runDoctorToolPins({ dir, localVersionOverride: { trivy: '0.65.0' } })
    const rows = result.checks.filter((c) => c.id === 'tool-pin-trivy')
    expect(rows).toHaveLength(1) // deduped to one row, not two
    // max version (0.71.0) wins over the lower 0.60.0 site, and blocking=true wins over false.
    expect(rows[0]?.detail).toContain('0.71.0')
    expect(rows[0]?.status).toBe('FAIL') // 0.65.0 < 0.71.0, and the merged row is blocking
  })

  it('real (non-override) probe: absent tool surfaces via the actual runCli path', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'ci.yml',
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install a tool that does not exist',
        '        run: |',
        '          curl -sSfL https://github.com/nobody/arbiter-test-nonexistent-tool-xyz/releases/download/v1.0.0/x.tar.gz | tar -xz x',
        '',
      ].join('\n'),
    )
    // No localVersionOverride — exercises the real runCli(...) call and its CliError.notFound
    // catch path, not the test-only DI seam.
    const result = runDoctorToolPins({ dir })
    const row = result.checks.find((c) => c.id === 'tool-pin-arbiter-test-nonexistent-tool-xyz')
    expect(row?.status).toBe('FAIL')
    expect(row?.detail).toContain('not found locally')
  })

  it('real (non-override) probe: an actually-installed tool (git) resolves via runCli', () => {
    const dir = tmpDir()
    writeWorkflow(
      dir,
      'ci.yml',
      [
        'jobs:',
        '  gate:',
        '    steps:',
        '      - name: Install git',
        '        run: |',
        '          curl -sSfL https://github.com/git/git/releases/download/v0.0.1/git.tar.gz | tar -xz git',
        '',
      ].join('\n'),
    )
    const result = runDoctorToolPins({ dir })
    const row = result.checks.find((c) => c.id === 'tool-pin-git')
    // git is present on every CI/dev box this gate runs on; whatever its real version, it is
    // >= the absurdly low 0.0.1 pin above, so this is PASS via the real (uncached) probe.
    expect(row?.status).toBe('PASS')
  })
})

describe('doctor tool-pins via CLI subprocess (#2162)', () => {
  // Regression guard for a real defect the manual dogfood step (plan §Sequence 4) caught: the
  // parent `doctor` command declares --dir/--json too, and commander binds a same-named flag to
  // whichever command defines it first when they collide — `cmd.opts()` on the subcommand
  // silently dropped both, always falling back to cwd + text mode. The unit tests above call
  // runDoctorToolPins() directly and cannot see this class of bug (it lives entirely in cli.ts's
  // commander wiring); only a real subprocess invocation exercises the actual argv parse.
  it('--dir and --json both take effect through the real CLI parser', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-doctor-toolpins-cli-'))
    try {
      // No .github/workflows/ → zero pins → exit 0, so this doesn't fight process.exit(1).
      const result = spawnSync(
        'node',
        ['dist/cli.js', 'doctor', 'tool-pins', '--dir', dir, '--json'],
        {
          encoding: 'utf-8',
        },
      )
      expect(result.status).toBe(0)
      const envelope = JSON.parse(result.stdout)
      expect(envelope.command).toBe('doctor tool-pins')
      expect(envelope.data.checks).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
