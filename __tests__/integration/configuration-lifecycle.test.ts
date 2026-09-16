// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit } from '../../src/commands/init.js'
import { runConfigure } from '../../src/commands/configure.js'
import { runUpdate } from '../../src/commands/update.js'
import { shipConfigFor } from '../../src/commands/ship-config.js'
import { resolveReviewMaxRounds } from '../../src/commands/ship-review.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function project(language: 'typescript' | 'python'): string {
  const dir = mkdtempSync(join(tmpdir(), `arbiter-config-${language}-`))
  roots.push(dir)
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'arbiter.invalid'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir, stdio: 'ignore' })
  writeFileSync(
    join(dir, language === 'typescript' ? 'package.json' : 'pyproject.toml'),
    language === 'typescript'
      ? '{"name":"fixture"}\n'
      : '[project]\nname="fixture"\nversion="0.1.0"\n',
  )
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: dir, stdio: 'ignore' })
  return dir
}

describe.each(['typescript', 'python'] as const)(
  '%s installed-consumer configuration lifecycle (#2039)',
  (language) => {
    it('carries a chosen value through init → configure → update → ship policy', async () => {
      const dir = project(language)
      await runInit({
        dir,
        yes: true,
        noVerify: true,
        tools: 'claude',
        level: 'L2',
        language,
      })

      await runConfigure({ dir, sets: ['ship.review.maxRounds=1'] })
      await runUpdate({ dir, github: false })

      const stored = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf8')) as {
        language?: string
      }
      expect(stored.language).toBe(language)
      expect(resolveReviewMaxRounds(shipConfigFor(dir))).toBe(1)
    }, 30_000)
  },
)

describe.skipIf(process.env['VITEST_L2'] !== '1')('installed package lifecycle (#2039)', () => {
  it('drives TS and Python consumers through public commands and Ship reads the chosen value', () => {
    const installDir = mkdtempSync(join(tmpdir(), 'arbiter-config-install-'))
    roots.push(installDir)
    writeFileSync(join(installDir, 'package.json'), '{"private":true}\n')
    const supplied = process.env['ARBITER_PACKED_TARBALL']
    let tarball = supplied
    if (tarball === undefined) {
      const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', installDir], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 180_000,
      })
      expect(packed.status, packed.stderr).toBe(0)
      const filename = (JSON.parse(packed.stdout) as Array<{ filename: string }>)[0]?.filename
      expect(filename).toBeTruthy()
      tarball = join(installDir, filename!)
    }
    expect(existsSync(tarball)).toBe(true)
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], {
      cwd: installDir,
      stdio: 'ignore',
      timeout: 300_000,
    })
    const bin = join(installDir, 'node_modules', '.bin', 'arbiter')
    expect(existsSync(bin)).toBe(true)

    const run = (dir: string, args: string[]) =>
      spawnSync(bin, [...args, '--dir', dir], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, ARBITER_GITHUB: '0' },
      })

    for (const language of ['typescript', 'python'] as const) {
      const dir = project(language)
      const init = run(dir, [
        'init',
        '--yes',
        '--no-verify',
        '--tools',
        'claude',
        '--level',
        'L2',
        '--language',
        language,
      ])
      expect(init.status, init.stderr).toBe(0)
      expect(run(dir, ['configure', '--set', 'ship.review.maxRounds=1']).status).toBe(0)
      expect(run(dir, ['update']).status).toBe(0)

      const settings = run(dir, ['settings', '--json'])
      expect(settings.status, settings.stderr).toBe(0)
      const parsed = JSON.parse(settings.stdout) as {
        data: { groups: Array<{ fields: Array<Record<string, unknown>> }> }
      }
      const maxRounds = parsed.data.groups
        .flatMap((group) => group.fields)
        .find((field) => field['path'] === 'ship.review.maxRounds')
      expect(maxRounds).toMatchObject({ declared: 1, effective: 1, source: 'project' })

      expect(run(dir, ['task', 'init', '--id', '#2039', '--tier', 'XS']).status).toBe(0)
      const statePath = join(dir, '.claude', '.task', 'status.json')
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
      writeFileSync(
        statePath,
        JSON.stringify({
          ...state,
          phase: 'refactor',
          review: { rounds: 1, lastReviewedSha: null },
        }),
      )
      const blockedReview = run(dir, ['ship', '#2039', '--review-round'])
      expect(blockedReview.status).not.toBe(0)
      expect(`${blockedReview.stdout}${blockedReview.stderr}`).toContain('cap is 1')

      const stored = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf8')) as {
        language?: string
      }
      expect(stored.language).toBe(language)
    }
  }, 600_000)
})
