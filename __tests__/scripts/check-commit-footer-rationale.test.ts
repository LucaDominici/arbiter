// SPDX-License-Identifier: Apache-2.0
// Red phase: all tests must FAIL until scripts/check-commit-footer-rationale.mjs is implemented.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-commit-footer-rationale.mjs')

function run(args: string[], cwd: string) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd, timeout: 15000 })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function fixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'commit-footer-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-commit-footer-rationale.mjs (INV-119)', () => {
  it('passes when no suppression-touching commits in range', () => {
    // Run against the real repo — currently no commits touching trivyignore/suppressions in the task branch that lack a footer
    // In a repo with no suppression commits, should exit 0
    const r = run(['--range', 'origin/main..HEAD'], '.')
    // Either passes (0) or hits origin/main unavailable (also 0 with WARN)
    expect([0]).toContain(r.status)
  })

  it('handles --help flag without error', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('commit-footer')
  })

  it('exits 0 (with WARN) when origin/main is unreachable', () => {
    // Run in a temp dir with no git repo — origin/main is unavailable
    const { dir, cleanup } = fixture()
    try {
      // Non-git directory: git log will fail
      const r = run(['--range', 'origin/main..HEAD'], dir)
      // Must exit 0 (warn, not block) when git fails
      expect(r.status).toBe(0)
      // Should emit a warning about unavailability
      expect(r.stderr).toContain('WARN')
    } finally {
      cleanup()
    }
  })

  it('writes evidence artifact JSON on validation', () => {
    const { dir: evidenceDir, cleanup } = fixture()
    try {
      const r = run(['--range', 'origin/main..HEAD', '--evidence-dir', evidenceDir], '.')
      expect(r.status).toBe(0)
      // Evidence file should be created
      const files = readdirSync(evidenceDir)
      expect(files.some((f) => f.endsWith('.json'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('validates evidence artifact has required schema fields', () => {
    const { dir: evidenceDir, cleanup } = fixture()
    try {
      run(['--range', 'origin/main..HEAD', '--evidence-dir', evidenceDir], '.')
      const files = readdirSync(evidenceDir)
      const jsonFile = files.find((f) => f.endsWith('.json'))
      if (jsonFile) {
        const artifact = JSON.parse(readFileSync(join(evidenceDir, jsonFile), 'utf-8')) as Record<
          string,
          unknown
        >
        expect(artifact['schema']).toBe('arbiter-commit-footer-audit-v1')
        expect(artifact).toHaveProperty('generated_at')
        expect(artifact).toHaveProperty('branch')
        expect(artifact).toHaveProperty('range')
        expect(artifact).toHaveProperty('commits_scanned')
        expect(artifact).toHaveProperty('commits_requiring_footer')
        expect(artifact).toHaveProperty('commits_with_valid_footer')
        expect(artifact).toHaveProperty('violations')
        expect(artifact).toHaveProperty('result')
      }
    } finally {
      cleanup()
    }
  })
})

describe('check-commit-footer-rationale.mjs (INV-119) — footer validation', () => {
  it('accepts Suppression-Rationale: trailer format', () => {
    // Test by running the script's validation logic indirectly via --test-trailer flag
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Suppression-Rationale: CVE-2024-1234 | low impact | expires:2026-12-31',
      ],
      '.',
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('VALID')
  })

  it('rejects commit with suppression file but no recognized footer', () => {
    const r = run(['--dry-run', '--test-trailer', ''], '.')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('FOOTER-MISSING')
  })

  it('accepts Pitest-Override-Rationale: trailer format', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Pitest-Override-Rationale: test coverage deferred | follow-up:#9999 | approver:@user',
      ],
      '.',
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('VALID')
  })

  it('accepts Trivy-Expiry-Extension: trailer format', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Trivy-Expiry-Extension: CVE-2024-5678 | new-expiry:2027-01-01 | reason:no fix available',
      ],
      '.',
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('VALID')
  })

  it('accepts Sigstore-Bypass: trailer format', () => {
    const r = run(
      [
        '--dry-run',
        '--test-trailer',
        'Sigstore-Bypass: cosign unavailable | retry-after:2026-07-01',
      ],
      '.',
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('VALID')
  })
})

describe('check-commit-footer-rationale.mjs (INV-119) — suppression-file classification', () => {
  // Regression (wave-E integration): the title-string interpolation hardening of
  // src/templates/suppressions/suppressions-schema.json.ejs falsely tripped the gate.
  // A schema *template* emitted into target projects is not an active security waiver.
  it('does NOT classify EJS suppression templates under src/templates/ as waivers', () => {
    const r = run(['--test-path', 'src/templates/suppressions/suppressions-schema.json.ejs'], '.')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('NOT-SUPPRESSION-FILE')
  })

  it('still classifies a real top-level suppressions/ waiver as a waiver', () => {
    const r = run(['--test-path', 'suppressions/.gitleaksignore'], '.')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('SUPPRESSION-FILE')
  })

  it('still classifies a .trivyignore as a waiver', () => {
    const r = run(['--test-path', '.trivyignore'], '.')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('SUPPRESSION-FILE')
  })
})
