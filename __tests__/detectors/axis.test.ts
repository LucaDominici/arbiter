import { describe, it, expect } from 'vitest'
import { ARCHETYPE_DB_SET, resolveAxisFields } from '../../src/detectors/axis.js'

describe('ARCHETYPE_DB_SET', () => {
  it('contains backend-web-db and data-pipeline', () => {
    expect(ARCHETYPE_DB_SET.has('backend-web-db')).toBe(true)
    expect(ARCHETYPE_DB_SET.has('data-pipeline')).toBe(true)
  })

  it('does not contain library or frontend archetypes', () => {
    expect(ARCHETYPE_DB_SET.has('library')).toBe(false)
    expect(ARCHETYPE_DB_SET.has('frontend-spa')).toBe(false)
  })
})

describe('resolveAxisFields — stored wins', () => {
  it('returns stored archetype when present', () => {
    const result = resolveAxisFields(
      {
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        archetype: 'frontend-spa',
        hasDatabase: false,
        hasPublicApi: false,
        architectureStyle: 'none',
        isMultiTenant: false,
      },
      '/tmp/proj',
      'typescript',
      null,
    )
    expect(result.archetype).toBe('frontend-spa')
    expect(result.hasDatabase).toBe(false)
    expect(result.hasPublicApi).toBe(false)
  })

  it('returns stored hasDatabase when explicitly set false', () => {
    const result = resolveAxisFields(
      {
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        archetype: 'backend-web-db',
        hasDatabase: false,
        hasPublicApi: false,
      },
      '/tmp/proj',
      'typescript',
      null,
    )
    expect(result.hasDatabase).toBe(false)
  })
})

describe('resolveAxisFields — detection fallback', () => {
  it('defaults archetype to library when stored null and no detection', () => {
    const result = resolveAxisFields(null, '/tmp/empty', 'typescript', null)
    expect(result.archetype).toBe('library')
  })

  it('derives hasDatabase via set membership when stored absent', () => {
    const result = resolveAxisFields(
      { version: '0.1', tools: [], governanceLevel: 'L2', useGitHub: false },
      '/tmp/proj',
      'typescript',
      null,
    )
    // archetype defaults to library → not in ARCHETYPE_DB_SET
    expect(result.hasDatabase).toBe(false)
  })

  it('hasDatabase=true for data-pipeline when stored absent', () => {
    const result = resolveAxisFields(
      {
        version: '0.1',
        tools: [],
        governanceLevel: 'L2',
        useGitHub: false,
        archetype: 'data-pipeline',
      },
      '/tmp/proj',
      'typescript',
      null,
    )
    expect(result.hasDatabase).toBe(true)
  })
})

describe('resolveAxisFields — contractType from resolved values (pins diff.ts fix)', () => {
  it('uses resolved archetype for contractType when stored fields absent', () => {
    // stored has no archetype/hasPublicApi — detection resolves to backend-web-db
    // contractType must use resolved archetype (rest-owned), not stored.archetype ?? 'library'
    const result = resolveAxisFields(
      {
        version: '0.1',
        tools: [],
        governanceLevel: 'L2',
        useGitHub: false,
        archetype: 'backend-web-db',
        // hasPublicApi absent → resolves to true (backend-web-db default)
        // contractType absent → defaultContractType(resolved archetype, resolved hasPublicApi)
      },
      '/tmp/proj',
      'typescript',
      null,
    )
    expect(result.contractType).toBe('rest-owned')
  })

  it('contractType=none for library archetype with no public API', () => {
    const result = resolveAxisFields(null, '/tmp/proj', 'typescript', null)
    expect(result.contractType).toBe('none')
  })
})

describe('resolveAxisFields — defaults', () => {
  it('architectureStyle defaults to none', () => {
    const result = resolveAxisFields(null, '/tmp/proj', 'typescript', null)
    expect(result.architectureStyle).toBe('none')
  })

  it('isMultiTenant defaults to false', () => {
    const result = resolveAxisFields(null, '/tmp/proj', 'typescript', null)
    expect(result.isMultiTenant).toBe(false)
  })
})
