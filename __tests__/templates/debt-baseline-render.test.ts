import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { computeMetricsProfile } from '../../src/generators/debt-ratchet.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

function makeDataWithProfile(overrides: Partial<ProjectConfig>) {
  const config = makeConfig('/tmp/test', overrides)
  const metricsProfile = computeMetricsProfile(config)
  return { ...config, metricsProfile } as unknown as Record<string, unknown>
}

describe('capture-debt-baseline.mjs.ejs', () => {
  for (const lang of ['typescript', 'rust', 'java', 'go', 'python'] as const) {
    it(`renders valid JS for ${lang}`, () => {
      const data = makeDataWithProfile({
        language: lang,
        enableDebtGates: true,
      })
      const rendered = renderTemplate('scripts/capture-debt-baseline.mjs.ejs', data)
      expect(rendered).toContain('#!/usr/bin/env node')
      expect(rendered).toContain('debt-baseline.json')
      expect(rendered).toContain('capturedAt')
      expect(rendered).toContain('higher-is-better')
    })
  }

  it('typescript debt-lib contains vitest coverage collection', () => {
    const data = makeDataWithProfile({ language: 'typescript' })
    const rendered = renderTemplate('scripts/debt-lib.mjs.ejs', data)
    expect(rendered).toContain('vitest')
  })

  it('rust debt-lib contains cargo tarpaulin', () => {
    const data = makeDataWithProfile({ language: 'rust' })
    const rendered = renderTemplate('scripts/debt-lib.mjs.ejs', data)
    expect(rendered).toContain('tarpaulin')
  })

  it('go debt-lib contains go test -coverprofile', () => {
    const data = makeDataWithProfile({ language: 'go' })
    const rendered = renderTemplate('scripts/debt-lib.mjs.ejs', data)
    expect(rendered).toContain('coverprofile')
  })

  it('python debt-lib contains pytest --cov', () => {
    const data = makeDataWithProfile({ language: 'python' })
    const rendered = renderTemplate('scripts/debt-lib.mjs.ejs', data)
    expect(rendered).toContain('pytest')
    expect(rendered).toContain('--cov')
  })

  it('java debt-lib uses gradlew for gradle buildTool', () => {
    const data = makeDataWithProfile({
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    const rendered = renderTemplate('scripts/debt-lib.mjs.ejs', data)
    expect(rendered).toContain('gradlew')
  })

  it('java debt-lib uses mvn for maven buildTool', () => {
    const data = makeDataWithProfile({
      language: 'java',
      buildTool: 'maven',
      enableDebtGates: true,
    })
    const rendered = renderTemplate('scripts/debt-lib.mjs.ejs', data)
    expect(rendered).toContain('mvn')
  })
})
