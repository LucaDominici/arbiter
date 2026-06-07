// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for AntiProformaTest.java.ejs and AntiProformaExempt.java.ejs
// Red phase: all tests must FAIL until templates are created.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('AntiProformaTest.java.ejs rendering (CANON-04, #1249)', () => {
  const data = makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    basePackage: 'com.example.architecture',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>

  it('renders with correct package declaration', () => {
    const rendered = renderTemplate('archunit/AntiProformaTest.java.ejs', data)
    expect(rendered).toContain('package com.example.architecture')
  })

  it('references @Test annotation detection', () => {
    const rendered = renderTemplate('archunit/AntiProformaTest.java.ejs', data)
    expect(rendered).toContain('@Test')
  })

  it('includes AssertJ assertion class reference', () => {
    const rendered = renderTemplate('archunit/AntiProformaTest.java.ejs', data)
    // Must reference org.assertj or assertj
    expect(rendered.toLowerCase()).toContain('assertj')
  })

  it('references AntiProformaExempt annotation', () => {
    const rendered = renderTemplate('archunit/AntiProformaTest.java.ejs', data)
    expect(rendered).toContain('AntiProformaExempt')
  })

  it('imports ArchUnit classes', () => {
    const rendered = renderTemplate('archunit/AntiProformaTest.java.ejs', data)
    expect(rendered).toContain('com.tngtech.archunit')
  })

  it('uses @AnalyzeClasses annotation', () => {
    const rendered = renderTemplate('archunit/AntiProformaTest.java.ejs', data)
    expect(rendered).toContain('@AnalyzeClasses')
  })
})

describe('AntiProformaExempt.java.ejs rendering (CANON-04, #1249)', () => {
  const data = makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    basePackage: 'com.example.architecture',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>

  it('renders annotation interface definition', () => {
    const rendered = renderTemplate('archunit/AntiProformaExempt.java.ejs', data)
    expect(rendered).toContain('@interface AntiProformaExempt')
  })

  it('has CLASS retention policy (not SOURCE — ArchUnit reads bytecode)', () => {
    const rendered = renderTemplate('archunit/AntiProformaExempt.java.ejs', data)
    expect(rendered).toContain('RetentionPolicy.CLASS')
  })

  it('renders with correct package declaration', () => {
    const rendered = renderTemplate('archunit/AntiProformaExempt.java.ejs', data)
    expect(rendered).toContain('package com.example.architecture')
  })

  it('has value() String method for rationale', () => {
    const rendered = renderTemplate('archunit/AntiProformaExempt.java.ejs', data)
    expect(rendered).toContain('String value()')
  })
})
