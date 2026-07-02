// SPDX-License-Identifier: Apache-2.0
//
// Regression coverage for the consumer-resolution audit gate (#1718, follow-up to
// #1670 parts 2&3).
//
// scripts/check-all.mjs's existing `audit` step runs `npm audit --omit=dev
// --audit-level=high` against the DEV tree, where npm `overrides` ARE applied —
// structurally blind to what a consumer of @arbiter/cli actually resolves (npm
// silently drops `overrides` for anyone who installs the package as a dependency).
// This gate closes that blind spot: pack the publishable tarball, install it into a
// throwaway root with no repo overrides/devDeps, and audit THAT tree at a stricter
// `moderate` floor.
//
// Two surfaces are pinned here:
//   1. classifyConsumerAudit() — the pure classifier over an `npm audit --json`
//      payload + a disposition allowlist. Side-effect-free, no npm spawn.
//   2. Wiring — the gate is registered in check-all.mjs (L2), CI_COVERAGE (INV-59),
//      and both suppression enumerations (check-suppressions.mjs,
//      check-suppression-expiry.mjs), and the allowlist file itself is
//      structurally sound.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { classifyConsumerAudit, SEVERITY_FLOOR } from '../../scripts/check-consumer-audit.mjs'

function ghsaVuln(overrides: Record<string, unknown> = {}) {
  return {
    'left-pad': {
      name: 'left-pad',
      severity: 'moderate',
      via: [
        {
          source: 1096441,
          name: 'left-pad',
          dependency: 'left-pad',
          title: 'Prototype Pollution in left-pad',
          url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
          severity: 'moderate',
          range: '<1.3.0',
        },
      ],
      effects: [],
      range: '<1.3.0',
      nodes: ['node_modules/left-pad'],
      fixAvailable: true,
      ...overrides,
    },
  }
}

