/**
 * Tests for src/config/migrations/index.ts
 * Issue: #231 — Config migration v0.1 → v2 + self-upgrade
 *
 * Version mapping:
 *   v0  = no `version` field (pre-versioning)
 *   v1  = version: "0.1" (legacy, was handled by migrateV1ToV2 in schema.ts)
 *   v2  = version: "0.2" (current canonical, ArbiterConfigV2)
 */
import { describe, it, expect } from 'vitest'
import { migrate } from '../../src/config/migrations/index.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'

// Minimal valid v2 shape for round-trip / idempotence tests
const CANONICAL_V2 = {
  version: '0.2',
  tools: ['claude', 'codex'],
  governanceLevel: 'L2',
  useGitHub: false,
  decomposition: { backend: 'markdown' },
  features: {
    contractTesting: false,
    mutationTesting: true,
    securityScanning: true,
    evidenceHarness: false,
    debtGates: true,
    suppressions: true,
  },
  thresholds: DEFAULT_THRESHOLDS.L2,
}

// Current arbiter.json contents (must be identity under migrate)
const ARBITER_JSON = {
  version: '0.2',
  tools: ['claude', 'codex'],
  governanceLevel: 'L2',
  permitGitHub: true,
  decomposition: {
    backend: 'github',
  },
  features: {
    debtGates: true,
    suppressions: true,
    securityScanning: true,
    mutationTesting: true,
    contractTesting: false,
    evidenceHarness: false,
  },
  thresholds: {
    lineCoverage: 80,
    branchCoverage: 70,
    mutationScore: 80,
    cyclomaticComplexity: 15,
    methodLength: 65,
    maxParams: 7,
  },
  invariantTiers: ['architectural', 'governance', 'data', 'operational'],
  archetype: 'library',
  architectureStyle: 'none',
  isMultiTenant: false,
  hasDatabase: false,
  hasPublicApi: false,
  contractType: 'none',
  lanes: ['docs'],
}

// ── v0 (no version field) ────────────────────────────────────────────────────

describe('migrate — v0 (no version field)', () => {
  it('produces version 0.2 from a config with no version field', () => {
    const v0 = {
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    }
    const result = migrate(v0)
    expect(result.version).toBe('0.2')
  })

  it('derives features from governance level when no enableX flags present', () => {
    const v0 = {
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    }
    const result = migrate(v0)
    expect(result.features.debtGates).toBe(true)
    expect(result.features.securityScanning).toBe(true)
    expect(result.features.mutationTesting).toBe(true)
    expect(result.features.suppressions).toBe(true)
    expect(result.features.contractTesting).toBe(false)
  })

  it('L1 v0 derives all non-suppressions features false', () => {
    const v0 = {
      tools: ['claude'],
      governanceLevel: 'L1',
      useGitHub: false,
    }
    const result = migrate(v0)
    expect(result.features.debtGates).toBe(false)
    expect(result.features.securityScanning).toBe(false)
    expect(result.features.mutationTesting).toBe(false)
    expect(result.features.suppressions).toBe(true)
  })

  it('derives decomposition.backend=github from useGitHub:true', () => {
    const v0 = {
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: true,
    }
    const result = migrate(v0)
    expect(result.decomposition?.backend).toBe('github')
  })

  it('derives decomposition.backend=markdown from useGitHub:false', () => {
    const v0 = {
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    }
    const result = migrate(v0)
    expect(result.decomposition?.backend).toBe('markdown')
  })
})

// ── v1 (version: "0.1") ─────────────────────────────────────────────────────

