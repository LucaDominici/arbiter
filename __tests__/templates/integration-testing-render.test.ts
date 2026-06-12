import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('db_fixture.rs.ejs — F10 testcontainers-rs scaffold (#369)', () => {
  function render() {
    const data = makeConfig('/tmp/test', {
      language: 'rust',
      buildTool: 'cargo',
      hasDatabase: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    return renderTemplate('integration-testing/db_fixture.rs.ejs', data)
  }

  it('uses testcontainers::clients::Cli', () => {
    expect(render()).toContain('testcontainers::clients::Cli')
  })

  it('uses GenericImage with postgres:16-alpine', () => {
    const content = render()
    expect(content).toContain('GenericImage')
    expect(content).toContain('postgres')
    expect(content).toContain('16-alpine')
  })

  it('waits for stderr ready message', () => {
    expect(render()).toContain('database system is ready to accept connections')
  })

  it('uses OnceLock for static client', () => {
    expect(render()).toContain('OnceLock')
  })

  it('does not panic on missing DATABASE_URL (#369)', () => {
    expect(render()).not.toContain('panic!("DATABASE_URL"')
  })
})

describe('main_test_sqlite.go.ejs — containerless Go TestMain (#1317)', () => {
  function render() {
    const data = makeConfig('/tmp/test', {
      language: 'go',
      buildTool: 'go',
      hasDatabase: true,
      databaseEngine: 'sqlite',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    return renderTemplate('integration-testing/main_test_sqlite.go.ejs', data)
  }

  it('emits a TestMain with no Docker container import', () => {
    const content = render()
    expect(content).toContain('func TestMain')
    expect(content).not.toContain('testcontainers')
  })

  it('uses an in-process SQLite temp file (no postgres image)', () => {
    const content = render()
    expect(content).toContain('MkdirTemp')
    expect(content).not.toContain('postgres:16-alpine')
  })

  it('cleans up the temp dir even under os.Exit (no defer-skipped leak, #1317)', () => {
    const content = render()
    // os.Exit skips deferred calls; the run code must be captured and RemoveAll
    // invoked explicitly before exit so the temp dir does not leak.
    expect(content).toContain('code := m.Run()')
    expect(content).toContain('os.RemoveAll(dir)')
    expect(content).toContain('os.Exit(code)')
    expect(content).not.toContain('os.Exit(m.Run())')
  })

  it('is gofmt-structural clean (tab indent, no trailing space, trailing newline)', () => {
    const content = render()
    for (const line of content.split('\n')) {
      expect(line).not.toMatch(/ +$/)
      expect(line).not.toMatch(/^ +\S/)
    }
    expect(content.endsWith('\n')).toBe(true)
  })
})
