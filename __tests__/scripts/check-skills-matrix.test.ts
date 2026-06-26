// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-skills-matrix.mjs')
const SKILL_NAMES: string[] = JSON.parse(
  readFileSync(resolve('src/generators/skill-names.json'), 'utf-8'),
)

function run(matrixPath?: string) {
  const r = spawnSync('node', matrixPath ? [SCRIPT, matrixPath] : [SCRIPT], {
    encoding: 'utf-8',
    cwd: resolve('.'),
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function writeMatrix(replaces: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-skills-matrix-'))
  const matrix = {
    $schemaVersion: 1,
    _lastUpdated: '2026-01-01',
    _refreshCadence: 'monthly',
    _promotionCriteria: 'test',
    skills: [
      {
        skillId: 'superpowers:probe',
        pluginOwner: 'superpowers',
        versionRange: '>=1.0.0',
        role: 'probe',
        integrationStatus: 'beta',
        replaces,
        referenceUrl: '',
      },
    ],
  }
  const p = join(dir, 'skills-matrix.json')
  writeFileSync(p, JSON.stringify(matrix))
  return p
}

describe('check-skills-matrix.mjs (skills-matrix validation)', () => {
  const tmpDirs: string[] = []
  afterEach(() => {
    for (const p of tmpDirs.splice(0)) rmSync(p, { recursive: true, force: true })
  })

  it('exits 0 when skills-matrix.json is valid (real repo)', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[skills-matrix] PASS')
  })

  // #1583: the gate's valid-name set must be the canonical SKILL_NAMES SSOT,
  // not a stale 8-entry hand-copy. A matrix that legitimately replaces one of
  // the previously-missing canonical names (e.g. levelup) must PASS.
  it('accepts a matrix that replaces every canonical SKILL_NAME', () => {
    const p = writeMatrix([...SKILL_NAMES])
    tmpDirs.push(p.slice(0, p.lastIndexOf('/')))
    const result = run(p)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[skills-matrix] PASS')
  })

  it('still rejects a matrix that replaces an unknown skill name', () => {
    const p = writeMatrix(['definitely-not-a-skill'])
    tmpDirs.push(p.slice(0, p.lastIndexOf('/')))
    const result = run(p)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unknown SKILL_NAME')
  })
})
