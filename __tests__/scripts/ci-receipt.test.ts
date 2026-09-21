import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve('scripts/ci-receipt.mjs')
const dirs: string[] = []

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-ci-receipt-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], {
    cwd: dir,
    stdio: 'ignore',
  })
  return dir
}

function installGh(dir: string): void {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nprintf \'%s\' "$GH_JSON"\n', 'utf-8')
  chmodSync(join(bin, 'gh'), 0o755)
}

function run(dir: string, ghJson?: string): ReturnType<typeof spawnSync> {
  const gitDir = dirname(
    execFileSync('which', ['git'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(),
  )
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${gitDir}`,
      ...(ghJson === undefined ? {} : { GH_JSON: ghJson }),
    },
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ci-receipt.mjs', () => {
  it('writes a receipt when every CI run for HEAD succeeds', () => {
    const dir = repo()
    installGh(dir)
    const result = run(
      dir,
      JSON.stringify([
        {
          conclusion: 'success',
          url: 'https://github.com/example/repo/actions/runs/1',
          status: 'completed',
          name: 'CI',
        },
      ]),
    )

    expect(result.status).toBe(0)
    const receipt = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'ci-pass.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(receipt).toMatchObject({
      sha: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
      conclusion: 'success',
      runUrl: 'https://github.com/example/repo/actions/runs/1',
    })
    expect(typeof receipt.checkedAt).toBe('string')
  })

  it('returns exit 2 and writes no receipt while a CI run is pending', () => {
    const dir = repo()
    installGh(dir)
    const result = run(
      dir,
      JSON.stringify([
        {
          conclusion: null,
          url: 'https://example.invalid/run/1',
          status: 'in_progress',
          name: 'CI',
        },
      ]),
    )

    expect(result.status).toBe(2)
    expect(() => readFileSync(join(dir, '.arbiter', 'ci-pass.json'))).toThrow()
  })

  it('returns exit 2 and writes no receipt when gh is unavailable', () => {
    const dir = repo()
    const result = run(dir)

    expect(result.status).toBe(2)
    expect(() => readFileSync(join(dir, '.arbiter', 'ci-pass.json'))).toThrow()
  })
})
