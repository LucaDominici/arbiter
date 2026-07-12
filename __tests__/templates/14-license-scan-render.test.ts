import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('14-license-scan.yml.ejs rendering (CANON-04, #1076)', () => {
  it('renders scheduled license scan job', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/14-license-scan.yml.ejs', data)
    expect(rendered).toContain('license')
    expect(rendered).toContain('cron:')
  })

  it('has top-level permissions block', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/14-license-scan.yml.ejs', data)
    expect(rendered).toMatch(/^permissions:/m)
  })

  it('renders Java license block for java+gradle', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/14-license-scan.yml.ejs', data)
    expect(rendered).toContain('setup-gradle')
    expect(rendered).toContain('generateLicenseReport')
  })

  it('all action refs are SHA-pinned (java+gradle)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/14-license-scan.yml.ejs', data)
    const nonSha = [...rendered.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)]
      .map(([, , ref]) => ref)
      .filter((ref) => !/^[0-9a-f]{40}$/i.test(ref))
    expect(nonSha).toEqual([])
  })

  // #1803: license_scan was one of 3/8 workflow dims relying on an unverified
  // JVM-shared EJS branch for kotlin. `language === 'java'` is a strict-equality
  // check that never matches 'kotlin', so the job rendered checkout-only —
  // silently producing no license report at all. Gradle/Maven license-report
  // plugins operate on the build's dependency graph, not the source language,
  // so kotlin now shares the java arm (same fix shape as the fuzz job).
  it.each(['gradle', 'maven'] as const)(
    'kotlin/%s: shares the java/JVM license-report branch, not checkout-only',
    (buildTool) => {
      const data = makeConfig('/tmp/test', {
        language: 'kotlin',
        buildTool,
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/14-license-scan.yml.ejs', data)
      expect(rendered).toContain('setup-java')
      expect(rendered).toContain(
        buildTool === 'gradle' ? 'generateLicenseReport' : 'license:aggregate-add-third-party',
      )
    },
  )

  it('kotlin leaves no EJS tag leaks', () => {
    const data = makeConfig('/tmp/test', {
      language: 'kotlin',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/14-license-scan.yml.ejs', data)
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})
