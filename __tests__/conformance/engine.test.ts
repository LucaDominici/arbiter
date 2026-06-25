// SPDX-License-Identifier: Apache-2.0
// TDD red: units 1-5 for #1393 — TS conformance engine.
// All tests fail until src/conformance/engine.ts is created (module not found).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  evaluate,
  checkNoRegress,
  ratchet,
  baselineOf,
  type Verdict,
  type RegistryInput,
  type EngineResult,
} from '../../src/conformance/engine.js'

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'engine-test-'))
  created.push(dir)
  return dir
}

// ── Unit 1: evaluate() core ───────────────────────────────────────────────────

describe('evaluate() — core (#1393 unit 1)', () => {
  it('returns all required EngineResult fields on a minimal registry', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'README.md'), '# Project')
    const registry: RegistryInput = {
      version: '1.0.0',
      checks: [{ id: 'T-01', type: 'file_exists', args: { path: 'README.md' }, weight: 1 }],
    }
    const result = evaluate(registry, new Set<string>(), root)

    expect(result).toHaveProperty('registryVersion', '1.0.0')
    expect(result).toHaveProperty('score')
    expect(typeof result.score).toBe('number')
    expect(result).toHaveProperty('yCount')
    expect(result).toHaveProperty('riskyCount')
    expect(result).toHaveProperty('totals')
    expect(result.totals).toHaveProperty('checks')
    expect(result.totals).toHaveProperty('y')
    expect(result.totals).toHaveProperty('p')
    expect(result.totals).toHaveProperty('n')
    expect(result.totals).toHaveProperty('na')
    expect(result.totals).toHaveProperty('nv')
    expect(result).toHaveProperty('dimensions')
    expect(result).toHaveProperty('checks')
    expect(Array.isArray(result.checks)).toBe(true)
  })

  it('file_exists returns Y when file is present', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'README.md'), '# Project')
    const registry: RegistryInput = {
      checks: [{ id: 'T-01', type: 'file_exists', args: { path: 'README.md' } }],
    }
    const result = evaluate(registry, new Set<string>(), root)

    expect(result.checks[0]?.verdict).toBe('Y')
    expect(result.checks[0]?.evidence?.file).toBe('README.md')
  })

  it('file_exists returns N when file is absent', () => {
    const root = tmpDir()
    const registry: RegistryInput = {
      checks: [{ id: 'T-01', type: 'file_exists', args: { path: 'MISSING.md' } }],
    }
    const result = evaluate(registry, new Set<string>(), root)

    expect(result.checks[0]?.verdict).toBe('N')
    // N carries evidence pointing at the missing path (drives the "what's missing" gap report).
    expect(result.checks[0]?.evidence?.file).toBe('MISSING.md')
    expect(result.checks[0]?.evidence?.detail).toBe('missing')
  })

  it('file_contains returns Y when pattern is found', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'config.ts'), 'export const VERSION = "1.0.0"')
    const registry: RegistryInput = {
      checks: [
        {
          id: 'T-01',
          type: 'file_contains',
          args: { path: 'config.ts', pattern: 'VERSION' },
        },
      ],
    }
    const result = evaluate(registry, new Set<string>(), root)

    expect(result.checks[0]?.verdict).toBe('Y')
    expect(result.checks[0]?.evidence?.line).toBeGreaterThan(0)
  })

  it('count_matches returns Y when count >= min', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'file.ts'), 'test("a", () => {})\ntest("b", () => {})')
    const registry: RegistryInput = {
      checks: [
        {
          id: 'T-01',
          type: 'count_matches',
          args: { path: 'file.ts', pattern: 'test(', min: 2 },
        },
      ],
    }
    const result = evaluate(registry, new Set<string>(), root)

    expect(result.checks[0]?.verdict).toBe('Y')
  })

  it('checks are sorted by id (localeCompare determinism)', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'a.txt'), 'content')
    const registry: RegistryInput = {
      checks: [
        { id: 'Z-03', type: 'file_exists', args: { path: 'a.txt' } },
        { id: 'A-01', type: 'file_exists', args: { path: 'a.txt' } },
        { id: 'M-02', type: 'file_exists', args: { path: 'a.txt' } },
      ],
    }
    const result = evaluate(registry, new Set<string>(), root)

    expect(result.checks.map((c) => c.id)).toEqual(['A-01', 'M-02', 'Z-03'])
  })

  it('score is 0 when all checks are NA (no applicable)', () => {
    const root = tmpDir()
    const registry: RegistryInput = {
      checks: [{ id: 'T-01', type: 'manual' }],
    }
    const result = evaluate(registry, new Set<string>(), root)

    expect(result.score).toBe(0)
    expect(result.totals.nv).toBe(1)
  })

  it('unknown check type returns N (fail-closed, not NV)', () => {
    const root = tmpDir()
    const registry: RegistryInput = {
      checks: [{ id: 'T-01', type: 'future_unknown_type_xyz' }],
    }
    const result = evaluate(registry, new Set<string>(), root)

    expect(result.checks[0]?.verdict).toBe('N')
  })
})

