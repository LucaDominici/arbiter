import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateSsot } from '../../src/generators/ssot.js'
import { makeConfig } from '../helpers.js'

describe('generateSsot', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-ssot-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ── Adoption tiers ──────────────────────────────────────────────────────────

  it('L1: generates SSOT_CORE_SET.md and KNOWLEDGE_MAP.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    expect(existsSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'))).toBe(true)
    expect(existsSync(join(dir, 'docs/METHOD/KNOWLEDGE_MAP.md'))).toBe(true)
  })

  it('L1: does NOT generate ENGINEERING_DEFAULTS.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    expect(existsSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'))).toBe(false)
  })

  it('L1: does NOT generate TRACK_ROUTER.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    expect(existsSync(join(dir, 'docs/METHOD/TRACK_ROUTER.md'))).toBe(false)
  })

  it('L2: generates ENGINEERING_DEFAULTS.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateSsot(config)
    expect(existsSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'))).toBe(true)
  })

  it('L2: does NOT generate TRACK_ROUTER.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateSsot(config)
    expect(existsSync(join(dir, 'docs/METHOD/TRACK_ROUTER.md'))).toBe(false)
  })

  it('L3: does NOT generate TRACK_ROUTER.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    generateSsot(config)
    expect(existsSync(join(dir, 'docs/METHOD/TRACK_ROUTER.md'))).toBe(false)
  })

  it('L4: generates all four files including TRACK_ROUTER.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    generateSsot(config)
    expect(existsSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'))).toBe(true)
    expect(existsSync(join(dir, 'docs/METHOD/KNOWLEDGE_MAP.md'))).toBe(true)
    expect(existsSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'))).toBe(true)
    expect(existsSync(join(dir, 'docs/METHOD/TRACK_ROUTER.md'))).toBe(true)
  })

  // ── Return value ─────────────────────────────────────────────────────────────

  it('returns an array of WriteResults', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    const results = generateSsot(config)
    expect(Array.isArray(results.files)).toBe(true)
    expect(results.files.length).toBeGreaterThan(0)
  })

  it('all returned results have action and path', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    const results = generateSsot(config)
    for (const r of results.files) {
      expect(r).toHaveProperty('action')
      expect(r).toHaveProperty('path')
    }
  })

  // ── SSOT_CORE_SET.md content ─────────────────────────────────────────────────

  it('SSOT_CORE_SET.md contains project name', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L1',
      projectName: 'my-app',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).toContain('my-app')
  })

  it('SSOT_CORE_SET.md references KNOWLEDGE_MAP.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).toContain('KNOWLEDGE_MAP.md')
  })

  it('SSOT_CORE_SET.md references ENGINEERING_DEFAULTS.md for L2+', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).toContain('ENGINEERING_DEFAULTS.md')
  })

  it('SSOT_CORE_SET.md does not reference ENGINEERING_DEFAULTS.md for L1', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).not.toContain('ENGINEERING_DEFAULTS.md')
  })

  // ── KNOWLEDGE_MAP.md content ──────────────────────────────────────────────────

  it('KNOWLEDGE_MAP.md contains project name', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L1',
      projectName: 'my-app',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/KNOWLEDGE_MAP.md'), 'utf-8')
    expect(content).toContain('my-app')
  })

  it('KNOWLEDGE_MAP.md has AGENTS.md entry', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/KNOWLEDGE_MAP.md'), 'utf-8')
    expect(content).toContain('AGENTS.md')
  })

  // #1720 — gap 3: the KNOWLEDGE_MAP.md guard was literal `governanceLevel === 'L3'`,
  // which (a) documented a TRACK_ROUTER.md section at L3 even though TRACK_ROUTER.md
  // is generated ONLY at L4 (src/generators/ssot.ts:48-49, phantom section) and
  // (b) omitted the section at L4, where the file actually exists. The fix is
  // `isL4`, aligning the doc section with the L4-only file — this is a deliberate
  // behavior change, not a superset-preserving one (L3's section is REMOVED).
  it('L4: KNOWLEDGE_MAP.md contains the TRACK_ROUTER.md section (gap 3)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/KNOWLEDGE_MAP.md'), 'utf-8')
    expect(content).toContain('docs/METHOD/TRACK_ROUTER.md')
  })

  it('L3: KNOWLEDGE_MAP.md does NOT contain the TRACK_ROUTER.md section (gap 3 — no phantom doc for a file L3 never generates)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/KNOWLEDGE_MAP.md'), 'utf-8')
    expect(content).not.toContain('docs/METHOD/TRACK_ROUTER.md')
  })

  it('KNOWLEDGE_MAP.md is skipIfExists — preserves manual edits on re-run', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    // First run creates it
    generateSsot(config)

    // Simulate manual edits a user would make
    writeFileSync(
      join(dir, 'docs/METHOD/KNOWLEDGE_MAP.md'),
      '# My custom knowledge map\n\nManually edited content.\n',
    )

    // Second run should skip and leave manual edits intact
    const results = generateSsot(config)
    const knowledgeMapResult = results.files.find((r) => r.path.endsWith('KNOWLEDGE_MAP.md'))
    expect(knowledgeMapResult?.action).toBe('skipped')

    const afterContent = readFileSync(join(dir, 'docs/METHOD/KNOWLEDGE_MAP.md'), 'utf-8')
    expect(afterContent).toContain('Manually edited content.')
  })

  // ── ENGINEERING_DEFAULTS.md content ──────────────────────────────────────────

  it('ENGINEERING_DEFAULTS.md contains SOLID section', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'), 'utf-8')
    expect(content).toContain('SOLID')
  })

  it('ENGINEERING_DEFAULTS.md has TypeScript-specific complexity limits for TS projects', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      language: 'typescript',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'), 'utf-8')
    expect(content).toContain('TypeScript')
  })

  it('ENGINEERING_DEFAULTS.md has Java-specific complexity limits for Java projects', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      language: 'java',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'), 'utf-8')
    expect(content).toContain('Java')
  })

  it('ENGINEERING_DEFAULTS.md mentions complexity limit', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'), 'utf-8')
    // Should mention cognitive complexity or cyclomatic complexity
    expect(content.toLowerCase()).toMatch(/complexity/)
  })

  it('ENGINEERING_DEFAULTS.md uses TypeScript table for unknown language (fallback)', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      language: 'unknown',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'), 'utf-8')
    expect(content).toContain('TypeScript')
    // Must not render other language sections
    expect(content).not.toContain('### Java')
    expect(content).not.toContain('### Rust')
    expect(content).not.toContain('### Go')
    expect(content).not.toContain('### Python')
  })

  it('ENGINEERING_DEFAULTS.md has Rust-specific content for Rust projects', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      language: 'rust',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'), 'utf-8')
    expect(content).toContain('Rust')
    expect(content).toContain('Clippy')
    expect(content).not.toContain('### TypeScript')
  })

  it('ENGINEERING_DEFAULTS.md has Go-specific content for Go projects', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      language: 'go',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'), 'utf-8')
    expect(content).toContain('Go')
    expect(content).toContain('gocognit')
    expect(content).not.toContain('### TypeScript')
  })

  it('ENGINEERING_DEFAULTS.md has Python-specific content for Python projects', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      language: 'python',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'), 'utf-8')
    expect(content).toContain('Python')
    expect(content).toContain('radon')
    expect(content).not.toContain('### TypeScript')
  })

  it('ENGINEERING_DEFAULTS.md renders exactly one language section (mutual exclusivity)', () => {
    const languages = ['typescript', 'java', 'rust', 'go', 'python', 'unknown'] as const
    const headings = ['TypeScript', 'Java', 'Rust', 'Go', 'Python']

    for (const lang of languages) {
      const langDir = mkdtempSync(join(tmpdir(), `arbiter-ssot-lang-${lang}-`))
      try {
        const config = makeConfig(langDir, {
          governanceLevel: 'L2',
          language: lang,
        })
        generateSsot(config)
        const content = readFileSync(join(langDir, 'docs/METHOD/ENGINEERING_DEFAULTS.md'), 'utf-8')
        const renderedHeadings = headings.filter((h) => content.includes(`### ${h}`))
        expect(renderedHeadings.length).toBe(1)
      } finally {
        rmSync(langDir, { recursive: true, force: true })
      }
    }
  })

  // ── TRACK_ROUTER.md content ───────────────────────────────────────────────────

  it('TRACK_ROUTER.md explains when to read which doc', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/TRACK_ROUTER.md'), 'utf-8')
    // Should have routing-like content
    expect(content).toContain('AGENTS.md')
    expect(content).toContain('KNOWLEDGE_MAP.md')
  })

  it('TRACK_ROUTER.md contains project name', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L4',
      projectName: 'my-app',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/TRACK_ROUTER.md'), 'utf-8')
    expect(content).toContain('my-app')
  })

  // ── Archetype-conditional content in SSOT_CORE_SET.md (ADR-021) ──────────────

  it('SSOT_CORE_SET.md shows archetype label in header', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      archetype: 'backend-web-db',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).toContain('backend-web-db')
  })

  it('SSOT_CORE_SET.md shows architectureStyle next to archetype when set', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      archetype: 'backend-web-db',
      architectureStyle: 'hexagonal',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).toContain('hexagonal')
  })

  it("SSOT_CORE_SET.md does NOT show architectureStyle when 'none'", () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      archetype: 'library',
      architectureStyle: 'none',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).not.toContain('none')
  })

  it('SSOT_CORE_SET.md omits Data section when hasDatabase is false', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      archetype: 'library',
      hasDatabase: false,
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).not.toContain('SCHEMA.md')
    expect(content).not.toContain('MIGRATIONS.md')
  })

  it('SSOT_CORE_SET.md includes Data section when hasDatabase is true', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      archetype: 'backend-web-db',
      hasDatabase: true,
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).toContain('SCHEMA.md')
    expect(content).toContain('MIGRATIONS.md')
  })

  it('SSOT_CORE_SET.md omits API Contracts section when hasPublicApi is false', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      archetype: 'library',
      hasPublicApi: false,
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).not.toContain('OPENAPI.yaml')
  })

  it('SSOT_CORE_SET.md includes API Contracts section when hasPublicApi is true', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      archetype: 'backend-web-db',
      hasPublicApi: true,
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).toContain('OPENAPI.yaml')
  })

  it('SSOT_CORE_SET.md includes both Data and API sections for backend-web-db archetype', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      archetype: 'backend-web-db',
      hasDatabase: true,
      hasPublicApi: true,
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).toContain('SCHEMA.md')
    expect(content).toContain('OPENAPI.yaml')
  })

  it('SSOT_CORE_SET.md omits both Data and API sections for library archetype', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      archetype: 'library',
      hasDatabase: false,
      hasPublicApi: false,
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).not.toContain('SCHEMA.md')
    expect(content).not.toContain('OPENAPI.yaml')
  })

  it('SSOT_CORE_SET.md (#114): no numeric section prefixes — hasDatabase=false,hasPublicApi=true emits API section without stale number', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      archetype: 'frontend-spa',
      hasDatabase: false,
      hasPublicApi: true,
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).toContain('OPENAPI.yaml')
    expect(content).not.toMatch(/## \d+\./)
  })

  // ── CANONICAL_PATHS.md (Aliasing pillar — #255) ───────────────────────────────

  it('L1: generates CANONICAL_PATHS.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    expect(existsSync(join(dir, 'docs/METHOD/CANONICAL_PATHS.md'))).toBe(true)
  })

  it('L2: generates CANONICAL_PATHS.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateSsot(config)
    expect(existsSync(join(dir, 'docs/METHOD/CANONICAL_PATHS.md'))).toBe(true)
  })

  it('L3: generates CANONICAL_PATHS.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    generateSsot(config)
    expect(existsSync(join(dir, 'docs/METHOD/CANONICAL_PATHS.md'))).toBe(true)
  })

  it('CANONICAL_PATHS.md contains project name', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L1',
      projectName: 'my-app',
    })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/CANONICAL_PATHS.md'), 'utf-8')
    expect(content).toContain('my-app')
  })

  it('CANONICAL_PATHS.md is skipIfExists — preserves manual alias entries on re-run', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)

    writeFileSync(
      join(dir, 'docs/METHOD/CANONICAL_PATHS.md'),
      '# My custom aliases\n\nManually added redirects.\n',
    )

    const results = generateSsot(config)
    const cpResult = results.files.find((r) => r.path.endsWith('CANONICAL_PATHS.md'))
    expect(cpResult?.action).toBe('skipped')

    const afterContent = readFileSync(join(dir, 'docs/METHOD/CANONICAL_PATHS.md'), 'utf-8')
    expect(afterContent).toContain('Manually added redirects.')
  })

  it('SSOT_CORE_SET.md references CANONICAL_PATHS.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/SSOT_CORE_SET.md'), 'utf-8')
    expect(content).toContain('CANONICAL_PATHS.md')
  })

  it('KNOWLEDGE_MAP.md references CANONICAL_PATHS.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/KNOWLEDGE_MAP.md'), 'utf-8')
    expect(content).toContain('CANONICAL_PATHS.md')
  })

  it('KNOWLEDGE_MAP.md contains Lines placeholder for KM update', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'docs/METHOD/KNOWLEDGE_MAP.md'), 'utf-8')
    expect(content).toContain('**Lines:**')
  })

  // ── SSOT gate scripts (#255) ──────────────────────────────────────────────────

  it('L1: generates all five SSOT gate/update scripts', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    const expected = [
      'scripts/check-ssot-core.mjs',
      'scripts/check-doc-links.mjs',
      'scripts/check-knowledge-map.mjs',
      'scripts/check-canonical-paths.mjs',
      'scripts/knowledge-map-update.mjs',
    ]
    for (const p of expected) {
      expect(existsSync(join(dir, p))).toBe(true)
    }
  })

  it('L2: generates all SSOT scripts', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateSsot(config)
    expect(existsSync(join(dir, 'scripts/check-ssot-core.mjs'))).toBe(true)
  })

  it('L3: generates all SSOT scripts', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    generateSsot(config)
    expect(existsSync(join(dir, 'scripts/check-canonical-paths.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts/knowledge-map-update.mjs'))).toBe(true)
  })

  it('SSOT scripts are skipIfExists — preserve manual edits on re-run', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)

    const scriptPath = join(dir, 'scripts/check-ssot-core.mjs')
    writeFileSync(scriptPath, '# manually edited\n')

    const results = generateSsot(config)
    const scriptResult = results.files.find((r) => r.path.endsWith('check-ssot-core.mjs'))
    expect(scriptResult?.action).toBe('skipped')
    expect(readFileSync(scriptPath, 'utf-8')).toContain('manually edited')
  })

  it('check-ssot-core.mjs references SSOT_CORE_SET.md', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    generateSsot(config)
    const content = readFileSync(join(dir, 'scripts/check-ssot-core.mjs'), 'utf-8')
    expect(content).toContain('SSOT_CORE_SET')
  })
})
