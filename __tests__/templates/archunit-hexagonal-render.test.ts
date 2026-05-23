import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderHexagonal(governanceLevel = 'L2', overrides: Record<string, unknown> = {}) {
  const data = makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    architectureStyle: 'hexagonal',
    basePackage: 'com.example.app',
    governanceLevel: governanceLevel as 'L1' | 'L2' | 'L3' | 'L4',
    ...overrides,
  }) as unknown as Record<string, unknown>
  return renderTemplate('java/archunit-hexagonal.ejs', data)
}

describe('archunit-hexagonal.ejs — generic hexagonal ArchUnit scaffold (#998)', () => {
  it('L2: renders a Java class named HexagonalArchTest', () => {
    expect(renderHexagonal('L2')).toContain('class HexagonalArchTest')
  })

  it('L2: enforces domain must not import infrastructure', () => {
    const content = renderHexagonal('L2')
    expect(content).toContain('domain_must_not_depend_on_infrastructure')
    expect(content).toContain('infrastructure')
  })

  it('L2: enforces application must not import infrastructure', () => {
    expect(renderHexagonal('L2')).toContain('application_must_not_depend_on_infrastructure')
  })

  it('L2: enforces adapters must not depend on each other', () => {
    expect(renderHexagonal('L2')).toContain('adapters_must_not_depend_on_each_other')
  })

  it('L2: uses basePackage in @AnalyzeClasses attribute', () => {
    const content = renderHexagonal('L2')
    expect(content).toContain('packages = "com.example.app"')
  })

  it('L2: contains @ArchTest annotations', () => {
    expect(renderHexagonal('L2')).toContain('@ArchTest')
  })

  it('L2: imports ArchUnit classes', () => {
    expect(renderHexagonal('L2')).toContain('com.tngtech.archunit')
  })

  it('L3: also renders full scaffold', () => {
    const content = renderHexagonal('L3')
    expect(content).toContain('class HexagonalArchTest')
    expect(content).toContain('domain_must_not_depend_on_infrastructure')
  })

  it('L2: package declaration uses basePackage.architecture', () => {
    expect(renderHexagonal('L2')).toContain('package com.example.app.architecture')
  })

  it('L2: renders without basePackage — fallback to "architecture" package', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      architectureStyle: 'hexagonal',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('java/archunit-hexagonal.ejs', data)
    expect(content).toContain('class HexagonalArchTest')
    expect(content).toContain('package architecture')
    expect(content).toContain('packages = "."')
  })

  it('does not contain EJS tags (no render errors)', () => {
    expect(renderHexagonal('L2')).not.toContain('<%')
  })
})
