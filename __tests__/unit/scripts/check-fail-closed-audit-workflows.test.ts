// SPDX-License-Identifier: Apache-2.0
// TDD RED: #1049 — check-fail-closed-audit.mjs must scan .github/workflows/ for
// unallowlisted `|| true` patterns. Before fix the script exits 0 for workflow
// files (extension skip regex blocks yaml/yml).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

const AUDIT_SCRIPT = resolve('scripts/check-fail-closed-audit.mjs')

function runAudit(root: string): { code: number; stdout: string } {
  const result = spawnSync('node', [AUDIT_SCRIPT, '--root', root], { encoding: 'utf-8' })
  return { code: result.status ?? 1, stdout: result.stdout + result.stderr }
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'arbiter-audit-test-'))
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  mkdirSync(join(root, 'scripts', 'data'), { recursive: true })
  // baseline must exist so the script doesn't exit early
  writeFileSync(
    join(root, 'scripts', 'data', 'fail-closed-baseline.json'),
    JSON.stringify({ schema: 'arbiter-fail-closed-baseline-v2', generated_at: null, files: [] }),
  )
  return root
}

describe('#1049 — fail-closed audit scans .github/workflows/', () => {
  const staged: string[] = []

  afterEach(() => {
    for (const d of staged.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('flags unallowlisted || true in a workflow yml', () => {
    const root = makeRoot()
    staged.push(root)
    writeFileSync(
      join(root, '.github', 'workflows', 'test.yml'),
      'jobs:\n  build:\n    steps:\n      - run: npm test || true\n',
    )
    const { code, stdout } = runAudit(root)
    expect(code, `expected exit 1, got ${code}. output: ${stdout}`).toBe(1)
    expect(stdout).toMatch(/\|\|\s*true|or-true|fail-closed/)
  })

  it('allows || true with FAIL-OPEN-INTENT comment above', () => {
    const root = makeRoot()
    staged.push(root)
    writeFileSync(
      join(root, '.github', 'workflows', 'test.yml'),
      'jobs:\n  build:\n    steps:\n      - run: |\n          # FAIL-OPEN-INTENT: known infra flake, filed as #999\n          npm test || true\n',
    )
    const { code } = runAudit(root)
    expect(code, 'FAIL-OPEN-INTENT comment should allow || true').toBe(0)
  })

  it('returns 0 for an empty workflow file', () => {
    const root = makeRoot()
    staged.push(root)
    writeFileSync(join(root, '.github', 'workflows', 'empty.yml'), '')
    const { code } = runAudit(root)
    expect(code).toBe(0)
  })

  it('scans .yaml extension as well as .yml', () => {
    const root = makeRoot()
    staged.push(root)
    writeFileSync(
      join(root, '.github', 'workflows', 'test.yaml'),
      'jobs:\n  build:\n    steps:\n      - run: npm test || true\n',
    )
    const { code, stdout } = runAudit(root)
    expect(code, `expected exit 1, got ${code}. output: ${stdout}`).toBe(1)
  })
})
