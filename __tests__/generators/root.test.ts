import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateRoot } from '../../src/generators/root.js'
import { makeConfig } from '../helpers.js'

describe('generateRoot', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-root-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates SECURITY.md, CONTRIBUTING.md, and .editorconfig', () => {
    const result = generateRoot(makeConfig(dir))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('SECURITY.md'))).toBe(true)
    expect(paths.some((p) => p.endsWith('CONTRIBUTING.md'))).toBe(true)
    expect(paths.some((p) => p.endsWith('.editorconfig'))).toBe(true)
  })

  it('emits the canonical .nvmrc for CI-enabled non-TypeScript projects (#2259)', () => {
    generateRoot(makeConfig(dir, { language: 'python' }))
    expect(readFileSync(join(dir, '.nvmrc'), 'utf-8')).toBe('22.21.1\n')
  })

  it('generates CODEOWNERS when githubOwner is set', () => {
    const result = generateRoot(makeConfig(dir, { githubOwner: 'test-owner' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('CODEOWNERS'))).toBe(true)
    const content = readFileSync(join(dir, '.github', 'CODEOWNERS'), 'utf-8')
    expect(content).toContain('test-owner')
  })

  it('does not generate CODEOWNERS when githubOwner is null', () => {
    const result = generateRoot(makeConfig(dir, { githubOwner: null }))
    const paths = result.files.map((f) => f.path)
    expect(paths.every((p) => !p.endsWith('CODEOWNERS'))).toBe(true)
  })

  it('skips existing files on second run (skipIfExists)', () => {
    generateRoot(makeConfig(dir))
    const securityPath = join(dir, 'SECURITY.md')

    // Write custom content to SECURITY.md
    writeFileSync(securityPath, 'CUSTOM CONTENT')

    // Second run should skip
    const result = generateRoot(makeConfig(dir))
    const securityResult = result.files.find((f) => f.path.endsWith('SECURITY.md'))
    expect(securityResult!.action).toBe('skipped')
    expect(readFileSync(securityPath, 'utf-8')).toBe('CUSTOM CONTENT')
  })

  it('CONTRIBUTING.md contains project name and test command', () => {
    generateRoot(
      makeConfig(dir, {
        projectName: 'root-proj',
        testCommand: 'npm test',
        githubOwner: 'owner',
        githubRepo: 'repo',
      }),
    )
    const content = readFileSync(join(dir, 'CONTRIBUTING.md'), 'utf-8')
    expect(content).toContain('root-proj')
    expect(content).toContain('npm test')
  })

  it('emits CODEOWNERS with security paths at L2 (#204)', () => {
    const result = generateRoot(makeConfig(dir, { githubOwner: 'owner', governanceLevel: 'L2' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('CODEOWNERS'))).toBe(true)
    const content = readFileSync(join(dir, '.github', 'CODEOWNERS'), 'utf-8')
    expect(content).toContain('.github/workflows/')
  })

  it('generates commitlint.config.js (#202)', () => {
    const result = generateRoot(makeConfig(dir))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('commitlint.config.js'))).toBe(true)
  })

  it('skipIfExists on commitlint.config.js (#202)', () => {
    const commitlintPath = join(dir, 'commitlint.config.js')
    writeFileSync(commitlintPath, '// custom content')
    const result = generateRoot(makeConfig(dir))
    const entry = result.files.find((f) => f.path.endsWith('commitlint.config.js'))
    expect(entry?.action).toBe('skipped')
    expect(readFileSync(commitlintPath, 'utf-8')).toBe('// custom content')
  })

  it('skipIfExists on .editorconfig (#205, CANON-11)', () => {
    const editorconfigPath = join(dir, '.editorconfig')
    writeFileSync(editorconfigPath, '# custom editorconfig')
    const result = generateRoot(makeConfig(dir))
    const entry = result.files.find((f) => f.path.endsWith('.editorconfig'))
    expect(entry?.action).toBe('skipped')
    expect(readFileSync(editorconfigPath, 'utf-8')).toBe('# custom editorconfig')
  })

  it('emits .editorconfig with TS language override (#205)', () => {
    generateRoot(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, '.editorconfig'), 'utf-8')
    expect(content).toContain('[*.{ts,tsx,js,jsx}]')
  })

  it('emits .editorconfig with Go tab override (#205)', () => {
    generateRoot(makeConfig(dir, { language: 'go' }))
    const content = readFileSync(join(dir, '.editorconfig'), 'utf-8')
    expect(content).toContain('[*.go]')
    expect(content).toContain('indent_style = tab')
  })

  it('formats commitlint.config.js to the target project prettier config (#1325)', () => {
    // A pre-existing project .prettierrc with singleQuote:false wins by precedence;
    // the house-style template (single quotes) would otherwise fail the generated
    // `format` gate. generateRoot must prettierFormat the emitted file to it.
    writeFileSync(join(dir, '.prettierrc'), JSON.stringify({ singleQuote: false }))
    generateRoot(makeConfig(dir, { language: 'typescript' }))
    const commitlint = readFileSync(join(dir, 'commitlint.config.js'), 'utf-8')
    expect(commitlint).toContain('"@commitlint/config-conventional"')
    expect(commitlint).not.toContain("'@commitlint/config-conventional'")
  })
})
