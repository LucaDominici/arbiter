import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #1887-G: the dead `workflow_call` (sign-with-retry) half was removed — it was
// emitted with no caller (05-release.yml signs inline). Only the reachable
// `workflow_dispatch` (resign-oci-image) half ships. These tests pin the
// remaining half; the retry/back-off/artifact-name/artifact-file assertions
// for the removed half were deleted with it.

describe('_sigstore-retry-sign.yml.ejs rendering (CANON-04, INV-76, #1887-G)', () => {
  const data = makeConfig('/tmp/test', {
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>

  it('triggers on workflow_dispatch only (no workflow_call half)', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).toMatch(/^on:\s*\n\s*workflow_dispatch:/m)
    // The dead workflow_call trigger was removed (#1887-G); the explanatory
    // header comment may still mention it by name, so assert the trigger KEY
    // (with colon) is absent rather than the bare word.
    expect(rendered).not.toMatch(/^(\s*)workflow_call:/m)
  })

  it('ships the resign-oci-image job (manual post-outage re-sign)', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).toContain('resign-oci-image')
    expect(rendered).toContain('cosign sign --yes')
  })

  it('has top-level permissions block', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).toMatch(/^permissions:/m)
  })

  it('all action refs are SHA-pinned', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    const nonSha = [...rendered.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)]
      .map(([, , ref]) => ref)
      .filter((ref) => !/^[0-9a-f]{40}$/i.test(ref))
    expect(nonSha).toEqual([])
  })

  it('enforces an owner-only guard on the manual dispatch', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).toMatch(/repository_owner/)
  })

  it('does NOT carry the removed retry/back-off scaffold', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).not.toContain('delay=$((delay * 2))')
    expect(rendered).not.toContain('artifact-name')
    expect(rendered).not.toContain('artifact-file')
  })
})
