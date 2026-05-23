import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('01-pr-fast.yml.ejs rendering', () => {
  it('includes debt-ratchet job when enableDebtGates is true', () => {
    const data = makeConfig('/tmp/test', {
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('debt-ratchet')
    expect(rendered).toContain('debt-report.mjs')
  })

  it('does not include debt-ratchet when enableDebtGates is false', () => {
    const data = makeConfig('/tmp/test', {
      enableDebtGates: false,
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).not.toContain('debt-ratchet')
  })

  it('uses --gate flag at L2', () => {
    const data = makeConfig('/tmp/test', {
      enableDebtGates: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('--gate')
  })

  it('uses --require-improvement flag at L3', () => {
    const data = makeConfig('/tmp/test', {
      enableDebtGates: true,
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('--require-improvement')
  })

  it('emits pr-fast concurrency group scoped to head_ref (#357)', () => {
    const data = makeConfig('/tmp/test', {}) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('concurrency:')
    expect(rendered).toContain('group: pr-fast-${{ github.head_ref || github.ref }}')
    expect(rendered).toMatch(
      /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' && github\.ref != 'refs\/heads\/develop' \}\}/,
    )
  })

  it('debt-ratchet is listed in ci-required needs when enableDebtGates', () => {
    const data = makeConfig('/tmp/test', {
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('debt-ratchet')
    // Verify it appears in the ci-required section
    const ciRequired = rendered.split('ci-required:')[1]
    expect(ciRequired).toContain('debt-ratchet')
  })

  // Java debt-gates job — SpotBugs step (#404)
  it('Java Gradle debt-gates job includes spotbugsMain step', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('spotbugsMain')
  })

  it('Java Maven debt-gates job includes spotbugs:check step', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'maven',
      enableDebtGates: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('spotbugs:check')
  })
})

describe('01-pr-fast.yml.ejs — test-results artifact upload (#194)', () => {
  it('TypeScript: upload-artifact for test-results when enableDebtGates=true', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      enableDebtGates: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('test-results')
    expect(rendered).toContain('upload-artifact')
  })

  it('TypeScript: no test-results upload in lint-and-test when enableDebtGates=false', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      enableDebtGates: false,
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).not.toContain('test-results')
  })

  it('Java Gradle: upload-artifact for test-results when enableDebtGates=true', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('test-results')
    expect(rendered).toContain('upload-artifact')
  })

  it('Python: upload-artifact for test-results when enableDebtGates=true', () => {
    const data = makeConfig('/tmp/test', {
      language: 'python',
      enableDebtGates: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('test-results')
    expect(rendered).toContain('upload-artifact')
  })

  it('docs-check job honors [skip-docs] commit bypass token (#356)', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    // docs-check job present
    expect(rendered).toContain('docs-check:')
    // bypass token honored in CI
    expect(rendered).toContain('[skip-docs]')
  })
})

// ─── T1 structural features (CANON-18) ───────────────────────────────────────

describe('01-pr-fast.yml.ejs — T1 structural features (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: workflow name is "PR Fast (T1)"', ({ language, buildTool }) => {
    const data = makeConfig('/tmp/test', { language, buildTool }) as unknown as Record<
      string,
      unknown
    >
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('name: PR Fast (T1)')
  })

  it.each(STACKS)(
    '$language: top-level permissions sets contents: read',
    ({ language, buildTool }) => {
      const data = makeConfig('/tmp/test', { language, buildTool }) as unknown as Record<
        string,
        unknown
      >
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      expect(rendered).toContain('permissions:')
      expect(rendered).toContain('contents: read')
    },
  )

  it.each(STACKS)('$language: concurrency group uses head_ref', ({ language, buildTool }) => {
    const data = makeConfig('/tmp/test', { language, buildTool }) as unknown as Record<
      string,
      unknown
    >
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('group: pr-fast-${{ github.head_ref || github.ref }}')
  })

  it.each(STACKS)('$language: includes human-approval-required job', ({ language, buildTool }) => {
    const data = makeConfig('/tmp/test', { language, buildTool }) as unknown as Record<
      string,
      unknown
    >
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('human-approval-required:')
    expect(rendered).toContain('approved-by-human')
  })

  it.each(STACKS)(
    '$language: human-approval-required is in ci-required needs',
    ({ language, buildTool }) => {
      const data = makeConfig('/tmp/test', { language, buildTool }) as unknown as Record<
        string,
        unknown
      >
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      const ciRequired = rendered.split('ci-required:')[1] ?? ''
      expect(ciRequired).toContain('human-approval-required')
    },
  )

  it.each(LEVELS)('governance %s: human-approval-required present at every level', (level) => {
    const data = makeConfig('/tmp/test', { governanceLevel: level }) as unknown as Record<
      string,
      unknown
    >
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).toContain('human-approval-required:')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const data = makeConfig('/tmp/test', { governanceLevel: level }) as unknown as Record<
      string,
      unknown
    >
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

describe('01-pr-fast.yml.ejs — SonarCloud step (#211)', () => {
  it('L2: contains SonarCloud Scan step', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    expect(renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)).toContain('SonarCloud Scan')
  })

  it('L2: SonarCloud step gated on SONAR_TOKEN env var', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    expect(renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)).toContain(
      "env.SONAR_TOKEN != ''",
    )
  })

  it('L2: SonarCloud step references secrets.SONAR_TOKEN', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    expect(renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)).toContain(
      'secrets.SONAR_TOKEN',
    )
  })

  it('L3: SonarCloud step also present at L3', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    expect(renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)).toContain('SonarCloud Scan')
  })

  it('L1: SonarCloud step absent (governance gate)', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    expect(renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)).not.toContain(
      'SonarCloud Scan',
    )
  })

  it('Java + Gradle: SonarCloud uses ./gradlew sonarqube', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(content).toContain('./gradlew sonarqube')
    expect(content).not.toContain('mvn sonar:sonar')
  })

  it('Java + Maven: SonarCloud uses mvn sonar:sonar', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'maven',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
    expect(content).toContain('mvn sonar:sonar')
    expect(content).not.toContain('./gradlew sonarqube')
  })
})
