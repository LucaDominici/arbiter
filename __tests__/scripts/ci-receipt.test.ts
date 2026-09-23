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
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/bin/sh',
      'case "$1 $2" in',
      '  "pr view") printf \'%s\' "$GH_PR_JSON" ;;',
      '  "pr checks") printf \'%s\' "$GH_CHECKS_JSON" ;;',
      '  *) exit 1 ;;',
      'esac',
      '',
    ].join('\n'),
    'utf-8',
  )
  chmodSync(join(bin, 'gh'), 0o755)
}

function run(
  dir: string,
  gh: { pr?: unknown; checks?: unknown } = {},
): ReturnType<typeof spawnSync> {
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
      ...(gh.pr === undefined ? {} : { GH_PR_JSON: JSON.stringify(gh.pr) }),
      ...(gh.checks === undefined ? {} : { GH_CHECKS_JSON: JSON.stringify(gh.checks) }),
    },
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ci-receipt.mjs', () => {
  it('writes a receipt when every required check for the current PR succeeds', () => {
    const dir = repo()
    installGh(dir)
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const result = run(dir, {
      pr: { number: 7, headRefOid: sha, url: 'https://github.com/example/repo/pull/7' },
      checks: [
        {
          bucket: 'pass',
          link: 'https://github.com/example/repo/actions/runs/1/job/1',
          name: 'CI Required',
          state: 'SUCCESS',
          workflow: 'CI',
          startedAt: '2026-09-23T04:13:50Z',
          completedAt: '2026-09-23T04:15:43Z',
        },
      ],
    })

    expect(result.status).toBe(0)
    const receipt = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'ci-pass.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(receipt).toMatchObject({
      schema: 'arbiter-ci-pass-v2',
      sha,
      conclusion: 'success',
      runUrl: 'https://github.com/example/repo/actions/runs/1/job/1',
      pr: 7,
      requiredChecks: [
        {
          name: 'CI Required',
          state: 'SUCCESS',
          workflow: 'CI',
          link: 'https://github.com/example/repo/actions/runs/1/job/1',
          startedAt: '2026-09-23T04:13:50Z',
          completedAt: '2026-09-23T04:15:43Z',
        },
      ],
    })
    expect(typeof receipt.checkedAt).toBe('string')
  })

  it('returns exit 2 and writes no receipt while a required check is pending', () => {
    const dir = repo()
    installGh(dir)
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim()
    const result = run(dir, {
      pr: { number: 7, headRefOid: sha, url: 'https://github.com/example/repo/pull/7' },
      checks: [
        {
          bucket: 'pending',
          link: 'https://example.invalid/run/1',
          state: 'PENDING',
          name: 'CI Required',
          workflow: 'CI',
          startedAt: '2026-09-23T04:13:50Z',
          completedAt: null,
        },
      ],
    })

    expect(result.status).toBe(2)
    expect(() => readFileSync(join(dir, '.arbiter', 'ci-pass.json'))).toThrow()
  })

  it('returns exit 2 when the PR head is not the current HEAD', () => {
    const dir = repo()
    installGh(dir)
    const result = run(dir, {
      pr: {
        number: 7,
        headRefOid: 'a'.repeat(40),
        url: 'https://github.com/example/repo/pull/7',
      },
      checks: [],
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/current HEAD/i)
    expect(() => readFileSync(join(dir, '.arbiter', 'ci-pass.json'))).toThrow()
  })

  it('returns exit 2 and writes no receipt when gh is unavailable', () => {
    const dir = repo()
    const result = run(dir)

    expect(result.status).toBe(2)
    expect(() => readFileSync(join(dir, '.arbiter', 'ci-pass.json'))).toThrow()
  })
})
