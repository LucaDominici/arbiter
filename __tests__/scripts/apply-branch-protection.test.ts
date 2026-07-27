// SPDX-License-Identifier: Apache-2.0
// TDD red-phase test for #868: apply-branch-protection.mjs
// Verifies: --dry-run flag, exit codes (INV-53), required fields in PUT body.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

    it('does not require the impossible self-approval context in trunk-solo', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo'])
      const output = result.stdout + result.stderr
      expect(output).not.toContain('Human Approval Required')
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
    it('dry-run --json flag emits valid JSON with branchProtection and repoSettings keys (INV-101)', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      expect(result.status).toBe(0)
      let parsed: unknown
      try {
        parsed = JSON.parse(result.stdout.trim())
      } catch {
        throw new Error(`stdout is not valid JSON: ${result.stdout}`)
      }
      expect(parsed).toHaveProperty('branchProtection')
      expect(parsed).toHaveProperty('repoSettings')
      expect(parsed).toHaveProperty('branchProtection.required_status_checks')
    })

    it('dry-run --json branchProtection includes CI Required context (job name, not job id)', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      const parsed = JSON.parse(result.stdout.trim()) as {
        branchProtection: { required_status_checks: { contexts: string[] } }
      }
      expect(parsed.branchProtection.required_status_checks.contexts).toContain('CI Required')
    })

    it('dry-run --json omits Human Approval Required in trunk-solo', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      const parsed = JSON.parse(result.stdout.trim()) as {
        branchProtection: { required_status_checks: { contexts: string[] } }
      }
      expect(parsed.branchProtection.required_status_checks.contexts).not.toContain(
        'Human Approval Required (INV-74)',
      )
    })

    it('dry-run --json branchProtection has allow_force_pushes: false', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      const parsed = JSON.parse(result.stdout.trim()) as {
        branchProtection: { allow_force_pushes: boolean }
      }
      expect(parsed.branchProtection.allow_force_pushes).toBe(false)
    })

    it('dry-run --json branchProtection has allow_deletions: false', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      const parsed = JSON.parse(result.stdout.trim()) as {
        branchProtection: { allow_deletions: boolean }
      }
      expect(parsed.branchProtection.allow_deletions).toBe(false)
    })

    it('dry-run --json repoSettings has allow_squash_merge:false and allow_rebase_merge:false (INV-101)', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      const parsed = JSON.parse(result.stdout.trim()) as {
        repoSettings: {
          allow_merge_commit: boolean
          allow_squash_merge: boolean
          allow_rebase_merge: boolean
        }
      }
      expect(parsed.repoSettings.allow_merge_commit).toBe(true)
      expect(parsed.repoSettings.allow_squash_merge).toBe(false)
      expect(parsed.repoSettings.allow_rebase_merge).toBe(false)
    })

    it('dry-run --json disables linear-history; exact SHA is enforced by atomic CAS (INV-101)', () => {
      const result = run(['--dry-run', '--repo', 'owner/repo', '--json'])
      const parsed = JSON.parse(result.stdout.trim()) as {
        branchProtection: { required_linear_history: boolean }
      }
      expect(parsed.branchProtection.required_linear_history).toBe(false)
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

    it('--snapshot writes a file in dry-run mode (API GET is read-only)', () => {
      // In dry-run, snapshotCurrentProtection() will fail (no real GH_TOKEN / repo),
      // but the file should still be written with protection: null and exit 0.
      const snapshotPath = `/tmp/apply-bp-test-snapshot-${Date.now()}.json`
      const result = run(['--dry-run', '--repo', 'owner/repo', '--snapshot', snapshotPath])
      expect(result.status).toBe(0)
      // File should exist (written even in dry-run)
      expect(existsSync(snapshotPath)).toBe(true)
      const data = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as {
        repo: string
        branch: string
        timestamp: string
        protection: unknown
      }
      expect(data).toHaveProperty('repo', 'owner/repo')
      expect(data).toHaveProperty('branch', 'main')
      expect(data).toHaveProperty('timestamp')
    })
  })
})
