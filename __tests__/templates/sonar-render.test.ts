import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { Language } from '../../src/wizard/types.js'

function renderSonar(language: string, buildTool = 'npm', governanceLevel = 'L2') {
  const data = makeConfig('/tmp/test', {
    language: language as Language,
    projectName: 'my-service',
    buildTool: buildTool as 'npm' | 'maven' | 'gradle',
    governanceLevel: governanceLevel as 'L1' | 'L2' | 'L3' | 'L4',
  }) as unknown as Record<string, unknown>
  return renderTemplate('sonar-project.properties.ejs', data)
}

describe('sonar-project.properties.ejs — SonarCloud integration (#211)', () => {
  describe('Java variant', () => {
    it('L2: contains jacoco XML report path', () => {
      expect(renderSonar('java', 'npm', 'L2')).toContain('sonar.coverage.jacoco.xmlReportPaths')
    })

    it('L2: sources set to src/main/java', () => {
      expect(renderSonar('java', 'npm', 'L2')).toContain('sonar.sources=src/main/java')
    })

    it('L2: tests set to src/test/java', () => {
      expect(renderSonar('java', 'npm', 'L2')).toContain('sonar.tests=src/test/java')
    })

    it('L2: organization placeholder is PLACEHOLDER_ORG', () => {
      expect(renderSonar('java', 'npm', 'L2')).toContain('sonar.organization=PLACEHOLDER_ORG')
    })

    it('L2: projectKey placeholder is PLACEHOLDER_PROJECT_KEY', () => {
      expect(renderSonar('java', 'npm', 'L2')).toContain('sonar.projectKey=PLACEHOLDER_PROJECT_KEY')
    })

    it('L2: projectName is interpolated from config', () => {
      expect(renderSonar('java', 'npm', 'L2')).toContain('sonar.projectName=my-service')
    })

    it('L2: contains qualitygate.wait=true', () => {
      expect(renderSonar('java', 'npm', 'L2')).toContain('sonar.qualitygate.wait=true')
    })

    it('L3: also renders full scaffold with jacoco path', () => {
      const content = renderSonar('java', 'npm', 'L3')
      expect(content).toContain('sonar.coverage.jacoco.xmlReportPaths')
      expect(content).toContain('sonar.organization=PLACEHOLDER_ORG')
    })

    it('does not contain EJS tags (no render errors)', () => {
      expect(renderSonar('java', 'npm', 'L2')).not.toContain('<%')
    })

    it('java/maven emits correct JaCoCo path (#1687)', () => {
      const content = renderSonar('java', 'maven', 'L2')
      expect(content).toContain('sonar.coverage.jacoco.xmlReportPaths=target/coverage/jacoco.xml')
    })

    it('java/gradle emits correct JaCoCo path (#1687)', () => {
      const content = renderSonar('java', 'gradle', 'L2')
      expect(content).toContain('sonar.coverage.jacoco.xmlReportPaths=build/coverage/coverage.xml')
    })

    it('java/maven does NOT emit old wrong path (#1687)', () => {
      const content = renderSonar('java', 'maven', 'L2')
      expect(content).not.toContain('target/site/jacoco/jacoco.xml')
    })
  })

  describe('TypeScript variant', () => {
    it('L2: contains lcov report path', () => {
      expect(renderSonar('typescript', 'npm', 'L2')).toContain('sonar.javascript.lcov.reportPaths')
    })

    it('L2: sources set to src', () => {
      expect(renderSonar('typescript', 'npm', 'L2')).toContain('sonar.sources=src')
    })

    it('L2: tests point to __tests__', () => {
      expect(renderSonar('typescript', 'npm', 'L2')).toContain('sonar.tests=__tests__')
    })

    it('L2: excludes node_modules and dist', () => {
      const content = renderSonar('typescript', 'npm', 'L2')
      expect(content).toContain('node_modules')
      expect(content).toContain('dist')
    })

    it('L2: does NOT contain jacoco path (Java-only)', () => {
      expect(renderSonar('typescript', 'npm', 'L2')).not.toContain(
        'sonar.coverage.jacoco.xmlReportPaths',
      )
    })

    it('L2: projectName is interpolated from config', () => {
      expect(renderSonar('typescript', 'npm', 'L2')).toContain('sonar.projectName=my-service')
    })

    it('L3: organization placeholder present at L3', () => {
      expect(renderSonar('typescript', 'npm', 'L3')).toContain('sonar.organization=PLACEHOLDER_ORG')
    })

    it('does not contain EJS tags (no render errors)', () => {
      expect(renderSonar('typescript', 'npm', 'L2')).not.toContain('<%')
    })
  })

  describe('Unsupported languages — absent language-specific config', () => {
    it('Go: renders headers only, no Java/TS paths', () => {
      const content = renderSonar('go', 'npm', 'L2')
      expect(content).not.toContain('sonar.coverage.jacoco.xmlReportPaths')
      expect(content).not.toContain('sonar.javascript.lcov.reportPaths')
    })

    it('Rust: renders headers only, no Java/TS paths', () => {
      const content = renderSonar('rust', 'npm', 'L2')
      expect(content).not.toContain('sonar.coverage.jacoco.xmlReportPaths')
      expect(content).not.toContain('sonar.javascript.lcov.reportPaths')
    })
  })
})
