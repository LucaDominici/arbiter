// SPDX-License-Identifier: Apache-2.0
// Render tests for check-domain-api-surface.mjs.ejs and domain-api-surface.json.ejs
import { renderTemplate } from '../../src/utils/render.js'

const STACKS = [
  {
    language: 'typescript' as const,
    archetype: 'backend-web-db' as const,
    governanceLevel: 'L2' as const,
  },
  {
    language: 'java' as const,
    archetype: 'backend-web-db' as const,
    governanceLevel: 'L2' as const,
  },
  {
    language: 'python' as const,
    archetype: 'backend-web-db' as const,
    governanceLevel: 'L2' as const,
  },
  {
    language: 'rust' as const,
    archetype: 'backend-web-db' as const,
    governanceLevel: 'L2' as const,
  },
  {
    language: 'kotlin' as const,
    archetype: 'backend-web-db' as const,
    governanceLevel: 'L2' as const,
  },
]

const BASE_DATA = {
  projectName: 'test-project',
  governanceLevel: 'L2' as const,
}

describe('check-domain-api-surface.mjs.ejs render tests', () => {
  for (const stack of STACKS) {
    it(`renders for ${stack.language}/${stack.governanceLevel}`, () => {
      const data = { ...BASE_DATA, ...stack }
      const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', data)
      expect(result).toBeTruthy()
      expect(result.length).toBeGreaterThan(100)
    })
  }

  it('contains CATALOG: markers (at least 3 contiguous)', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', BASE_DATA)
    const lines = result.split('\n')
    const catalogLines = lines.filter((l) => l.includes('// CATALOG:'))
    expect(catalogLines.length).toBeGreaterThanOrEqual(3)
  })

  it('interpolates projectName', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', {
      ...BASE_DATA,
      projectName: 'my-api-project',
    })
    expect(result).toContain('my-api-project')
  })

  it('contains exit 0 SKIP path', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', BASE_DATA)
    expect(result).toContain('process.exit(0)')
    expect(result).toContain('SKIP')
  })

  it('contains exit 1 FAIL path', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', BASE_DATA)
    expect(result).toContain('process.exit(1)')
    expect(result).toContain('FAIL')
  })

  it('contains exit 2 ERROR path', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', BASE_DATA)
    expect(result).toContain('process.exit(2)')
    expect(result).toContain('ERROR')
  })

  it('uses arbiter-domain-api-surface-v1 schema', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', BASE_DATA)
    expect(result).toContain('arbiter-domain-api-surface-v1')
  })
})

describe('domain-api-surface.json.ejs render tests', () => {
  for (const stack of STACKS) {
    it(`renders valid JSON for ${stack.language}/${stack.governanceLevel}`, () => {
      const data = { ...BASE_DATA, ...stack }
      const result = renderTemplate('scripts/domain-api-surface.json.ejs', data)
      expect(result).toBeTruthy()
      const parsed = JSON.parse(result)
      expect(parsed.schema).toBe('arbiter-domain-api-surface-v1')
      expect(Array.isArray(parsed.resources)).toBe(true)
    })
  }

  it('seed manifest has schema field', () => {
    const result = renderTemplate('scripts/domain-api-surface.json.ejs', BASE_DATA)
    const parsed = JSON.parse(result)
    expect(parsed.schema).toBe('arbiter-domain-api-surface-v1')
  })

  it('seed manifest has non-empty resources array', () => {
    const result = renderTemplate('scripts/domain-api-surface.json.ejs', BASE_DATA)
    const parsed = JSON.parse(result)
    expect(parsed.resources.length).toBeGreaterThan(0)
  })

  it('seed resource has domainFields array', () => {
    const result = renderTemplate('scripts/domain-api-surface.json.ejs', BASE_DATA)
    const parsed = JSON.parse(result)
    expect(Array.isArray(parsed.resources[0].domainFields)).toBe(true)
  })
})
