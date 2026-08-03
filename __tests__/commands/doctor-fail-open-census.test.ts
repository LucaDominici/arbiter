// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctorFailOpenCensus } from '../../src/commands/doctor/fail-open-census.js'

// #2162 — arbiter doctor fail-open-census: bash `command -v X || <fail open>` presence-gate scan.
// AC-3: deterministic file:line list; allowlist entry missing `reason` → exit 2.
// AC-4: read-only — never writes to the target.

let dirs: string[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'arbiter-doctor-failopen-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

function writeScript(dir: string, relPath: string, content: string): void {
  const full = join(dir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('runDoctorFailOpenCensus', () => {
  it('finds all three fail-open variants with deterministic, sorted file:line output', () => {
    const dir = tmpDir()
    writeScript(
      dir,
      'scripts/gate.sh',
      [
        '#!/usr/bin/env bash',
        'command -v gh >/dev/null 2>&1 || { echo "gh missing"; return 0; }',
        'command -v jq >/dev/null 2>&1 || exit 0',
        'if ! command -v yq >/dev/null 2>&1; then',
        '  echo "yq missing"',
        '  exit 0',
        'fi',
        '',
      ].join('\n'),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(3)
    expect(result.findings.map((f) => f.tool)).toEqual(['gh', 'jq', 'yq'])
    // sorted by (file, line) — line numbers ascending within the single file.
    const lines = result.findings.map((f) => f.line)
    expect(lines).toEqual([...lines].sort((a, b) => a - b))
    expect(result.exitCode).toBe(1)
  })

  it('suppresses an allowlisted finding from the FAIL count but still reports it', () => {
    const dir = tmpDir()
    writeScript(dir, 'scripts/gate.sh', ['command -v gh >/dev/null 2>&1 || exit 0', ''].join('\n'))
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'fail-open-allowlist.json'),
      JSON.stringify({
        entries: [{ file: 'scripts/gate.sh', line: 1, reason: 'gh optional, advisory-only' }],
      }),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.allowlisted).toBe('gh optional, advisory-only')
    expect(result.exitCode).toBe(0)
  })

  it('exits 2 when an allowlist entry is missing a reason, before reporting findings', () => {
    const dir = tmpDir()
    writeScript(dir, 'scripts/gate.sh', ['command -v gh >/dev/null 2>&1 || exit 0', ''].join('\n'))
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'fail-open-allowlist.json'),
      JSON.stringify({ entries: [{ file: 'scripts/gate.sh', line: 1, reason: '' }] }),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.exitCode).toBe(2)
  })

  it('reports zero findings and exit 0 for a clean script', () => {
    const dir = tmpDir()
    writeScript(
      dir,
      'scripts/gate.sh',
      ['#!/usr/bin/env bash', 'set -euo pipefail', 'command -v gh >/dev/null 2>&1', ''].join('\n'),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(0)
    expect(result.exitCode).toBe(0)
  })

  it('finds a positive command -v guard with no else because absence skips blocking work', () => {
    const dir = tmpDir()
    writeScript(
      dir,
      'scripts/gate.sh',
      [
        'if command -v shellcheck >/dev/null 2>&1; then',
        '  shellcheck scripts/*.sh',
        'fi',
        '',
      ].join('\n'),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.tool).toBe('shellcheck')
  })

  it('a nested else inside the guard body does not mask the finding', () => {
    const dir = tmpDir()
    writeScript(
      dir,
      'scripts/gate.sh',
      [
        'if command -v yamllint >/dev/null 2>&1; then',
        '  _yml=$(echo "$_staged" | grep -E \'.ya?ml$\' || true)',
        '  if [ -n "$_yml" ]; then',
        '    if [ -f .yamllint.yml ]; then',
        '      echo "$_yml" | xargs yamllint || exit 1',
        '    else',
        '      echo "$_yml" | xargs yamllint -d relaxed || exit 1',
        '    fi',
        '  fi',
        'fi',
        '',
      ].join('\n'),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.tool).toBe('yamllint')
  })

  it('finds a positive command -v guard whose else only warns because absence is non-fatal', () => {
    const dir = tmpDir()
    writeScript(
      dir,
      'scripts/gate.sh',
      [
        'if command -v gitleaks &>/dev/null; then',
        '  gitleaks detect --no-git',
        'else',
        '  echo "WARNING: gitleaks is not installed"',
        'fi',
        '',
      ].join('\n'),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.tool).toBe('gitleaks')
  })

  it('does not find a positive command -v guard whose absence exits 1', () => {
    const dir = tmpDir()
    writeScript(
      dir,
      'scripts/gate.sh',
      [
        'if command -v yamllint >/dev/null 2>&1; then',
        '  yamllint .',
        'else',
        '  echo "yamllint required" >&2',
        '  exit 1',
        'fi',
        '',
      ].join('\n'),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(0)
    expect(result.exitCode).toBe(0)
  })

  it('honors a custom --allowlist path override', () => {
    const dir = tmpDir()
    writeScript(dir, 'scripts/gate.sh', ['command -v gh >/dev/null 2>&1 || exit 0', ''].join('\n'))
    writeFileSync(
      join(dir, 'custom-allowlist.json'),
      JSON.stringify({ entries: [{ file: 'scripts/gate.sh', line: 1, reason: 'custom' }] }),
    )
    const result = runDoctorFailOpenCensus({
      dir,
      allowlistPath: join(dir, 'custom-allowlist.json'),
    })
    expect(result.findings[0]?.allowlisted).toBe('custom')
    expect(result.exitCode).toBe(0)
  })

  it('recurses into nested subdirectories and skips node_modules/.git/data', () => {
    const dir = tmpDir()
    writeScript(dir, 'scripts/nested/deep/gate.sh', 'command -v gh >/dev/null 2>&1 || exit 0\n')
    // These must NOT be scanned even though they sit under scripts/.
    writeScript(dir, 'scripts/node_modules/pkg/x.sh', 'command -v jq >/dev/null 2>&1 || exit 0\n')
    writeScript(dir, 'scripts/data/y.sh', 'command -v yq >/dev/null 2>&1 || exit 0\n')
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.tool).toBe('gh')
  })

  it('skips a dangling symlink entry instead of erroring', () => {
    const dir = tmpDir()
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'gate.sh'), 'command -v gh >/dev/null 2>&1 || exit 0\n')
    symlinkSync(join(dir, 'scripts', 'does-not-exist'), join(dir, 'scripts', 'dangling'))
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.tool).toBe('gh')
  })

  it('an if-guard that does NOT exit/return 0 is not a finding (real, intentional error handling)', () => {
    const dir = tmpDir()
    writeScript(
      dir,
      'scripts/gate.sh',
      [
        'if ! command -v gh >/dev/null 2>&1; then',
        '  echo "gh required" >&2',
        '  exit 1',
        'fi',
        '',
      ].join('\n'),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(0)
  })

  it('an if-guard with no matching fi falls back to end-of-file (no crash)', () => {
    const dir = tmpDir()
    writeScript(
      dir,
      'scripts/gate.sh',
      ['if ! command -v gh >/dev/null 2>&1; then', '  echo "gh missing"', '  exit 0', ''].join(
        '\n',
      ),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.tool).toBe('gh')
  })

  it('sorts findings across multiple files by filename when lines collide', () => {
    const dir = tmpDir()
    writeScript(dir, 'scripts/b.sh', 'command -v gh >/dev/null 2>&1 || exit 0\n')
    writeScript(dir, 'scripts/a.sh', 'command -v jq >/dev/null 2>&1 || exit 0\n')
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.findings.map((f) => f.file)).toEqual(['scripts/a.sh', 'scripts/b.sh'])
  })

  it('a whitespace-only allowlist reason is treated as missing → exit 2', () => {
    const dir = tmpDir()
    writeScript(dir, 'scripts/gate.sh', 'command -v gh >/dev/null 2>&1 || exit 0\n')
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'fail-open-allowlist.json'),
      JSON.stringify({ entries: [{ file: 'scripts/gate.sh', line: 1, reason: '   ' }] }),
    )
    const result = runDoctorFailOpenCensus({ dir })
    expect(result.exitCode).toBe(2)
  })

  describe('--json envelope', () => {
    function captureStdout(fn: () => void): string {
      let written = ''
      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          written += chunk.toString()
          return true
        })
      try {
        fn()
      } finally {
        spy.mockRestore()
      }
      return written
    }

    it('reports status "ok" for a clean census', () => {
      const dir = tmpDir()
      writeScript(dir, 'scripts/gate.sh', 'set -euo pipefail\ncommand -v gh >/dev/null 2>&1\n')
      const written = captureStdout(() => {
        runDoctorFailOpenCensus({ dir, json: true })
      })
      const envelope = JSON.parse(written)
      expect(envelope.command).toBe('doctor fail-open-census')
      expect(envelope.status).toBe('ok')
    })

    it('reports status "error" when an unsuppressed finding exists', () => {
      const dir = tmpDir()
      writeScript(dir, 'scripts/gate.sh', 'command -v gh >/dev/null 2>&1 || exit 0\n')
      const written = captureStdout(() => {
        runDoctorFailOpenCensus({ dir, json: true })
      })
      expect(JSON.parse(written).status).toBe('error')
    })

    it('reports status "error" via stdout JSON when the allowlist is malformed', () => {
      const dir = tmpDir()
      writeScript(dir, 'scripts/gate.sh', 'command -v gh >/dev/null 2>&1 || exit 0\n')
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeFileSync(
        join(dir, '.arbiter', 'fail-open-allowlist.json'),
        JSON.stringify({ entries: [{ file: 'scripts/gate.sh', line: 1, reason: '' }] }),
      )
      const written = captureStdout(() => {
        runDoctorFailOpenCensus({ dir, json: true })
      })
      const envelope = JSON.parse(written)
      expect(envelope.status).toBe('error')
      expect(envelope.errors[0]).toContain('reason')
    })
  })
})
