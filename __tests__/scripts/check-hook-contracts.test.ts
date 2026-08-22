// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-hook-contracts.mjs')

function run(root?: string) {
  const r = spawnSync('node', [SCRIPT, ...(root === undefined ? [] : ['--root', root])], {
    encoding: 'utf-8',
    cwd: resolve('.'),
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

describe('check-hook-contracts.mjs (hook doc contract enforcement)', () => {
  it('exits 0 when all .mjs hooks in .claude/hooks/ are documented in HOOK-CONTRACTS.md', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('check-hook-contracts: OK')
  })
})

/**
 * #2324 — the loadability half. The bug this closes (`pre-edit-ssot-guard.mjs` importing a
 * symbol its sibling `lib.mjs` never exported) survived 18 days because every existing test
 * built its fixture from the TEMPLATE pair, which is self-consistent by construction.
 *
 * These tests are therefore mutation-flip shaped: the SAME fixture is asserted green, then
 * one planted defect must flip it red. A check never observed to flip proves nothing.
 */
describe('check-hook-contracts.mjs (#2324 loadability)', () => {
  let dir: string

  const writeFixture = (hooks: Record<string, string>): void => {
    const hooksDir = join(dir, '.claude', 'hooks')
    const docDir = join(dir, 'docs', 'internal', 'SYSTEM')
    mkdirSync(hooksDir, { recursive: true })
    mkdirSync(docDir, { recursive: true })
    for (const [name, body] of Object.entries(hooks)) {
      writeFileSync(join(hooksDir, name), body)
    }
    writeFileSync(
      join(docDir, 'HOOK-CONTRACTS.md'),
      Object.keys(hooks)
        .map((name) => `- \`${name}\` — fixture hook\n`)
        .join(''),
    )
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-hook-load-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('passes a hook that loads and exits 0 (allow)', () => {
    writeFixture({
      'lib.mjs': 'export const helper = () => true\n',
      'good-hook.mjs': "import { helper } from './lib.mjs'\nif (helper()) process.exit(0)\n",
    })
    const result = run(dir)
    expect(result.stderr).not.toContain('FAIL TO LOAD')
    expect(result.status).toBe(0)
  })

  it('passes a hook that BLOCKS with exit 2 — a verdict is health, not failure', () => {
    writeFixture({
      'blocking-hook.mjs': "process.stderr.write('denied\\n')\nprocess.exit(2)\n",
    })
    const result = run(dir)
    expect(result.stderr).not.toContain('FAIL TO LOAD')
    expect(result.status).toBe(0)
  })

  it('FLIPS red when a hook imports a symbol its sibling lib does not export', () => {
    // The exact shape of the #2324 production bug.
    writeFixture({
      'lib.mjs': 'export const helper = () => true\n',
      'broken-hook.mjs':
        "import { helper, isPathInThisRepo } from './lib.mjs'\n" +
        'if (helper() && isPathInThisRepo()) process.exit(0)\n',
    })
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('FAIL TO LOAD')
    expect(result.stderr).toContain('broken-hook.mjs')
    expect(result.stderr).toContain('does not provide an export named')
  })

  it('FLIPS red when a hook imports a module that does not exist', () => {
    writeFixture({ 'missing-dep.mjs': "import './nope.mjs'\n" })
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('FAIL TO LOAD')
    expect(result.stderr).toContain('missing-dep.mjs')
  })

  it('FLIPS red on a syntax error', () => {
    writeFixture({ 'broken-syntax.mjs': 'const = \n' })
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('FAIL TO LOAD')
    expect(result.stderr).toContain('broken-syntax.mjs')
  })
})