describe('classifyConsumerAudit — pure classifier (#1718)', () => {
  it('SEVERITY_FLOOR is moderate/high/critical (stricter than the dev-tree high floor)', () => {
    expect(SEVERITY_FLOOR.has('moderate')).toBe(true)
    expect(SEVERITY_FLOOR.has('high')).toBe(true)
    expect(SEVERITY_FLOOR.has('critical')).toBe(true)
    expect(SEVERITY_FLOOR.has('low')).toBe(false)
    expect(SEVERITY_FLOOR.has('info')).toBe(false)
  })

  it('flags a moderate vuln with no allowlist entry', () => {
    const audit = { vulnerabilities: ghsaVuln(), metadata: { vulnerabilities: { moderate: 1 } } }
    const { unsuppressed, errored } = classifyConsumerAudit(audit, [], new Date('2026-07-01'))
    expect(errored).toBe(false)
    expect(unsuppressed).toHaveLength(1)
    expect(unsuppressed[0]?.package).toBe('left-pad')
    expect(unsuppressed[0]?.severity).toBe('moderate')
  })

  it('suppresses a vuln matched by a non-expired allowlist entry (scope = GHSA id)', () => {
    const audit = { vulnerabilities: ghsaVuln(), metadata: {} }
    const allowlist = [
      {
        reason: 'tracked in #1718, remediation pending upstream release',
        owner: '@core',
        expiresAt: '2027-01-01',
        scope: 'GHSA-aaaa-bbbb-cccc',
      },
    ]
    const { unsuppressed, errored } = classifyConsumerAudit(
      audit,
      allowlist,
      new Date('2026-07-01'),
    )
    expect(errored).toBe(false)
    expect(unsuppressed).toEqual([])
  })

  it('does NOT suppress via an EXPIRED allowlist entry — the vuln resurfaces', () => {
    const audit = { vulnerabilities: ghsaVuln(), metadata: {} }
    const allowlist = [
      {
        reason: 'tracked in #1718, remediation pending upstream release',
        owner: '@core',
        expiresAt: '2026-01-01',
        scope: 'GHSA-aaaa-bbbb-cccc',
      },
    ]
    const { unsuppressed } = classifyConsumerAudit(audit, allowlist, new Date('2026-07-01'))
    expect(unsuppressed).toHaveLength(1)
  })

  it('suppresses by package-name scope', () => {
    const audit = { vulnerabilities: ghsaVuln(), metadata: {} }
    const allowlist = [
      {
        reason: 'tracked in #1718, remediation pending upstream release',
        owner: '@core',
        expiresAt: '2027-01-01',
        scope: 'left-pad',
      },
    ]
    const { unsuppressed } = classifyConsumerAudit(audit, allowlist, new Date('2026-07-01'))
    expect(unsuppressed).toEqual([])
  })

  it('suppresses by numeric via[].source scope', () => {
    const audit = { vulnerabilities: ghsaVuln(), metadata: {} }
    const allowlist = [
      {
        reason: 'tracked in #1718, remediation pending upstream release',
        owner: '@core',
        expiresAt: '2027-01-01',
        scope: '1096441',
      },
    ]
    const { unsuppressed } = classifyConsumerAudit(audit, allowlist, new Date('2026-07-01'))
    expect(unsuppressed).toEqual([])
  })

  it('excludes low/info severity vulns (below the moderate floor)', () => {
    const audit = {
      vulnerabilities: ghsaVuln({ severity: 'low' }),
      metadata: {},
    }
    const { unsuppressed, errored } = classifyConsumerAudit(audit, [], new Date('2026-07-01'))
    expect(errored).toBe(false)
    expect(unsuppressed).toEqual([])
  })

  it('surfaces high and critical vulns', () => {
    for (const severity of ['high', 'critical']) {
      const audit = { vulnerabilities: ghsaVuln({ severity }), metadata: {} }
      const { unsuppressed } = classifyConsumerAudit(audit, [], new Date('2026-07-01'))
      expect(unsuppressed).toHaveLength(1)
    }
  })

  it('treats null / non-object input as errored', () => {
    expect(classifyConsumerAudit(null, [], new Date()).errored).toBe(true)
    expect(classifyConsumerAudit(undefined, [], new Date()).errored).toBe(true)
    expect(classifyConsumerAudit('not an object', [], new Date()).errored).toBe(true)
    expect(classifyConsumerAudit(42, [], new Date()).errored).toBe(true)
  })

  it('treats an object lacking BOTH vulnerabilities and metadata as errored', () => {
    expect(classifyConsumerAudit({}, [], new Date()).errored).toBe(true)
    expect(classifyConsumerAudit({ foo: 'bar' }, [], new Date()).errored).toBe(true)
  })

  it('treats an empty vulnerabilities object as CLEAN, not errored (the crux fix)', () => {
    const clean = { vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } }
    const { unsuppressed, errored } = classifyConsumerAudit(clean, [], new Date('2026-07-01'))
    expect(errored).toBe(false)
    expect(unsuppressed).toEqual([])
  })

  it('handles a `via` array mixing strings (transitive-through-package) and objects without throwing', () => {
    const audit = {
      vulnerabilities: {
        'transitive-pkg': {
          name: 'transitive-pkg',
          severity: 'high',
          via: [
            'upstream-package',
            {
              source: 2000000,
              name: 'transitive-pkg',
              url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz',
              severity: 'high',
            },
          ],
          effects: [],
          range: '*',
          nodes: [],
          fixAvailable: false,
        },
      },
      metadata: {},
    }
    expect(() => classifyConsumerAudit(audit, [], new Date('2026-07-01'))).not.toThrow()
    const { unsuppressed } = classifyConsumerAudit(audit, [], new Date('2026-07-01'))
    expect(unsuppressed).toHaveLength(1)

    // Suppressible by the upstream package name derived from the string `via` entry.
    const allowlist = [
      {
        reason: 'tracked in #1718, remediation pending upstream release',
        owner: '@core',
        expiresAt: '2027-01-01',
        scope: 'upstream-package',
      },
    ]
    const { unsuppressed: afterSuppress } = classifyConsumerAudit(
      audit,
      allowlist,
      new Date('2026-07-01'),
    )
    expect(afterSuppress).toEqual([])
  })
})

