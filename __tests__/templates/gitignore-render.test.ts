// SPDX-License-Identifier: Apache-2.0
// RED phase (#1407): root/.gitignore.ejs must become stack-aware — consume the
// `language` and `databaseEngine` axes so a fresh (greenfield) init scaffolds a
// .gitignore that already ignores stack-specific binaries + data files.
// NOTE: greenfield-prevention only — generateEvidenceRetention renders with
// skipIfExists:true, so an EXISTING .gitignore is never rewritten (brownfield
// merge-on-update is out of scope; the extended GATE is the retroactive fix).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(overrides: Record<string, unknown>): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate('root/.gitignore.ejs', data)
}

describe('root/.gitignore.ejs — stack-aware (#1407)', () => {
  it('go + sqlite: ignores the module binary path and sqlite/db globs', () => {
    const content = render({
      language: 'go',
      databaseEngine: 'sqlite',
      projectName: 'myservice',
    })
    expect(content).toContain('/myservice')
    expect(content).toContain('*.sqlite')
    expect(content).toContain('*.db')
  })

  it('rust: ignores /target/', () => {
    const content = render({ language: 'rust', projectName: 'mycrate' })
    expect(content).toContain('/target/')
  })

  it('typescript without a database: omits sqlite/db globs (stack differs)', () => {
    const content = render({
      language: 'typescript',
      databaseEngine: 'none',
      projectName: 'webapp',
    })
    expect(content).not.toContain('*.sqlite')
    // and does not add a go binary path
    expect(content).not.toContain('/webapp\n')
  })

  it('postgresql database does NOT add sqlite globs (only sqlite engine does)', () => {
    const content = render({
      language: 'typescript',
      databaseEngine: 'postgresql',
      projectName: 'api',
    })
    expect(content).not.toContain('*.sqlite')
  })

  it('renders without throwing when databaseEngine is absent (always-present language)', () => {
    expect(() => render({ language: 'python', projectName: 'svc' })).not.toThrow()
  })

  it('preserves the existing baseline entries (node_modules, dist)', () => {
    const content = render({ language: 'typescript', projectName: 'app' })
    expect(content).toContain('node_modules/')
    expect(content).toContain('dist/')
  })
})

// #2313: the blanket `.arbiter/` rule made the shipped produced-here TDD guard
// (#2307) permanently inert in a generated target — an untracked evidence file
// cannot be diffed against the merge-base, so `evidenceProducedHere()` returns
// null and the branch passes with a WARNING. Behavioural test, not a string
// match: git's own matcher decides, because directory-level negations only work
// when the parent uses `/**` (arbiter's own .gitignore documents the same trap).
describe('root/.gitignore.ejs — TDD evidence must stay committable (#2313)', () => {
  function checkIgnore(relPath: string): boolean {
    const repo = mkdtempSync(join(tmpdir(), 'gi-'))
    try {
      spawnSync('git', ['init', '-b', 'main'], { cwd: repo })
      writeFileSync(join(repo, '.gitignore'), render({ language: 'java', projectName: 'consumer' }))
      const r = spawnSync('git', ['check-ignore', '-q', '--no-index', relPath], { cwd: repo })
      return r.status === 0
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }

  it('does NOT ignore .arbiter/evidence/tdd/*.json', () => {
    expect(checkIgnore('.arbiter/evidence/tdd/#42.json')).toBe(false)
  })

  it('does NOT ignore .arbiter/evidence/journey/*.json (#2382)', () => {
    expect(checkIgnore('.arbiter/evidence/journey/_2382.json')).toBe(false)
  })

  it('still ignores the rest of .arbiter/ runtime state', () => {
    expect(checkIgnore('.arbiter/ship/42/attempts.json')).toBe(true)
    expect(checkIgnore('.arbiter/plan/runs/1/run.json')).toBe(true)
    expect(checkIgnore('.arbiter/work/scratch.txt')).toBe(true)
    expect(checkIgnore('.arbiter/private/notes.md')).toBe(true)
  })
})