describe("migrate — v1 (version: '0.1')", () => {
  it('produces version 0.2 from a minimal v1 config', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    }
    const result = migrate(v1)
    expect(result.version).toBe('0.2')
  })

  it('migrates L2 v1 with correct feature flag defaults', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    }
    const result = migrate(v1)
    expect(result.features.debtGates).toBe(true)
    expect(result.features.securityScanning).toBe(true)
    expect(result.features.suppressions).toBe(true)
    expect(result.features.mutationTesting).toBe(true)
    expect(result.features.contractTesting).toBe(false)
    expect(result.features.evidenceHarness).toBe(false)
  })

  it('L1 v1 → all non-suppressions features false', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L1',
      useGitHub: false,
    }
    const result = migrate(v1)
    expect(result.features.debtGates).toBe(false)
    expect(result.features.securityScanning).toBe(false)
    expect(result.features.mutationTesting).toBe(false)
    expect(result.features.evidenceHarness).toBe(false)
    expect(result.features.suppressions).toBe(true)
  })

  it('respects explicit enableDebtGates=false', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      enableDebtGates: false,
    }
    const result = migrate(v1)
    expect(result.features.debtGates).toBe(false)
  })

  // #1594: the migration tool-filter must read the canonical AI_TOOLS set rather
  // than a stale hand-copy. #2367 (ADR-119) narrowed that set to claude+codex, so
  // the same filter now drops a retired tool from a v1 config instead of carrying
  // it forward — the supported tool survives, the retired one is stripped, and the
  // migration never fails (ADR-105 never-brick).
  it.each(['cursor', 'copilot', 'gemini', 'windsurf', 'aider'])(
    'strips retired tool "%s" across v1→v2 while preserving claude',
    (tool) => {
      const v1 = {
        version: '0.1',
        tools: ['claude', tool],
        governanceLevel: 'L2',
        useGitHub: false,
      }
      const result = migrate(v1)
      expect(result.tools).toContain('claude')
      expect(result.tools).not.toContain(tool)
    },
  )

  it('preserves codex across v1→v2 (the canonical set is read, not hand-copied)', () => {
    const result = migrate({
      version: '0.1',
      tools: ['claude', 'codex'],
      governanceLevel: 'L2',
      useGitHub: false,
    })
    expect(result.tools).toEqual(['claude', 'codex'])
  })

  it('v1 contractType grpc → features.contractTesting=true', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: true,
      contractType: 'grpc',
    }
    const result = migrate(v1)
    expect(result.features.contractTesting).toBe(true)
  })

  it('v1 evidenceRetention.enabled=true → features.evidenceHarness=true', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      evidenceRetention: { enabled: true },
    }
    const result = migrate(v1)
    expect(result.features.evidenceHarness).toBe(true)
  })

  it('L3 v1 with no evidenceRetention field → features.evidenceHarness=true', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L3',
      useGitHub: false,
    }
    const result = migrate(v1)
    expect(result.features.evidenceHarness).toBe(true)
  })

  // #1732 Step 3: deriveEvidenceHarness's implicit default hand-rolled
  // `level === 'L3'` — the same bug class as #1720 — so an L4 v1 config with
  // no explicit evidenceRetention silently lost the evidence harness on
  // migration (L4 got LESS than L3, not a superset).
  it('L4 v1 with no evidenceRetention field → features.evidenceHarness=true (#1732)', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L4',
      useGitHub: false,
    }
    const result = migrate(v1)
    expect(result.features.evidenceHarness).toBe(true)
  })

  it('uses DEFAULT_THRESHOLDS for the target governance level', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L3',
      useGitHub: false,
    }
    const result = migrate(v1)
    expect(result.thresholds).toEqual(DEFAULT_THRESHOLDS.L3)
  })

  it('carries persisted fields verbatim (archetype, architectureStyle, etc.)', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      archetype: 'backend-web-db',
      architectureStyle: 'hexagonal',
      isMultiTenant: true,
      hasDatabase: true,
    }
    const result = migrate(v1)
    expect(result.archetype).toBe('backend-web-db')
    expect(result.architectureStyle).toBe('hexagonal')
    expect(result.isMultiTenant).toBe(true)
    expect(result.hasDatabase).toBe(true)
  })

  it('strips v1-only legacy flags (enableDebtGates, enableSecurityScanning)', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      enableDebtGates: true,
      enableSecurityScanning: true,
    }
    const result = migrate(v1) as Record<string, unknown>
    expect(result['enableDebtGates']).toBeUndefined()
    expect(result['enableSecurityScanning']).toBeUndefined()
  })
})

// ── v2 (version: "0.2") — idempotence ───────────────────────────────────────

describe("migrate — v2 (version: '0.2') idempotence", () => {
  it('returns a structurally equal object when given a canonical v2 config', () => {
    const result = migrate(CANONICAL_V2)
    expect(result.version).toBe('0.2')
    expect(result.features).toEqual(CANONICAL_V2.features)
    expect(result.thresholds).toEqual(CANONICAL_V2.thresholds)
    expect(result.governanceLevel).toBe(CANONICAL_V2.governanceLevel)
  })

  it('double-calling migrate on v2 is still identical', () => {
    const once = migrate(CANONICAL_V2)
    const twice = migrate(once as unknown as Record<string, unknown>)
    expect(twice).toEqual(once)
  })

  it('preserves all fields of current arbiter.json without mutation', () => {
    const result = migrate(ARBITER_JSON)
    expect(result.version).toBe('0.2')
    expect(result.governanceLevel).toBe('L2')
    expect(result.permitGitHub).toBe(true)
    expect(result.decomposition?.backend).toBe('github')
    expect(result.features).toEqual(ARBITER_JSON.features)
    expect(result.thresholds).toEqual(ARBITER_JSON.thresholds)
    expect(result.archetype).toBe('library')
    expect(result.lanes).toEqual(['docs'])
    expect(result.invariantTiers).toEqual(['architectural', 'governance', 'data', 'operational'])
  })
})

