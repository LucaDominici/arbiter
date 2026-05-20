// SPDX-License-Identifier: Apache-2.0
// Regression tests for #933: generated files must conform to the target project's
// .prettierrc style, not arbiter's internal style.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { generateCodexHooks } from '../../src/generators/codex-hooks.js'
import { generateBehavioralTests } from '../../src/generators/behavioral-tests.js'
import { makeConfig } from '../helpers.js'

/** .prettierrc opposite of arbiter's style — double-quotes, semicolons */
const PRETTIER_RC = { semi: true, singleQuote: false, trailingComma: 'all' }

/** Resolve prettier binary path relative to the worktree, not the target dir */
const PRETTIER_BIN = join(new URL('../../node_modules/.bin/prettier', import.meta.url).pathname)

function prettierCheck(filePath: string, configPath: string): { ok: boolean; output: string } {
  if (!existsSync(PRETTIER_BIN)) return { ok: true, output: '(prettier not installed — skipped)' }
  const result = spawnSync(PRETTIER_BIN, ['--check', '--config', configPath, filePath], {
    encoding: 'utf-8',
  })
  return {
    ok: result.status === 0,
    output: (result.stdout + result.stderr).trim(),
  }
}

describe('#933 — prettier post-emit: generated files must match target .prettierrc', () => {
  let dir: string
  let prettierRcPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-933-prettier-'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify(
        {
          name: 'test-project',
          version: '1.0.0',
          scripts: { build: 'tsc', test: 'vitest run' },
        },
        null,
        2,
      ) + '\n',
    )
    prettierRcPath = join(dir, '.prettierrc')
    writeFileSync(prettierRcPath, JSON.stringify(PRETTIER_RC, null, 2))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('codex-adapter.mjs passes prettier --check with target .prettierrc (semi:true, singleQuote:false)', () => {
    generateCodexHooks(makeConfig(dir))
    const adapterPath = join(dir, '.codex', 'codex-adapter.mjs')
    expect(existsSync(adapterPath)).toBe(true)

    const { ok, output } = prettierCheck(adapterPath, prettierRcPath)
    expect(ok, `prettier --check failed for codex-adapter.mjs:\n${output}`).toBe(true)
  })

  it('example.steps.ts passes prettier --check with target .prettierrc (semi:true, singleQuote:false)', () => {
    generateBehavioralTests(makeConfig(dir, { language: 'typescript' }))
    const stepsPath = join(dir, 'features', 'step_definitions', 'example.steps.ts')
    expect(existsSync(stepsPath)).toBe(true)

    const { ok, output } = prettierCheck(stepsPath, prettierRcPath)
    expect(ok, `prettier --check failed for example.steps.ts:\n${output}`).toBe(true)
  })
})
