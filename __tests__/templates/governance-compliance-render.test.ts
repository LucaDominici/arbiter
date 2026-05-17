// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'

const BASE = {
  projectName: 'test-project',
  language: 'typescript',
  governanceLevel: 'L2',
}

describe('governance/enterprise-compliance-baseline.md.ejs render (#711)', () => {
  const render = () => renderTemplate('governance/enterprise-compliance-baseline.md.ejs', BASE)

  it('renders without throwing', () => {
    expect(() => render()).not.toThrow()
  })

  it('starts with # Enterprise Compliance Baseline', () => {
    expect(render().trimStart()).toMatch(/^# Enterprise Compliance Baseline/)
  })

  it('contains ISO 27001', () => {
    expect(render()).toContain('ISO 27001')
  })

  it('contains GDPR', () => {
    expect(render()).toContain('GDPR')
  })

  it('contains NIS2', () => {
    expect(render()).toContain('NIS2')
  })

  it('contains OWASP ASVS', () => {
    expect(render()).toContain('OWASP ASVS')
  })
})

describe('governance/gdpr-erasure-runbook.md.ejs render (#713)', () => {
  const render = () => renderTemplate('governance/gdpr-erasure-runbook.md.ejs', BASE)

  it('renders without throwing', () => {
    expect(() => render()).not.toThrow()
  })

  it('contains the Keycloak hard-delete step (audit fix)', () => {
    expect(render()).toContain('DELETE /admin/realms/{realm}/users/{user-id}')
  })

  it('lists Auth0 alongside Keycloak (vendor neutrality)', () => {
    expect(render()).toContain('Auth0')
  })

  it('lists Cognito alongside Keycloak (vendor neutrality)', () => {
    expect(render()).toContain('Cognito')
  })

  it('lists Okta alongside Keycloak (vendor neutrality)', () => {
    expect(render()).toContain('Okta')
  })
})

describe('governance/gdpr-erasure-hooks/java-spring.java.ejs render (#713)', () => {
  const render = () => renderTemplate('governance/gdpr-erasure-hooks/java-spring.java.ejs', BASE)

  it('renders without throwing', () => {
    expect(() => render()).not.toThrow()
  })

  it('contains @Service annotation', () => {
    expect(render()).toContain('@Service')
  })

  it('contains UnsupportedOperationException (fail-loud stub)', () => {
    expect(render()).toContain('UnsupportedOperationException')
  })

  it('contains eraseIdentityProviderUser method', () => {
    expect(render()).toContain('eraseIdentityProviderUser')
  })
})

describe('governance/gdpr-erasure-hooks/ts-express.ts.ejs render (#713)', () => {
  const render = () => renderTemplate('governance/gdpr-erasure-hooks/ts-express.ts.ejs', BASE)

  it('renders without throwing', () => {
    expect(() => render()).not.toThrow()
  })

  it('contains eraseIdentityProviderUser method', () => {
    expect(render()).toContain('eraseIdentityProviderUser')
  })

  it('contains fail-loud throw', () => {
    expect(render()).toContain('NOT-IMPLEMENTED-STUB')
  })
})

describe('governance/gdpr-erasure-hooks/go-chi.go.ejs render (#713)', () => {
  const render = () => renderTemplate('governance/gdpr-erasure-hooks/go-chi.go.ejs', BASE)

  it('renders without throwing', () => {
    expect(() => render()).not.toThrow()
  })

  it('contains EraseIdentityProviderUser method (exported)', () => {
    expect(render()).toContain('EraseIdentityProviderUser')
  })

  it('contains errors.New (fail-loud stub)', () => {
    expect(render()).toContain('errors.New')
  })
})
