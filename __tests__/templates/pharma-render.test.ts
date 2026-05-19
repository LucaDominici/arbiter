// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for pharma EJS templates (#888)

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderAuditEvent(overrides: Record<string, unknown> = {}) {
  const data = makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    basePackage: 'com.example.pharmaapp',
    industryOverlay: 'pharma',
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
  return renderTemplate('java/pharma/AuditEvent.java.ejs', data)
}

function renderAuditMapper(overrides: Record<string, unknown> = {}) {
  const data = makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    basePackage: 'com.example.pharmaapp',
    industryOverlay: 'pharma',
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
  return renderTemplate('java/pharma/AuditMapper.java.ejs', data)
}

function renderArchunitPharma(overrides: Record<string, unknown> = {}) {
  const data = makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    basePackage: 'com.example.pharmaapp',
    industryOverlay: 'pharma',
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
  return renderTemplate('java/pharma/archunit-pharma.ejs', data)
}

// ─── AuditEvent.java.ejs ─────────────────────────────────────────────────────

describe('AuditEvent.java.ejs (CANON-04, #888)', () => {
  it('renders without EJS syntax errors', () => {
    expect(() => renderAuditEvent()).not.toThrow()
  })

  it('uses basePackage in package declaration', () => {
    const content = renderAuditEvent({ basePackage: 'com.example.pharmaapp' })
    expect(content).toContain('package com.example.pharmaapp.audit')
  })

  it('falls back to audit package when basePackage is absent', () => {
    const content = renderAuditEvent({ basePackage: undefined })
    expect(content).toContain('package audit')
    expect(content).not.toContain('undefined')
  })

  it('contains @Entity annotation (KIT dim 73)', () => {
    expect(renderAuditEvent()).toContain('@Entity')
  })

  it('contains @Table annotation', () => {
    expect(renderAuditEvent()).toContain('@Table')
  })

  it('declares actorId field (KIT dim 73)', () => {
    expect(renderAuditEvent()).toContain('actorId')
  })

  it('declares action field', () => {
    expect(renderAuditEvent()).toContain('action')
  })

  it('declares entityType field (KIT dim 74)', () => {
    expect(renderAuditEvent()).toContain('entityType')
  })

  it('declares entityId field', () => {
    expect(renderAuditEvent()).toContain('entityId')
  })

  it('declares SourceContext enum (R-37 support)', () => {
    expect(renderAuditEvent()).toContain('SourceContext')
    expect(renderAuditEvent()).toContain('SYSTEM')
    expect(renderAuditEvent()).toContain('HUMAN')
  })

  it('declares recordedAt timestamp', () => {
    expect(renderAuditEvent()).toContain('recordedAt')
    expect(renderAuditEvent()).toContain('Instant')
  })

  it('has Builder inner class (R-35 enforcement)', () => {
    expect(renderAuditEvent()).toContain('Builder')
    expect(renderAuditEvent()).toContain('public AuditEvent build()')
  })

  it('uses jakarta.persistence (not javax.persistence)', () => {
    expect(renderAuditEvent()).toContain('jakarta.persistence')
    expect(renderAuditEvent()).not.toContain('javax.persistence')
  })
})

// ─── AuditMapper.java.ejs ─────────────────────────────────────────────────────

describe('AuditMapper.java.ejs (CANON-04, #888)', () => {
  it('renders without EJS syntax errors', () => {
    expect(() => renderAuditMapper()).not.toThrow()
  })

  it('uses basePackage in package declaration', () => {
    const content = renderAuditMapper({ basePackage: 'com.example.pharmaapp' })
    expect(content).toContain('package com.example.pharmaapp.audit')
  })

  it('falls back to audit package when basePackage is absent', () => {
    const content = renderAuditMapper({ basePackage: undefined })
    expect(content).toContain('package audit')
    expect(content).not.toContain('undefined')
  })

  it('contains @Mapper annotation (KIT dim 75)', () => {
    expect(renderAuditMapper()).toContain('@Mapper')
  })

  it('declares interface AuditMapper', () => {
    expect(renderAuditMapper()).toContain('interface AuditMapper')
  })

  it('contains toEntity mapping method', () => {
    expect(renderAuditMapper()).toContain('toEntity')
  })

  it('contains AuditRequest record', () => {
    expect(renderAuditMapper()).toContain('AuditRequest')
    expect(renderAuditMapper()).toContain('record')
  })

  it('imports org.mapstruct', () => {
    expect(renderAuditMapper()).toContain('org.mapstruct')
  })
})

// ─── archunit-pharma.ejs ─────────────────────────────────────────────────────

describe('archunit-pharma.ejs (CANON-04, #888)', () => {
  it('renders without EJS syntax errors', () => {
    expect(() => renderArchunitPharma()).not.toThrow()
  })

  it('uses basePackage in package declaration', () => {
    const content = renderArchunitPharma({ basePackage: 'com.example.pharmaapp' })
    expect(content).toContain('package com.example.pharmaapp.architecture')
  })

  it('falls back to architecture package when basePackage is absent', () => {
    const content = renderArchunitPharma({ basePackage: undefined })
    expect(content).toContain('package architecture')
  })

  it('uses basePackage in @AnalyzeClasses / importPackages when set', () => {
    const content = renderArchunitPharma({ basePackage: 'com.example.pharmaapp' })
    expect(content).toContain('com.example.pharmaapp')
  })

  it('contains R-35 rule', () => {
    expect(renderArchunitPharma()).toContain('R-35')
  })

  it('contains R-36 rule', () => {
    expect(renderArchunitPharma()).toContain('R-36')
  })

  it('contains R-37 rule', () => {
    expect(renderArchunitPharma()).toContain('R-37')
  })

  it('contains R-38 rule', () => {
    expect(renderArchunitPharma()).toContain('R-38')
  })

  it('contains R-39 rule', () => {
    expect(renderArchunitPharma()).toContain('R-39')
  })

  it('contains @Test annotations', () => {
    expect(renderArchunitPharma()).toContain('@Test')
  })

  it('contains ArchUnit imports', () => {
    expect(renderArchunitPharma()).toContain('com.tngtech.archunit')
  })

  it('contains class name PharmaArchUnitTest', () => {
    expect(renderArchunitPharma()).toContain('PharmaArchUnitTest')
  })
})