describe('consumer-audit gate wiring (#1718)', () => {
  it('resolves the pinned npm via parsePinnedNpm (imported, not re-derived — CANON-22)', () => {
    const src = readFileSync(resolve('scripts/check-consumer-audit.mjs'), 'utf-8')
    expect(src).toMatch(/import\s*\{\s*parsePinnedNpm\s*\}\s*from\s*'\.\/check-npm-ci-drift\.mjs'/)
    expect(src).toMatch(/npx/)
    expect(src).toMatch(/`npm@\$\{pin\}`/)
  })

  it('is registered in scripts/check-all.mjs AFTER the L1/L2 boundary (L2-only)', () => {
    const src = readFileSync(resolve('scripts/check-all.mjs'), 'utf-8')
    const boundaryIdx = src.indexOf("if (subcommand !== 'check')")
    const consumerIdx = src.indexOf("runCheck('consumer audit'")
    expect(boundaryIdx).toBeGreaterThan(-1)
    expect(consumerIdx).toBeGreaterThan(boundaryIdx)
  })

  it('is registered in CI_COVERAGE (scripts/check-local-ci-parity.mjs, INV-59)', () => {
    const src = readFileSync(resolve('scripts/check-local-ci-parity.mjs'), 'utf-8')
    expect(src).toMatch(/\['consumer audit',\s*'gate-full'\]/)
  })

  it('is enumerated by scripts/check-suppressions.mjs', () => {
    const src = readFileSync(resolve('scripts/check-suppressions.mjs'), 'utf-8')
    expect(src).toMatch(/consumer-audit-allowlist\.json/)
  })

  it('is enumerated by scripts/check-suppression-expiry.mjs', () => {
    const src = readFileSync(resolve('scripts/check-suppression-expiry.mjs'), 'utf-8')
    expect(src).toMatch(/consumer-audit-allowlist\.json/)
  })

  it('is enumerated by scripts/check-suppression-rationale.mjs', () => {
    const src = readFileSync(resolve('scripts/check-suppression-rationale.mjs'), 'utf-8')
    expect(src).toMatch(/consumer-audit-allowlist\.json/)
  })

  it('has NO offline/network SKIP branch — a security gate fails closed (INV-96)', () => {
    // Amended per final red-team review: an offline PASS on a supply-chain gate is
    // exactly the fail-open INV-96 forbids. The sibling `npm audit` step already
    // hard-fails offline on every pre-push; this gate follows the same precedent.
    const src = readFileSync(resolve('scripts/check-consumer-audit.mjs'), 'utf-8')
    expect(src).not.toMatch(/SKIP/)
    expect(src).not.toMatch(/isLocalOffline|looksLikeNetworkFailure|GITHUB_ACTIONS/)
  })

  it('suppressions/consumer-audit-allowlist.json is a structurally valid (possibly empty) array', () => {
    const raw = readFileSync(resolve('suppressions/consumer-audit-allowlist.json'), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    expect(Array.isArray(parsed)).toBe(true)
    for (const entry of parsed as Array<Record<string, unknown>>) {
      expect(typeof entry.reason).toBe('string')
      expect((entry.reason as string).length).toBeGreaterThanOrEqual(10)
      expect(typeof entry.owner).toBe('string')
      expect(typeof entry.scope).toBe('string')
      expect((entry.scope as string).length).toBeGreaterThan(0)
      const expiry = new Date(entry.expiresAt as string)
      expect(isNaN(expiry.getTime())).toBe(false)
      expect(expiry.getTime()).toBeGreaterThan(Date.now())
    }
  })
})
