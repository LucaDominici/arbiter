// SPDX-License-Identifier: Apache-2.0
// RED phase (#1407): root/.gitignore.ejs must become stack-aware — consume the
// `language` and `databaseEngine` axes so a fresh (greenfield) init scaffolds a
// .gitignore that already ignores stack-specific binaries + data files.
// NOTE: greenfield-prevention only — generateEvidenceRetention renders with
// skipIfExists:true, so an EXISTING .gitignore is never rewritten (brownfield
// merge-on-update is out of scope; the extended GATE is the retroactive fix).
import { describe, it, expect } from 'vitest'
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
