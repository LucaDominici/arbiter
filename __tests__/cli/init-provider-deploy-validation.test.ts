// SPDX-License-Identifier: Apache-2.0
// #1676: `arbiter init --auth-provider`/`--observability-provider` must validate against
//        the provider unions and fail BEFORE scaffolding (no silent coercion that emits a
//        content-less AUTH_SETUP.md/OBSERVABILITY.md once before the next load catches it).
// #1677: `arbiter init --deploy-target` is the non-interactive complement to the wizard;
//        a valid value persists into arbiter.json, an unknown value is rejected.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath

function spawn(args: string[], cwd: string): { stderr: string; stdout: string; status: number } {
  const r = spawnSync(NODE, [CLI, ...args], { cwd, encoding: 'utf-8', timeout: 60_000 })
  return { stderr: r.stderr ?? '', stdout: r.stdout ?? '', status: r.status ?? 1 }
}

describe('init provider/deploy-target flag validation (#1676/#1677)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'init-provider-deploy-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an invalid --auth-provider before writing any file (#1676)', () => {
    const r = spawn(['init', '--yes', '--level', 'L1', '--auth-provider', 'bogus', '--dir', dir], dir)
    expect(r.status).toBeGreaterThan(0)
    expect(`${r.stderr}${r.stdout}`).toMatch(/auth-provider/i)
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(false)
  })

  it('rejects an invalid --observability-provider before writing any file (#1676)', () => {
    const r = spawn(
      ['init', '--yes', '--level', 'L1', '--observability-provider', 'bogus', '--dir', dir],
      dir,
    )
    expect(r.status).toBeGreaterThan(0)
    expect(`${r.stderr}${r.stdout}`).toMatch(/observability-provider/i)
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(false)
  })

  it('rejects an invalid --deploy-target before writing any file (#1677)', () => {
    const r = spawn(['init', '--yes', '--level', 'L1', '--deploy-target', 'bogus', '--dir', dir], dir)
    expect(r.status).toBeGreaterThan(0)
    expect(`${r.stderr}${r.stdout}`).toMatch(/deploy-target/i)
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(false)
  })

  it('--yes --deploy-target gcp-cloud-run persists deployTarget into arbiter.json (#1677)', () => {
    const r = spawn(
      ['init', '--yes', '--level', 'L1', '--no-verify', '--deploy-target', 'gcp-cloud-run', '--dir', dir],
      dir,
    )
    expect(r.status).toBe(0)
    const cfgPath = join(dir, 'arbiter.json')
    expect(existsSync(cfgPath)).toBe(true)
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8')) as { deployTarget?: string }
    expect(cfg.deployTarget).toBe('gcp-cloud-run')
  })
}, 120_000)
