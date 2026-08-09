// SPDX-License-Identifier: Apache-2.0
// #2267 — a real L2 brownfield Java Gradle init must run its generated L3
// lifecycle gate green. This stays L2-only because it downloads Gradle tooling
// and compiles the staged project.
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../../../../src/commands/init.js'
import { stageFixture } from '../helpers.js'

const L2 = process.env.VITEST_L2 === '1'

describe.skipIf(!L2)('Java lifecycle gate (#2267)', () => {
  let dir: string

  beforeEach(() => {
    dir = stageFixture('java-library-gradle')
  })

  afterEach(() => {
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  it('runs the generated Gradle L3 lifecycle after a real L2 brownfield init', async () => {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: true,
      noVerify: true,
      acceptBetaTools: true,
      backend: 'markdown',
      solo: true,
    })

    const result = spawnSync('node', ['scripts/check-all.mjs', 'L3', '--gate', 'java-lifecycle'], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, GRADLE_OPTS: '-Dorg.gradle.vfs.watch=false' },
      timeout: 240_000,
    })
    const output = (result.stdout ?? '') + (result.stderr ?? '')

    expect(output).not.toMatch(/Java lifecycle build \.\.\. SKIP/)
    expect(output).toMatch(/\[CHECK\] Java lifecycle build \.\.\. PASS/)
    expect(result.status, output.slice(-4000)).toBe(0)
  }, 300_000)
})
