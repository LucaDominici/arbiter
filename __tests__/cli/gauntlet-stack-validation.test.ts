// SPDX-License-Identifier: Apache-2.0
// #1641: `gauntlet generate --stack` must reject an unknown stack with exit 2,
// not silently coerce it to `typescript` and emit a wrong-language suite + exit 0.
// Spawn-based against dist/cli.js (the coercion lives in the CLI action layer).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath

const SPEC = `
name: trip
dimensions:
  transport: [car, train]
  duration: [1d, 3d]
strategy: pairwise
tags: ["@gauntlet"]
`

function spawn(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(NODE, [CLI, ...args], { cwd, encoding: 'utf-8', timeout: 30_000 })
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? 1 }
}

describe('gauntlet generate --stack validation (#1641)', () => {
  let dir: string
  let spec: string
  let out: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gauntlet-stack-'))
    spec = join(dir, 'gauntlet.yaml')
    out = join(dir, 'out')
    writeFileSync(spec, SPEC, 'utf-8')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an unknown --stack with exit 2 and a diagnostic (no silent typescript fallback)', () => {
    const r = spawn(['gauntlet', 'generate', '--spec', spec, '--out', out, '--stack', 'go'], dir)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('unknown --stack "go"')
    expect(r.stderr).toContain('typescript|java|rust')
  })

  it('rejects an unknown --stack with --json (exit 2, error envelope)', () => {
    const r = spawn(
      ['gauntlet', 'generate', '--spec', spec, '--out', out, '--stack', 'pyhton', '--json'],
      dir,
    )
    expect(r.status).toBe(2)
    const parsed = JSON.parse(r.stdout) as { status: string; errors?: string[] }
    expect(parsed.status).toBe('error')
    expect(parsed.errors?.[0]).toContain('unknown --stack "pyhton"')
  })

  it('accepts a valid --stack (rust) without the validation error', () => {
    const r = spawn(['gauntlet', 'generate', '--spec', spec, '--out', out, '--stack', 'rust'], dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('unknown --stack')
  })
}, 60_000)
