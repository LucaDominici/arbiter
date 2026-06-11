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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SCRIPT = resolve(__dirname, '../../scripts/ci-classify-changes.mjs')
const TEMPLATE_TWIN = resolve(__dirname, '../../src/templates/scripts/ci-classify-changes.mjs.ejs')

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

  it('--stdin: AGENTS.md alone ⇒ docs_only=false (governance file, #1299)', () => {
    const { status, flags } = runStdin(['AGENTS.md'])
    expect(status).toBe(0)
    expect(flags.docs_only).toBe('false')
  })

  it('--stdin: .claude/rules/x.md alone ⇒ docs_only=false (#1299)', () => {
    const { status, flags } = runStdin(['.claude/rules/x.md'])
    expect(status).toBe(0)
    expect(flags.docs_only).toBe('false')
  })

  it('--stdin: src/templates/a/b.md alone ⇒ docs_only=false (#1299)', () => {
    const { status, flags } = runStdin(['src/templates/a/b.md'])
    expect(status).toBe(0)
    expect(flags.docs_only).toBe('false')
  })

  it('--stdin: docs/a.md + wiki/b.md ⇒ docs_only=true (#1299)', () => {
    const { status, flags } = runStdin(['docs/a.md', 'wiki/b.md'])
    expect(status).toBe(0)
    expect(flags.docs_only).toBe('true')
  })

  it('--stdin: README.md alone ⇒ docs_only=true (root-level non-governance md, #1299)', () => {
    const { status, flags } = runStdin(['README.md'])
    expect(status).toBe(0)
    expect(flags.docs_only).toBe('true')
  })

  it('--stdin: docs/a.md + AGENTS.md ⇒ docs_only=false (#1299)', () => {
    const { status, flags } = runStdin(['docs/a.md', 'AGENTS.md'])
    expect(status).toBe(0)
    expect(flags.docs_only).toBe('false')
  })

  it('fail-closed: bogus BASE_SHA ⇒ run-everything categories=true, exit 0', () => {
    const { status, flags } = runGitFailure()
    expect(status).toBe(0)
    // docs_only is asserted false by the #1296 error-path suite below — for this
    // flag "run everything" means false (true would SKIP the code jobs).
    expect(flags.backend_changed).toBe('true')
    expect(flags.frontend_changed).toBe('true')
    expect(flags.infra_changed).toBe('true')
    expect(flags.high_risk).toBe('true')
    expect(flags.e2e_specs).toBe('true')
    expect(flags.ssot).toBe('true')
  })
})

describe('template twin parity (#1296, #1299)', () => {
  it('the .ejs twin contains the same isDocsPath predicate marker', () => {
    const script = readFileSync(SCRIPT, 'utf-8')
    const twin = readFileSync(TEMPLATE_TWIN, 'utf-8')
    for (const source of [script, twin]) {
      expect(source).toContain('function isDocsPath(')
      expect(source).toContain("f !== 'AGENTS.md'")
      expect(source).toContain('#1299')
    }
  })
})

// #1296 — the error path must NOT claim docs-only: docs_only=true SKIPS the code
// jobs, so for this one flag "run everything" means FALSE. A classification error
// emitting docs_only=true would let ci-required pass a code PR with zero checks.
describe('error path is run-everything, never docs-only (#1296)', () => {
  it('git failure ⇒ docs_only=false while other categories stay true', () => {
    const { flags, status } = runGitFailure()
    expect(status).toBe(0)
    expect(flags.docs_only).toBe('false')
    expect(flags.backend_changed).toBe('true')
    expect(flags.high_risk).toBe('true')
  })
})

// #1296 dual-track — the TEMPLATE twin must carry the same error-path semantics,
// or generated projects ship the CI-bypass variant next to the lenient aggregator.
describe('template twin parity (#1296)', () => {
  it('ci-classify-changes.mjs.ejs error path emits docs_only=false', () => {
    const tpl = readFileSync(
      fileURLToPath(
        new URL('../../src/templates/scripts/ci-classify-changes.mjs.ejs', import.meta.url),
      ),
      'utf-8',
    )
    expect(tpl).toContain("key !== 'docs_only'")
    expect(tpl).not.toMatch(/for \(const key of CATEGORY_KEYS\) emitFlag\(key, true\);/)
  })
})
