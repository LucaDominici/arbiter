// SPDX-License-Identifier: Apache-2.0
// TDD red-phase test for #868: apply-branch-protection.mjs
// Verifies: --dry-run flag, exit codes (INV-53), required fields in PUT body.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/apply-branch-protection.mjs')

function run(
  args: string[] = [],
  env: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('apply-branch-protection.mjs (#868)', () => {
  describe('--dry-run mode', () => {
    it('exits 0 in dry-run without a real GH_TOKEN', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo'])
      expect(result.status).toBe(0)
    })

    it('prints [DRY-RUN] prefix in dry-run mode', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo'])
      const output = result.stdout + result.stderr
      expect(output).toContain('[DRY-RUN]')
    })

    it('prints the repository being targeted', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo'])
      const output = result.stdout + result.stderr
      expect(output).toContain('owner/repo')
    })

    it('prints the branch being protected', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--branch', 'main'])
      const output = result.stdout + result.stderr
      expect(output).toContain('main')
    })

    it('shows CI Required in the dry-run output', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo'])
      const output = result.stdout + result.stderr
      expect(output).toContain('CI Required')
    })

    it('shows Human Approval Required in the dry-run output', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo'])
      const output = result.stdout + result.stderr
      expect(output).toContain('Human Approval Required')
    })

    it('prints Dry-run complete at end', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo'])
      const output = result.stdout + result.stderr
      expect(output).toContain('Dry-run complete')
    })
  })

  describe('argument validation (INV-53: exit 2 on invocation error)', () => {
    it('exits 2 when --repo is missing and GITHUB_REPOSITORY not set', () => {
      const result = run([], { GITHUB_REPOSITORY: '', GH_TOKEN: 'fake' })
      expect(result.status).toBe(2)
    })

    it('prints usage hint on missing --repo', () => {
      const result = run([], { GITHUB_REPOSITORY: '', GH_TOKEN: 'fake' })
      const output = result.stdout + result.stderr
      expect(output).toMatch(/--repo|Usage/i)
    })

    it('accepts --repo via GITHUB_REPOSITORY env fallback', () => {
      const result = run(['--dry-run'], { GITHUB_REPOSITORY: 'owner/repo' })
      expect(result.status).toBe(0)
    })
  })

  describe('PUT body structure (dry-run JSON preview)', () => {
    it('dry-run --json flag emits valid JSON with required_status_checks', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      expect(result.status).toBe(0)
      let parsed: unknown
      try {
        parsed = JSON.parse(result.stdout.trim())
      } catch {
        throw new Error(`stdout is not valid JSON: ${result.stdout}`)
      }
      expect(parsed).toHaveProperty('required_status_checks')
    })

    it('dry-run --json body includes CI Required context (job name, not job id)', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      const body = JSON.parse(result.stdout.trim()) as {
        required_status_checks: { contexts: string[] }
      }
      expect(body.required_status_checks.contexts).toContain('CI Required')
    })

    it('dry-run --json body includes Human Approval Required (INV-74) context (job name, not job id)', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      const body = JSON.parse(result.stdout.trim()) as {
        required_status_checks: { contexts: string[] }
      }
      expect(body.required_status_checks.contexts).toContain('Human Approval Required (INV-74)')
    })

    it('dry-run --json body has allow_force_pushes: false', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      const body = JSON.parse(result.stdout.trim()) as { allow_force_pushes: boolean }
      expect(body.allow_force_pushes).toBe(false)
    })

    it('dry-run --json body has allow_deletions: false', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      const body = JSON.parse(result.stdout.trim()) as { allow_deletions: boolean }
      expect(body.allow_deletions).toBe(false)
    })
  })

  describe('--snapshot flag', () => {
    it('--snapshot flag is accepted in dry-run mode', () => {
      const result = run([
        '--dry-run',
        '--repo',
        'owner/repo',
        '--snapshot',
        '/tmp/test-snapshot.json',
      ])
      expect(result.status).toBe(0)
    })
  })
})
