// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/ci-classify-changes.mjs (#969).
 *
 * Covers:
 *  - --stdin mode: paths are read from stdin instead of `git diff`
 *  - new categories: e2e_specs, ssot
 *  - fail-closed semantics: git failure ⇒ all categories=true, exit 0
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SCRIPT = resolve(__dirname, '../../scripts/ci-classify-changes.mjs')

interface Flags {
  docs_only?: string
  backend_changed?: string
  frontend_changed?: string
  infra_changed?: string
  high_risk?: string
  e2e_specs?: string
  ssot?: string
}

function runStdin(paths: string[]): { status: number | null; flags: Flags; stdout: string } {
  const r = spawnSync('node', [SCRIPT, '--stdin'], {
    input: paths.join('\n'),
    encoding: 'utf-8',
    env: { ...process.env, GITHUB_OUTPUT: '' },
  })
  return parseRun(r)
}

function runGitFailure(): { status: number | null; flags: Flags; stdout: string } {
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: '',
      BASE_SHA: '__bogus_ref_that_does_not_exist__',
      HEAD_SHA: '__bogus_ref_that_does_not_exist__',
    },
  })
  return parseRun(r)
}

function parseRun(r: ReturnType<typeof spawnSync>): {
  status: number | null
  flags: Flags
  stdout: string
} {
  const stdout = String(r.stdout || '')
  const flags: Flags = {}
  for (const line of stdout.split('\n')) {
    const m = line.match(/classify:\s*(\w+)=(\w+)/)
    if (m) (flags as Record<string, string>)[m[1]] = m[2]
  }
  return { status: r.status, flags, stdout }
}

describe('ci-classify-changes.mjs (#969)', () => {
  it('--stdin: docs-only diff ⇒ docs_only=true, others=false', () => {
    const { status, flags } = runStdin(['docs/foo.md'])
    expect(status).toBe(0)
    expect(flags.docs_only).toBe('true')
    expect(flags.backend_changed).toBe('false')
    expect(flags.frontend_changed).toBe('false')
    expect(flags.infra_changed).toBe('false')
    expect(flags.high_risk).toBe('false')
    expect(flags.e2e_specs).toBe('false')
    expect(flags.ssot).toBe('false')
  })

  it('--stdin: docs/SYSTEM/CANON.md ⇒ ssot=true and docs_only=true', () => {
    const { status, flags } = runStdin(['docs/SYSTEM/CANON.md'])
    expect(status).toBe(0)
    expect(flags.ssot).toBe('true')
    expect(flags.docs_only).toBe('true')
  })

  it('--stdin: __tests__/e2e/foo.spec.ts ⇒ e2e_specs=true', () => {
    const { status, flags } = runStdin(['__tests__/e2e/foo.spec.ts'])
    expect(status).toBe(0)
    expect(flags.e2e_specs).toBe('true')
  })

  it('fail-closed: bogus BASE_SHA ⇒ all categories=true, exit 0', () => {
    const { status, flags } = runGitFailure()
    expect(status).toBe(0)
    expect(flags.docs_only).toBe('true')
    expect(flags.backend_changed).toBe('true')
    expect(flags.frontend_changed).toBe('true')
    expect(flags.infra_changed).toBe('true')
    expect(flags.high_risk).toBe('true')
    expect(flags.e2e_specs).toBe('true')
    expect(flags.ssot).toBe('true')
  })
})
