// SPDX-License-Identifier: Apache-2.0
// CANON-04: render test for post-commit-check.mjs.ejs (#724).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('post-commit-check.mjs.ejs (#724)', () => {
  const cfg = makeConfig('/tmp/test', { language: 'typescript' }) as unknown as Record<
    string,
    unknown
  >

  function spawnRenderedHook(
    lib: string,
    git = '#!/usr/bin/env sh\nprintf "bad subject\\n"\n',
    injectFailure = false,
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-post-commit-render-'))
    const hookPath = join(dir, 'post-commit-check.mjs')
    const gitPath = join(dir, 'git')
    const hook = renderTemplate('claude/hooks/post-commit-check.mjs.ejs', cfg)
    const source = injectFailure
      ? hook.replace('const command = resolveToolInputCommand()', 'throw null')
      : hook
    if (injectFailure && source === hook) throw new Error('fault injection did not apply')
    writeFileSync(hookPath, source)
    writeFileSync(join(dir, 'lib.mjs'), lib)
    writeFileSync(gitPath, git)
    chmodSync(gitPath, 0o755)
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: dir,
      encoding: 'utf-8',
      input: JSON.stringify({ tool_input: { command: 'git commit' } }),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDE_TOOL_INPUT_COMMAND: 'git commit',
        PATH: `${dir}:${process.env.PATH ?? ''}`,
      },
      timeout: 5000,
    })
    rmSync(dir, { recursive: true, force: true })
    return result
  }

  it('renders an advisory without checklist output or EJS leaks', () => {
    const out = renderTemplate('claude/hooks/post-commit-check.mjs.ejs', cfg)
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
    expect(out.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(out).not.toContain('Track:')
  })

  it('exits 0 and prints one line for a bad commit message (#2767)', () => {
    const result = spawnRenderedHook(renderTemplate('claude/hooks/lib.mjs.ejs', cfg))
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('[arbiter] Advisory: non-conventional commit message: bad subject\n')
  })

  it('exits 0 and prints one line when the advisory is unavailable (#2767)', () => {
    const result = spawnRenderedHook(
      "export function resolveToolInputCommand() { return 'git commit' }\n",
      undefined,
      true,
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('[arbiter] Advisory unavailable: null\n')
  })

  it('registers the always-zero advisory in generated Claude and Codex dispatchers (#2767)', () => {
    expect(renderTemplate('claude/hooks/hooks.mjs.ejs', cfg)).toContain('post-commit-check.mjs')
    expect(renderTemplate('codex/config.toml.ejs', cfg)).toContain('post-commit-check.mjs')
  })
})