// ── Unit 2: applies_if overlay ────────────────────────────────────────────────

describe('applies_if overlay → NA (#1393 unit 2)', () => {
  it('check with applies_if matching an overlay returns original verdict', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'README.md'), '# x')
    const registry: RegistryInput = {
      checks: [
        {
          id: 'T-01',
          type: 'file_exists',
          args: { path: 'README.md' },
          applies_if: 'frontend',
        },
      ],
    }
    const result = evaluate(registry, new Set<string>(['frontend']), root)

    expect(result.checks[0]?.verdict).toBe('Y')
  })

  it('check with applies_if NOT matching any overlay returns NA', () => {
    const root = tmpDir()
    const registry: RegistryInput = {
      checks: [
        {
          id: 'T-01',
          type: 'file_exists',
          args: { path: 'MISSING.md' },
          applies_if: 'frontend',
        },
      ],
    }
    const result = evaluate(registry, new Set<string>(['backend']), root)

    expect(result.checks[0]?.verdict).toBe('NA')
  })

  it('manual check always returns NV', () => {
    const root = tmpDir()
    const registry: RegistryInput = {
      checks: [{ id: 'T-01', type: 'manual' }],
    }
    const result = evaluate(registry, new Set<string>(), root)

    expect(result.checks[0]?.verdict).toBe('NV')
  })
})

// ── Generic applies_if preconditions (G1) ─────────────────────────────────────
// A check may declare an object-form applies_if precondition (file_exists / file_contains /
// count_matches / capability). Unmet ⇒ NA (excluded from the denominator); met ⇒ evaluated.
// FAIL-SAFE: an unknown / missing / malformed precondition ⇒ the check APPLIES (never a silent
// skip, which would be a false-green).

