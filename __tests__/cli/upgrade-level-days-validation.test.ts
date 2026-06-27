// SPDX-License-Identifier: Apache-2.0
// #1607: `upgrade-level --days` must reject a non-integer / < 1 value at the CLI
// boundary (exit 1, echoing the raw value) rather than forwarding NaN into the
// date math (opaque "Invalid time value") or persisting a zero-grace window.
// Spawn-based: the validation lives in the cli.ts action.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath

function spawn(args: string[], cwd: string): { stderr: string; status: number } {
  const r = spawnSync(NODE, [CLI, ...args], { cwd, encoding: 'utf-8', timeout: 30_000 })
  return { stderr: r.stderr ?? '', status: r.status ?? 1 }
}

describe('upgrade-level --days validation (#1607)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'upgrade-days-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects --days abc with exit 1 and echoes the raw value', () => {
    const r = spawn(['upgrade-level', '--target', 'L2', '--days', 'abc', '--dir', dir], dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('invalid --days "abc"')
  })

  it('rejects --days 0 with exit 1', () => {
    const r = spawn(['upgrade-level', '--target', 'L2', '--days', '0', '--dir', dir], dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('invalid --days "0"')
  })

  it('rejects a negative --days with exit 1', () => {
    const r = spawn(['upgrade-level', '--target', 'L2', '--days=-5', '--dir', dir], dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('invalid --days')
  })
}, 60_000)
