// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT = resolve('scripts/check-doc-freshness.mjs')
const capability = readFileSync(resolve('docs/design/gold-doc-capability.md'), 'utf8')
const tranches = readFileSync(resolve('docs/design/gold-doc-tranches-t3-t5.md'), 'utf8')

function commit(dir: string, message: string, date: string): void {
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test', 'commit', '-m', message], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  })
}

describe('#2262 — gold-doc freshness is coupling-aware', () => {
  it('records the implemented doc-set, freshness, and self-enrollment surfaces it reviews', () => {
    expect(capability).toMatch(
      /`src\/generators\/doc-set\.ts` implements the real\s+doc-body generator/,
    )
    expect(capability).toMatch(/`scripts\/check-doc-\s*freshness\.mjs` is implemented/)
    expect(tranches).toContain('T1b is implemented')
    expect(tranches).toContain('all charter documents are tracked')
  })

  it('runs the real checker and blocks a document whose coupled code changed after review', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-doc-freshness-'))
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      mkdirSync(join(dir, 'src'), { recursive: true })
      mkdirSync(join(dir, 'standards'), { recursive: true })
      writeFileSync(
        join(dir, 'standards', 'gold-doc-set.yml'),
        "checks:\n  - path: docs/coupled.md\n    tier: mandatory\n    applies: always\n    freshness_class: high-churn\n    couples_to: ['src/subject.ts']\n",
      )
      writeFileSync(
        join(dir, 'docs', 'coupled.md'),
        "---\ntitle: 'coupled'\nstatus: active\nlast_review: '2026-08-01'\n---\n\n# Coupled\n",
      )
      writeFileSync(join(dir, 'src', 'subject.ts'), 'export const subject = 1\n')
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      commit(dir, 'initial', '2026-08-01T12:00:00+00:00')
      writeFileSync(join(dir, 'src', 'subject.ts'), 'export const subject = 2\n')
      commit(dir, 'change subject', '2026-08-02T12:00:00+00:00')

      const result = spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf-8' })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('STALE docs/coupled.md')
      expect(result.stdout).toContain('coupling=stale')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