// ── round-trip identity ──────────────────────────────────────────────────────

describe('migrate — round-trip identity (parse → stringify → parse)', () => {
  it('JSON round-trip of a v2 output is structurally equal to original output', () => {
    const firstPass = migrate(CANONICAL_V2)
    const serialised = JSON.parse(JSON.stringify(firstPass)) as Record<string, unknown>
    const secondPass = migrate(serialised)
    expect(secondPass).toEqual(firstPass)
  })

  it('JSON round-trip of a migrated v1 config is identity', () => {
    const v1 = {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    }
    const firstPass = migrate(v1)
    const serialised = JSON.parse(JSON.stringify(firstPass)) as Record<string, unknown>
    const secondPass = migrate(serialised)
    expect(secondPass).toEqual(firstPass)
  })

  it('JSON round-trip of arbiter.json is identity', () => {
    const firstPass = migrate(ARBITER_JSON)
    const serialised = JSON.parse(JSON.stringify(firstPass)) as Record<string, unknown>
    const secondPass = migrate(serialised)
    expect(secondPass).toEqual(firstPass)
  })
})

// ── error cases ──────────────────────────────────────────────────────────────

describe('migrate — $schemaVersion routing (#605)', () => {
  it('stamps $schemaVersion: 4 on every migrated v2 output', () => {
    const result = migrate(CANONICAL_V2)
    expect(result.$schemaVersion).toBe(4)
  })
  it('stamps $schemaVersion: 4 when migrating v0 (no version field) up the chain', () => {
    const result = migrate({ tools: ['claude'], governanceLevel: 'L2' })
    expect(result.$schemaVersion).toBe(4)
  })
  it('throws hard error when $schemaVersion is greater than current understanding', () => {
    expect(() => migrate({ ...CANONICAL_V2, $schemaVersion: 99 })).toThrow(/understands at most 4/i)
  })
  it('accepts equal $schemaVersion (current)', () => {
    expect(() => migrate({ ...CANONICAL_V2, $schemaVersion: 3 })).not.toThrow()
  })
  it('accepts missing $schemaVersion (back-compat)', () => {
    expect(() => migrate(CANONICAL_V2)).not.toThrow()
  })
  // #1618 — a string future-version must not bypass the ceiling guard and be
  // silently downgraded. Coerce-and-compare so "9" is rejected like numeric 9.
  it('rejects a string future $schemaVersion instead of silently downgrading it', () => {
    expect(() => migrate({ ...CANONICAL_V2, $schemaVersion: '9' })).toThrow(
      /understands at most 4/i,
    )
  })
  it('rejects a non-numeric (corrupt) $schemaVersion', () => {
    expect(() => migrate({ ...CANONICAL_V2, $schemaVersion: 'abc' })).toThrow(
      /understands at most 4/i,
    )
  })
  it('accepts a string current-or-below $schemaVersion (coerced)', () => {
    expect(() => migrate({ ...CANONICAL_V2, $schemaVersion: '3' })).not.toThrow()
  })
})

describe('migrate — error handling', () => {
  it('throws when given a non-object input', () => {
    expect(() => migrate('not-an-object')).toThrow()
  })

  it('throws when given null', () => {
    expect(() => migrate(null)).toThrow()
  })

  // T0 (never-brick, docs/EXECUTION-PLAYBOOK.md §T0): migrate() is a reshape
  // step, not a gate. It used to throw here — before loadConfig's own
  // validate-then-coerce-then-validate fallback ever got a chance to run,
  // bricking every legacy config with so much as one stale field. It now
  // passes the shape through un-normalized (with a WARN) and defers the
  // authoritative validation + coercible-field fallback to loadConfig(),
  // exercised end-to-end in __tests__/config/never-brick-migration.test.ts.
  it('no longer throws on a v0.2 input with a coercible field (tools) — deferred to loadConfig', () => {
    expect(() =>
      migrate({
        version: '0.2',
        tools: 'not-an-array',
        governanceLevel: 'L2',
        useGitHub: false,
        features: {
          contractTesting: false,
          mutationTesting: true,
          securityScanning: true,
          evidenceHarness: false,
          debtGates: true,
          suppressions: true,
        },
        thresholds: DEFAULT_THRESHOLDS.L2,
      }),
    ).not.toThrow()
  })
})
