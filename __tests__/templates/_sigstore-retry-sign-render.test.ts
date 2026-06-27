import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('_sigstore-retry-sign.yml.ejs rendering (CANON-04, INV-76, #1076)', () => {
  const data = makeConfig('/tmp/test', {
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>

  it('renders cosign retry wrapper', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).toContain('cosign sign-blob')
    expect(rendered).toContain('max-attempts')
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

  it('implements exponential back-off retry', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).toContain('delay=$((delay * 2))')
  })

  // #1663: the single `artifact-path` input conflated an artifact NAME (for
  // download-artifact) with a filesystem PATH (for cosign sign-blob). It is split
  // into `artifact-name` and `artifact-file` so neither concept is misused.
  it('separates artifact-name (download) from artifact-file (sign) — no conflated artifact-path', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    expect(rendered).toContain('artifact-name:')
    expect(rendered).toContain('artifact-file:')
    expect(rendered).not.toContain('artifact-path')
  })

  it('download step uses artifact-name with an explicit path; sign uses artifact-file', () => {
    const rendered = renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data)
    // download-artifact pulls by NAME and lands in a deterministic directory
    expect(rendered).toMatch(/name:\s*\$\{\{\s*inputs\.artifact-name\s*\}\}/)
    expect(rendered).toMatch(/download-artifact[\s\S]*?path:\s*\./)
    // the file handed to cosign comes from artifact-file via env (injection-safe)
    expect(rendered).toMatch(/ARTIFACT:\s*\$\{\{\s*inputs\.artifact-file\s*\}\}/)
  })
})
