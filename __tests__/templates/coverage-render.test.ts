import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('coverage config templates — rendering (CANON-04)', () => {
  // ── jacoco.gradle.ejs ──────────────────────────────────────────────────────

  it('jacoco.gradle.ejs contains jacocoTestCoverageVerification task', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/jacoco.gradle.ejs', data)
    expect(content).toContain('jacocoTestCoverageVerification')
  })

  it('jacoco.gradle.ejs contains jacocoTestReport with html and xml reporters', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/jacoco.gradle.ejs', data)
    expect(content).toContain('jacocoTestReport')
    expect(content).toContain('html')
    expect(content).toContain('xml')
  })

  it('jacoco.gradle.ejs interpolates coverageThreshold as decimal ratio (0.80)', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/jacoco.gradle.ejs', data)
    expect(content).toContain('0.80')
  })

  it('jacoco.gradle.ejs includes exclusions for test and generated classes', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/jacoco.gradle.ejs', data)
    expect(content).toContain('excludes')
  })

  it('jacoco.gradle.ejs has apply-from comment header', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/jacoco.gradle.ejs', data)
    expect(content).toContain('apply from:')
  })

  // ── vitest.config.ts.ejs ───────────────────────────────────────────────────

  it('vitest.config.ts.ejs disables thresholdAutoUpdate to prevent silent floor lowering (#353)', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'typescript',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/vitest.config.ts.ejs', data)
    expect(content).toContain('thresholdAutoUpdate: false')
  })

  it('vitest.config.ts.ejs renders defineConfig with coverage section', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'typescript',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/vitest.config.ts.ejs', data)
    expect(content).toContain('defineConfig')
    expect(content).toContain('coverage')
  })

  it('vitest.config.ts.ejs renders provider v8, reporters text/html/lcov', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'typescript',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/vitest.config.ts.ejs', data)
    expect(content).toContain('v8')
    expect(content).toContain('html')
    expect(content).toContain('lcov')
    expect(content).toContain('text')
  })

  it('vitest.config.ts.ejs interpolates coverageThreshold into thresholds', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'typescript',
        enableDebtGates: true,
      }),
      coverageThreshold: 85,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/vitest.config.ts.ejs', data)
    expect(content).toContain('85')
  })

  it('vitest.config.ts.ejs threshold scales with governanceLevel (L2 80 → L3 85)', () => {
    // Reuses computeThresholds (src/config/thresholds.ts) — fixed profile maps L2→80, L3→85.
    // Render test asserts the value passed in flows through to the emitted config.
    const l2 = renderTemplate('coverage/vitest.config.ts.ejs', {
      ...makeConfig('/tmp/test', { language: 'typescript', enableDebtGates: true }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>)
    const l3 = renderTemplate('coverage/vitest.config.ts.ejs', {
      ...makeConfig('/tmp/test', { language: 'typescript', enableDebtGates: true }),
      coverageThreshold: 85,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>)
    expect(l2).toContain('lines: 80')
    expect(l3).toContain('lines: 85')
    expect(l2).not.toContain('lines: 85')
  })

  it('vitest.config.ts.ejs emits curated coverage.exclude list (#353)', () => {
    // Per #353: vitest config must include a curated exclude block. Excludes
    // boilerplate that distorts coverage (entrypoints, generated code, types).
    const content = renderTemplate('coverage/vitest.config.ts.ejs', {
      ...makeConfig('/tmp/test', { language: 'typescript', enableDebtGates: true }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>)
    expect(content).toContain('exclude:')
    // Curated entries documented in the template:
    expect(content).toContain('**/*.d.ts')
    expect(content).toContain('**/*.config.*')
    expect(content).toContain('**/index.ts')
  })

  // ── .tarpaulin.toml.ejs ────────────────────────────────────────────────────

  it('.tarpaulin.toml.ejs renders out array with Html and Xml', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'rust',
        buildTool: 'cargo',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/.tarpaulin.toml.ejs', data)
    expect(content).toContain('Html')
    expect(content).toContain('Xml')
  })

  it('.tarpaulin.toml.ejs renders output-dir as coverage/', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'rust',
        buildTool: 'cargo',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/.tarpaulin.toml.ejs', data)
    expect(content).toContain('coverage/')
  })

  it('.tarpaulin.toml.ejs interpolates coverageThreshold into min', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'rust',
        buildTool: 'cargo',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/.tarpaulin.toml.ejs', data)
    expect(content).toContain('80')
  })

  // ── .coveragerc.ejs ────────────────────────────────────────────────────────

  it('.coveragerc.ejs contains [run] section with branch=True', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'python',
        buildTool: 'pip',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/.coveragerc.ejs', data)
    expect(content).toContain('[run]')
    expect(content).toContain('branch')
  })

  it('.coveragerc.ejs contains [report] section with fail_under', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'python',
        buildTool: 'pip',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/.coveragerc.ejs', data)
    expect(content).toContain('[report]')
    expect(content).toContain('fail_under')
    expect(content).toContain('80')
  })

  it('.coveragerc.ejs contains [html] and [xml] sections', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'python',
        buildTool: 'pip',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/.coveragerc.ejs', data)
    expect(content).toContain('[html]')
    expect(content).toContain('[xml]')
  })

  // ── ci.yml.ejs — artifact upload ───────────────────────────────────────────

  it('ci.yml.ejs contains upload-artifact step when enableDebtGates is true', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'typescript',
        enableDebtGates: true,
        useGitHub: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('github/workflows/ci.yml.ejs', data)
    expect(content).toContain('upload-artifact')
    expect(content).toContain('coverage')
  })

  // ── check-all.mjs.ejs — Go HTML + Python reports ──────────────────────────

  it('check-all.mjs.ejs Go section generates HTML coverage report', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'go',
        buildTool: 'go',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
      mutationEnabled: false,
      mutationThreshold: 85,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('coverage.html')
  })

  it('check-all.mjs.ejs Python section generates html and xml coverage reports', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'python',
        buildTool: 'pip',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
      mutationEnabled: false,
      mutationThreshold: 85,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('--cov-report=html')
    expect(content).toContain('--cov-report=xml')
  })

  // ── jacoco-maven-setup.md.ejs ──────────────────────────────────────────────

  it('jacoco-maven-setup.md.ejs renders jacoco-maven-plugin group and threshold', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'maven',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/jacoco-maven-setup.md.ejs', data)
    expect(content).toContain('jacoco-maven-plugin')
    expect(content).toContain('0.80')
    expect(content).toContain('COVEREDRATIO')
  })

  it('jacoco-maven-setup.md.ejs includes mvn verify gate command', () => {
    const data = {
      ...makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'maven',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>
    const content = renderTemplate('coverage/jacoco-maven-setup.md.ejs', data)
    expect(content).toContain('mvn verify')
  })
})
