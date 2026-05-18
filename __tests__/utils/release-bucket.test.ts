import { describe, it, expect } from 'vitest'
import { releaseBucket } from '../../src/utils/release-bucket.js'

describe('releaseBucket', () => {
  it('library → lib', () => expect(releaseBucket('library')).toBe('lib'))
  it('frontend-spa → lib', () => expect(releaseBucket('frontend-spa')).toBe('lib'))
  it('backend-web-db → service', () => expect(releaseBucket('backend-web-db')).toBe('service'))
  it('cli → cli', () => expect(releaseBucket('cli')).toBe('cli'))
  it('embedded → cli', () => expect(releaseBucket('embedded')).toBe('cli'))
  it('data-pipeline → batch', () => expect(releaseBucket('data-pipeline')).toBe('batch'))

  it('covers all six archetypes', () => {
    const archetypes = [
      'library',
      'frontend-spa',
      'backend-web-db',
      'cli',
      'embedded',
      'data-pipeline',
    ] as const
    const buckets = archetypes.map(releaseBucket)
    expect(buckets).toHaveLength(6)
    expect(new Set(buckets).size).toBe(4)
  })
})
