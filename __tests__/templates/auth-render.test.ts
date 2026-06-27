// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(provider: string): string {
  return renderTemplate('auth/setup.md.ejs', makeConfig('/tmp/test', { auth: { provider } }))
}

describe('auth/setup.md.ejs (#726)', () => {
  it('contains project name', () => {
    expect(render('authelia')).toContain('test-project')
  })

  it('app-level-ts: shows Better-Auth / Auth.js section', () => {
    expect(render('app-level-ts')).toMatch(/better.auth|auth\.js|nextauth|lucia/i)
  })

  it('authelia: shows Authelia docker-compose section', () => {
    const out = render('authelia')
    expect(out).toMatch(/authelia/i)
    expect(out).toMatch(/docker.compose|image:/i)
  })

  it('authentik: shows Authentik section', () => {
    expect(render('authentik')).toMatch(/authentik/i)
  })

  it('ory-stack: shows Ory Kratos + Hydra section', () => {
    expect(render('ory-stack')).toMatch(/kratos|hydra|ory/i)
  })

  it('zitadel: shows Zitadel section', () => {
    expect(render('zitadel')).toMatch(/zitadel/i)
  })

  it('keycloak: shows Keycloak section', () => {
    expect(render('keycloak')).toMatch(/keycloak/i)
  })

  it('saas-clerk: shows Clerk section', () => {
    expect(render('saas-clerk')).toMatch(/clerk/i)
  })

  it('saas-auth0: shows Auth0 section', () => {
    expect(render('saas-auth0')).toMatch(/auth0/i)
  })

  it('saas-supabase-auth: shows Supabase Auth section', () => {
    expect(render('saas-supabase-auth')).toMatch(/supabase/i)
  })

  it('saas-cognito: shows Amazon Cognito section', () => {
    expect(render('saas-cognito')).toMatch(/cognito|amazon/i)
  })

  // #1676: the provider if/else-if chain previously had no final `else`, so an unknown
  // provider rendered a content-less body between the header and the Checklist. The new
  // `else` emits an explicit, actionable notice instead of an empty section.
  it('unknown provider: emits an explicit "unknown provider" notice (not an empty body)', () => {
    const out = render('bogus')
    expect(out).toMatch(/unknown provider/i)
    expect(out).toMatch(/re-run the wizard|fix `?auth\.provider`?/i)
    // The bad value is surfaced so the operator can find the typo.
    expect(out).toContain('bogus')
  })
})