describe('applies_if generic precondition (G1)', () => {
  it('file_exists precondition MET → the check is evaluated (Y)', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'go.mod'), 'module x\n')
    writeFileSync(join(root, 'TARGET.md'), '# t')
    const registry: RegistryInput = {
      checks: [
        {
          id: 'T-01',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'file_exists', path: 'go.mod' },
        },
      ],
    }
    const result = evaluate(registry, new Set<string>(), root)
    expect(result.checks[0]?.verdict).toBe('Y')
  })

  it('file_exists precondition UNMET → NA (excluded from the score)', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'TARGET.md'), '# t')
    const registry: RegistryInput = {
      checks: [
        {
          id: 'T-01',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'file_exists', path: 'go.mod' },
        },
      ],
    }
    const result = evaluate(registry, new Set<string>(), root)
    expect(result.checks[0]?.verdict).toBe('NA')
  })

  it('file_contains precondition MET → evaluated; absent marker file → NA', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'package.json'), '{ "dependencies": { "react": "18" } }\n')
    writeFileSync(join(root, 'TARGET.md'), '# t')
    const reg = (path: string): RegistryInput => ({
      checks: [
        {
          id: 'T-01',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'file_contains', path, pattern: '"react"' },
        },
      ],
    })
    expect(evaluate(reg('package.json'), new Set<string>(), root).checks[0]?.verdict).toBe('Y')
    expect(evaluate(reg('MISSING.json'), new Set<string>(), root).checks[0]?.verdict).toBe('NA')
  })

  it('count_matches precondition: ≥min → evaluated; <min → NA', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'svc.yml'), 'service: a\nservice: b\n')
    writeFileSync(join(root, 'TARGET.md'), '# t')
    const reg = (min: number): RegistryInput => ({
      checks: [
        {
          id: 'T-01',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'count_matches', path: 'svc.yml', pattern: 'service:', min },
        },
      ],
    })
    expect(evaluate(reg(2), new Set<string>(), root).checks[0]?.verdict).toBe('Y')
    expect(evaluate(reg(3), new Set<string>(), root).checks[0]?.verdict).toBe('NA')
  })

  it('capability precondition gates on the overlay set (generalized string form)', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'TARGET.md'), '# t')
    const registry: RegistryInput = {
      checks: [
        {
          id: 'T-01',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'capability', name: 'regulated' },
        },
      ],
    }
    expect(evaluate(registry, new Set<string>(['regulated']), root).checks[0]?.verdict).toBe('Y')
    expect(evaluate(registry, new Set<string>(['frontend']), root).checks[0]?.verdict).toBe('NA')
  })

  it('FAIL-SAFE: a malformed precondition (unknown type) → the check APPLIES (not skipped)', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'TARGET.md'), '# t')
    const registry: RegistryInput = {
      checks: [
        {
          id: 'T-01',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'totally_unknown_kind' } as never,
        },
      ],
    }
    const result = evaluate(registry, new Set<string>(), root)
    expect(result.checks[0]?.verdict).toBe('Y') // evaluated, NOT silently NA
  })

  it('FAIL-SAFE: a precondition missing its required path → the check APPLIES', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'TARGET.md'), '# t')
    const registry: RegistryInput = {
      checks: [
        {
          id: 'T-01',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'file_exists' } as never, // no path ⇒ uninterpretable ⇒ APPLIES
        },
      ],
    }
    const result = evaluate(registry, new Set<string>(), root)
    expect(result.checks[0]?.verdict).toBe('Y')
  })

  it('the legacy string overlay form still gates correctly', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'TARGET.md'), '# t')
    const registry: RegistryInput = {
      checks: [
        { id: 'T-01', type: 'file_exists', args: { path: 'TARGET.md' }, applies_if: 'frontend' },
      ],
    }
    expect(evaluate(registry, new Set<string>(['frontend']), root).checks[0]?.verdict).toBe('Y')
    expect(evaluate(registry, new Set<string>(), root).checks[0]?.verdict).toBe('NA')
  })
})

// ── Unit 3: checkNoRegress() ──────────────────────────────────────────────────

