// SPDX-License-Identifier: Apache-2.0
// #2148: INV-101 must validate executable policy and mutation wiring, not
// permissive flag fragments in unrelated files.
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-merge-method.mjs')
const REAL_POLICY = readFileSync(resolve('scripts/lib/exact-sha-policy.mjs'), 'utf8')
const VALID_WATCHER = `
import { validateLiveExactShaPolicy } from './lib/exact-sha-policy.mjs'
const mutation = 'updateRefs'
const updates = [{ beforeOid: 'a', afterOid: 'b', force: false }]
`
const VALID_APPLICATOR = `import { EXACT_SHA_REPO_SETTINGS } from './lib/exact-sha-policy.mjs'`

function fixture(
  overrides: {
    policy?: string | null
    watcher?: string | null
    applicator?: string | null
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'check-merge-method-'))
  writeFileSync(join(root, 'arbiter.json'), JSON.stringify({ collaborationMode: 'trunk-solo' }))
  mkdirSync(join(root, 'scripts/lib'), { recursive: true })
  const files = {
    policy: overrides.policy === undefined ? REAL_POLICY : overrides.policy,
    watcher: overrides.watcher === undefined ? VALID_WATCHER : overrides.watcher,
    applicator: overrides.applicator === undefined ? VALID_APPLICATOR : overrides.applicator,
  }
  if (files.policy !== null)
    writeFileSync(join(root, 'scripts/lib/exact-sha-policy.mjs'), files.policy)
  if (files.watcher !== null) writeFileSync(join(root, 'scripts/pr-merge-watch.mjs'), files.watcher)
  if (files.applicator !== null) {
    writeFileSync(join(root, 'scripts/apply-branch-protection.mjs'), files.applicator)
  }
  return root
}

function run(root: string) {
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('check-merge-method.mjs (#2148, INV-101)', () => {
  it('skips only an ungoverned directory without arbiter.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-merge-method-'))
    try {
      expect(run(root).status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('passes the canonical exact-SHA policy and CAS watcher', () => {
    const root = fixture()
    try {
      const result = run(root)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('exact-SHA')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['policy', { policy: null }],
    ['watcher', { watcher: null }],
    ['applicator', { applicator: null }],
  ] as const)('fails closed when %s is missing', (_label, override) => {
    const root = fixture(override)
    try {
      expect(run(root).status).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects policy drift that enables rebase', () => {
    const root = fixture({
      policy: REAL_POLICY.replace('allow_rebase_merge: false', 'allow_rebase_merge: true'),
    })
    try {
      const result = run(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('allow_rebase_merge')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a watcher that invokes the PR rebase endpoint', () => {
    const root = fixture({ watcher: `${VALID_WATCHER}\ngh pr merge --rebase\n` })
    try {
      const result = run(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/gh_pr_merge|rebase/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an applicator disconnected from the canonical policy', () => {
    const root = fixture({ applicator: 'const settings = {}' })
    try {
      expect(run(root).status).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('has an INV-94 CATALOG marker block', () => {
    const lines = readFileSync(SCRIPT, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('// CATALOG:'))
    expect(lines).toHaveLength(3)
  })
})
