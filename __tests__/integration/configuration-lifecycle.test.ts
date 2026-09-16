// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