describe('checkNoRegress() (#1393 unit 3)', () => {
  it('returns ok=true when score and yCount are unchanged', () => {
    const baseline = { score: 80, yCount: 4 }
    const current: EngineResult = {
      registryVersion: '1',
      score: 80,
      yCount: 4,
      riskyCount: 0,
      totals: { checks: 5, y: 4, p: 0, n: 1, na: 0, nv: 0 },
      dimensions: {},
      checks: [],
    }
    const result = checkNoRegress(current, baseline)

    expect(result.ok).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it('returns ok=false when score drops below baseline', () => {
    const baseline = { score: 90, yCount: 5 }
    const current: EngineResult = {
      registryVersion: '1',
      score: 80,
      yCount: 4,
      riskyCount: 0,
      totals: { checks: 5, y: 4, p: 0, n: 1, na: 0, nv: 0 },
      dimensions: {},
      checks: [],
    }
    const result = checkNoRegress(current, baseline)

    expect(result.ok).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('returns ok=false when yCount drops below baseline', () => {
    const baseline = { score: 80, yCount: 5 }
    const current: EngineResult = {
      registryVersion: '1',
      score: 80,
      yCount: 4,
      riskyCount: 0,
      totals: { checks: 5, y: 4, p: 0, n: 1, na: 0, nv: 0 },
      dimensions: {},
      checks: [],
    }
    const result = checkNoRegress(current, baseline)

    expect(result.ok).toBe(false)
  })
})

// ── Unit 4: ratchet() ─────────────────────────────────────────────────────────

describe('ratchet() — monotonic max (#1393 unit 4)', () => {
  it('keeps baseline score when current score is lower', () => {
    const baseline = { score: 90, yCount: 5, dimensions: {} }
    const current: EngineResult = {
      registryVersion: '1',
      score: 80,
      yCount: 4,
      riskyCount: 0,
      totals: { checks: 5, y: 4, p: 0, n: 1, na: 0, nv: 0 },
      dimensions: {},
      checks: [],
    }
    const result = ratchet(current, baseline)

    expect(result.score).toBe(90)
    expect(result.yCount).toBe(5)
  })

  it('updates score when current score is higher', () => {
    const baseline = { score: 70, yCount: 3, dimensions: {} }
    const current: EngineResult = {
      registryVersion: '1',
      score: 80,
      yCount: 5,
      riskyCount: 0,
      totals: { checks: 5, y: 5, p: 0, n: 0, na: 0, nv: 0 },
      dimensions: {},
      checks: [],
    }
    const result = ratchet(current, baseline)

    expect(result.score).toBe(80)
    expect(result.yCount).toBe(5)
  })
})

// ── Unit 5: baselineOf() ──────────────────────────────────────────────────────

describe('baselineOf() (#1393 unit 5)', () => {
  it('extracts {score, yCount, dimensions} from EngineResult', () => {
    const current: EngineResult = {
      registryVersion: '1',
      score: 75,
      yCount: 3,
      riskyCount: 1,
      totals: { checks: 4, y: 3, p: 0, n: 1, na: 0, nv: 0 },
      dimensions: { 'D-DOCS': { score: 100, y: 2 } },
      checks: [],
    }
    const baseline = baselineOf(current)

    expect(baseline).toHaveProperty('score', 75)
    expect(baseline).toHaveProperty('yCount', 3)
    expect(baseline).toHaveProperty('dimensions')
    expect(baseline.dimensions['D-DOCS']).toEqual({ score: 100, y: 2 })
    expect(baseline).not.toHaveProperty('registryVersion')
    expect(baseline).not.toHaveProperty('checks')
    expect(baseline).not.toHaveProperty('totals')
  })
})

// ── Edge cases: safeResolve guards ────────────────────────────────────────────

describe('safeResolve path traversal guards', () => {
  it('null-byte in path does not throw and does not Y', () => {
    const root = tmpDir()
    const registry: RegistryInput = {
      checks: [{ id: 'T-01', type: 'file_exists', args: { path: 'foo\x00etc/passwd' } }],
    }
    expect(() => evaluate(registry, new Set<string>(), root)).not.toThrow()
    const result = evaluate(registry, new Set<string>(), root)
    expect(result.checks[0]?.verdict).toBe('N')
  })

  it('directory path returns N for file_exists (not false-Y)', () => {
    const root = tmpDir()
    const sub = join(root, 'subdir')
    mkdirSync(sub)
    const registry: RegistryInput = {
      checks: [{ id: 'T-01', type: 'file_exists', args: { path: 'subdir' } }],
    }
    const result = evaluate(registry, new Set<string>(), root)
    expect(result.checks[0]?.verdict).toBe('N')
  })
})

// ── Edge cases: count_matches ─────────────────────────────────────────────────

describe('count_matches edge cases', () => {
  it('empty pattern returns N (not infinite loop)', () => {
    const root = tmpDir()
    writeFileSync(join(root, 'file.txt'), 'content')
    const registry: RegistryInput = {
      checks: [
        {
          id: 'T-01',
          type: 'count_matches',
          args: { path: 'file.txt', pattern: '', min: 1 },
        },
      ],
    }
    const result = evaluate(registry, new Set<string>(), root)
    expect(result.checks[0]?.verdict).toBe('N')
  })
})

// ── Fail-closed contract ──────────────────────────────────────────────────────

describe('evaluate() fail-closed contract', () => {
  it('does not throw on malformed registry (missing checks array)', () => {
    const root = tmpDir()
    const registry = {} as RegistryInput
    expect(() => evaluate(registry, new Set<string>(), root)).not.toThrow()
  })

  it('returns zero-score payload when checks is undefined', () => {
    const root = tmpDir()
    const result = evaluate({}, new Set<string>(), root)
    expect(result.score).toBe(0)
    expect(result.checks).toHaveLength(0)
  })
})

// ── Unused import guard (keeps linter happy; Verdict type is used above) ──────
const _verdictTypeGuard: Verdict = 'Y'
void _verdictTypeGuard
