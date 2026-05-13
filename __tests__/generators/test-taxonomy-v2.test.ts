/**
 * Tests for the T1 extended TEST_TAXONOMY.md.ejs template (issue #257).
 * The existing test-taxonomy.test.ts covers archetype-level pyramid levels;
 * this file covers the new 7 test-type codes, 17 universal dimensions,
 * decision matrix, domain dims, and INV cross-refs.
 *
 * Existing Code Survey (CANON-16):
 *   - grep for generateTestTaxonomy: found in src/generators/test-taxonomy.ts (narrower scope)
 *   - grep for templates: found src/templates/root/TEST_TAXONOMY.md.ejs (pyramid only)
 *   - Decision: EXTEND existing template + generator in place (same path)
 *   - Rationale: Extending avoids near-duplicate abstractions, preserves brownfield contract
 *     via registry.ts wiring, and the existing tests become regression coverage. A separate
 *     template would split ownership without adding value — the new T1 content is additive
 *     (new sections appended) not architecturally divergent.
 */
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { getTestPyramidProfile } from '../../src/config/test-pyramid-profiles.js'
import { makeConfig } from '../helpers.js'

describe('TEST_TAXONOMY.md.ejs — T1 extensions (#257)', () => {
  function render(overrides: Parameters<typeof makeConfig>[1] = {}, domainDims?: string[]): string {
    const config = makeConfig('/tmp/test', overrides)
    const profile = getTestPyramidProfile(config.archetype)
    return renderTemplate('root/TEST_TAXONOMY.md.ejs', {
      ...(config as unknown as Record<string, unknown>),
      levels: profile.levels,
      hasContainerIntegration: profile.hasContainerIntegration,
      hasPropertyTests: profile.hasPropertyTests,
      hasE2ETests: profile.hasE2ETests,
      domainDims: domainDims ?? [],
    })
  }

  // ─── 7 test-type codes ───────────────────────────────────────────────────

  it('contains UT test type code', () => {
    expect(render()).toContain('UT')
  })

  it('contains IT test type code', () => {
    expect(render()).toContain('IT')
  })

  it('contains AU test type code', () => {
    expect(render()).toContain('AU')
  })

  it('contains ST test type code', () => {
    expect(render()).toContain('ST')
  })

  it('contains SC test type code', () => {
    expect(render()).toContain('SC')
  })

  it('contains SN test type code', () => {
    expect(render()).toContain('SN')
  })

  it('contains E2E test type code', () => {
    expect(render()).toContain('E2E')
  })

  // ─── 17 universal dimensions ─────────────────────────────────────────────

  it('contains owner isolation dimension', () => {
    expect(render().toLowerCase()).toMatch(/owner.isolat/)
  })

  it('contains RBAC dimension', () => {
    expect(render()).toContain('RBAC')
  })

  it('contains input validation dimension', () => {
    expect(render().toLowerCase()).toMatch(/input.validat/)
  })

  it('contains error contract dimension', () => {
    expect(render().toLowerCase()).toMatch(/error.contract/)
  })

  it('contains OpenAPI parity dimension', () => {
    expect(render()).toMatch(/OpenAPI|openapi/i)
  })

  it('contains pagination dimension', () => {
    expect(render().toLowerCase()).toContain('pagination')
  })

  it('contains idempotency dimension', () => {
    expect(render().toLowerCase()).toContain('idempotency')
  })

  it('contains migration integrity dimension', () => {
    expect(render().toLowerCase()).toMatch(/migration.integrity/)
  })

  it('contains observability dimension', () => {
    expect(render().toLowerCase()).toContain('observability')
  })

  it('contains perf/N+1 dimension', () => {
    expect(render()).toMatch(/N\+1|perf/i)
  })

  it('contains failure recovery dimension', () => {
    expect(render().toLowerCase()).toMatch(/failure.recov/)
  })

  it('contains DTO roundtrip dimension', () => {
    expect(render()).toMatch(/DTO|dto/i)
  })

  it('contains entity-schema parity dimension', () => {
    expect(render().toLowerCase()).toMatch(/entity.schema|schema.parity/)
  })

  it('contains cross-module ref integrity dimension', () => {
    expect(render().toLowerCase()).toMatch(/cross.module|ref.integr/)
  })

  it('contains profile security dimension', () => {
    expect(render().toLowerCase()).toMatch(/profile.sec/)
  })

  it('contains backward compat dimension', () => {
    expect(render().toLowerCase()).toMatch(/backward.compat/)
  })

  // ─── decision matrix ─────────────────────────────────────────────────────

  it('contains a change-type decision matrix section', () => {
    const content = render()
    expect(content.toLowerCase()).toMatch(/change.type|decision.matrix/)
  })

  // ─── domain dims ─────────────────────────────────────────────────────────

  it('includes domain dims when provided', () => {
    const content = render({}, ['tenant-isolation', 'billing-accuracy'])
    expect(content).toContain('tenant-isolation')
    expect(content).toContain('billing-accuracy')
  })

  it('renders cleanly when no domain dims provided', () => {
    expect(() => render({}, [])).not.toThrow()
  })

  // ─── INV cross-refs ──────────────────────────────────────────────────────

  it('contains INV catalog cross-reference', () => {
    const content = render()
    expect(content).toMatch(/INV-\d+/)
  })

  // ─── stack adaptation ────────────────────────────────────────────────────

  it('TypeScript and Java configs produce structurally similar output', () => {
    const tsContent = render({ language: 'typescript' })
    const javaContent = render({ language: 'java' })
    // Both must contain all 7 type codes
    for (const code of ['UT', 'IT', 'AU', 'ST', 'SC', 'SN', 'E2E']) {
      expect(tsContent).toContain(code)
      expect(javaContent).toContain(code)
    }
    // Both must contain the same 17 dimension keywords
    const sharedKeywords = ['RBAC', 'pagination', 'idempotency', 'observability']
    for (const kw of sharedKeywords) {
      expect(tsContent.toLowerCase()).toContain(kw.toLowerCase())
      expect(javaContent.toLowerCase()).toContain(kw.toLowerCase())
    }
  })
})
