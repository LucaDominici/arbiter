import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
// Behavioural import of arbiter's OWN materialized hook library (#1515 self track).
import { scopeCommandToFile, debounceHook } from '../../.claude/hooks/lib.mjs'

/**
 * #1515 — PostToolUse hooks must NOT recompute whole-repo tooling on every edit.
 *  - post-edit-dispatch scopes format/lint to the edited file.
 *  - check-no-unused-exports (knip) + check-circular-deps (madge) are whole-graph
 *    analyses that cannot be file-scoped, so they are debounced (run at most once
 *    per window across a burst of saves; the L1 gate re-runs them authoritatively).
 */

const REPO = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf-8')

function tsConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --write',
    ...extra,
  }) as unknown as Record<string, unknown>
}

describe('#1515 scopeCommandToFile — per-file scoping of format/lint', () => {
  it('strips a trailing whole-repo "." and targets the edited file (prettier)', () => {
    expect(scopeCommandToFile('npx prettier --check .', '/r/a.ts')).toEqual([
      'npx',
      'prettier',
      '--check',
      '/r/a.ts',
    ])
  })

  it('drops the `npm run lint` indirection in favour of direct eslint on the file', () => {
    expect(scopeCommandToFile('npm run lint', '/r/a.ts')).toEqual(['npx', 'eslint', '/r/a.ts'])
    expect(scopeCommandToFile('pnpm run lint', '/r/a.ts')).toEqual(['npx', 'eslint', '/r/a.ts'])
  })

  it('strips the whole-repo `src __tests__` eslint target', () => {
    expect(scopeCommandToFile('npx eslint src __tests__', '/r/a.ts')).toEqual([
      'npx',
      'eslint',
      '/r/a.ts',
    ])
  })

  it('scopes ruff / black / gofmt to the edited file', () => {
    expect(scopeCommandToFile('ruff check .', '/r/a.py')).toEqual(['ruff', 'check', '/r/a.py'])
    expect(scopeCommandToFile('black .', '/r/a.py')).toEqual(['black', '/r/a.py'])
    expect(scopeCommandToFile('gofmt -l .', '/r/a.go')).toEqual(['gofmt', '-l', '/r/a.go'])
  })

  it('leaves whole-graph tools (cargo/golangci-lint) untouched — not file-scopeable', () => {
    expect(scopeCommandToFile('cargo fmt --check', '/r/a.rs')).toEqual(['cargo', 'fmt', '--check'])
    expect(scopeCommandToFile('golangci-lint run', '/r/a.go')).toEqual(['golangci-lint', 'run'])
  })
})

describe('#1515 debounceHook — at most one whole-graph run per window', () => {
  it('returns false the first time and true within the window for the same key', () => {
    const key = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    expect(debounceHook(key, 60_000)).toBe(false)
    expect(debounceHook(key, 60_000)).toBe(true)
  })

  it('disables (fail-open, runs the check) when window <= 0', () => {
    const key = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    expect(debounceHook(key, 0)).toBe(false)
    expect(debounceHook(key, 0)).toBe(false)
  })
})

describe('#1515 template track — post-edit-dispatch scopes to the edited file', () => {
  const out = renderTemplate('claude/hooks/post-edit-dispatch.mjs.ejs', tsConfig())

  it('renders without EJS tag leaks', () => {
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('routes format/lint through scopeCommandToFile (not a raw whole-repo spawn)', () => {
    expect(out).toContain('scopeCommandToFile')
  })

  it('passes the edited filePath into the scoped command', () => {
    expect(out).toContain('scopeCommandToFile(')
    expect(out).toMatch(/scopeCommandToFile\([^)]*filePath/)
  })
})

describe('#1515 template track — knip/madge hooks are debounced', () => {
  it('check-no-unused-exports (raw template) debounces the whole-project knip run', () => {
    const src = read('src/templates/claude/hooks/check-no-unused-exports.mjs')
    expect(src).toContain('if (debounceHook(')
    // debounce guard must short-circuit BEFORE the expensive knip invocation
    expect(src.indexOf('if (debounceHook(')).toBeLessThan(src.indexOf('execSync('))
  })

  it('check-circular-deps (rendered) debounces the whole-src madge run', () => {
    const out = renderTemplate('claude/hooks/check-circular-deps.mjs.ejs', tsConfig())
    expect(out).toContain('if (debounceHook(')
    expect(out.indexOf('if (debounceHook(')).toBeLessThan(out.indexOf('spawnSync(madgeBin'))
  })

  it('lib template exports debounceHook + scopeCommandToFile', () => {
    const out = renderTemplate('claude/hooks/lib.mjs.ejs', tsConfig())
    expect(out).toContain('export function debounceHook')
    expect(out).toContain('export function scopeCommandToFile')
  })
})

describe('#1515 self track — materialized hooks mirror the scoping/debounce fix', () => {
  it('self post-edit-dispatch scopes via scopeCommandToFile', () => {
    expect(read('.claude/hooks/post-edit-dispatch.mjs')).toContain('scopeCommandToFile')
  })

  it('self check-no-unused-exports debounces knip', () => {
    const src = read('.claude/hooks/check-no-unused-exports.mjs')
    expect(src).toContain('if (debounceHook(')
    expect(src.indexOf('if (debounceHook(')).toBeLessThan(src.indexOf('execSync('))
  })

  it('self check-circular-deps debounces madge', () => {
    const src = read('.claude/hooks/check-circular-deps.mjs')
    expect(src).toContain('if (debounceHook(')
    expect(src.indexOf('if (debounceHook(')).toBeLessThan(src.indexOf('spawnSync(madgeBin'))
  })
})
