// SPDX-License-Identifier: Apache-2.0
// #1671: `arbiter init --archetype` must validate against the archetype union
// (like `arbiter configure`) and fail BEFORE scaffolding. An out-of-union value
// previously crashed the test-pyramid/test-taxonomy generators, persisted a
// corrupt arbiter.json, and shipped a project with no test-pyramid.json.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath

function spawn(args: string[], cwd: string): { stderr: string; status: number } {
  const r = spawnSync(NODE, [CLI, ...args], { cwd, encoding: 'utf-8', timeout: 60_000 })
  return { stderr: r.stderr ?? '', status: r.status ?? 1 }
}

describe('init --archetype validation (#1671)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'init-archetype-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an invalid --archetype before writing any file', () => {
    const r = spawn(
      [
        'init',
        '--language',
        'go',
        '--archetype',
        'service',
        '--level',
        'L2',
        '--yes',
        '--dir',
        dir,
      ],
      dir,
    )
    expect(r.status).toBeGreaterThan(0)
    expect(r.stderr).toMatch(/archetype/i)
    // Fail-before-write: no corrupt config, no missing-manifest state left behind.
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(false)
    expect(existsSync(join(dir, 'test-pyramid.json'))).toBe(false)
  })

  it('accepts a valid --archetype (cli) — no archetype validation error', () => {
    const r = spawn(
      ['init', '--language', 'go', '--archetype', 'cli', '--level', 'L1', '--yes', '--dir', dir],
      dir,
    )
    expect(r.stderr).not.toMatch(/Invalid archetype/i)
  })
}, 90_000)
