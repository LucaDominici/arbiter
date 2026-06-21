// SPDX-License-Identifier: Apache-2.0
// Branch-coverage climb for src/commands/kit.ts (#1486).
// Targets the uncovered conditionals: every filter branch in runKitList, the
// optional-field guards in runKitExplain, all five cell kinds in
// describeCellKind, the not-found / success paths of show & explain, the
// schema-ERROR / parity-FAIL / redaction-FAIL severity ladder of the validate &
// gate functions, the checkFieldParity / checkEnforcement permutations, and the
// success / prune / skip / protected / error branches of runKitGenerate.
//
// Branches unreachable from the live derived.json (na-by-archetype cells, a
// generatorLink field, missing-file / parse-error throws in loadDerived) are
// driven by injecting a stub kit through vi.doMock of node:fs + the schema /
// generator / redaction collaborators, then importing kit.js fresh.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DerivedKit, DerivedKitDim } from '../../src/kit/schema.js'

// ─── Shared output capture ────────────────────────────────────────────────────

interface Captured {
  stdout: string
  stderr: string
  exitCode: number | undefined
}

function captureStreams(): {
  cap: Captured
  restore: () => void
} {
  const cap: Captured = { stdout: '', stderr: '', exitCode: undefined }
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
    cap.stdout += String(chunk)
    return true
  })
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown): boolean => {
    cap.stderr += String(chunk)
    return true
  })
  const exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation(((code?: string | number | null): never => {
      cap.exitCode = Number(code)
      throw new Error(`exit:${String(code)}`)
    }) as never)
  return {
    cap,
    restore: (): void => {
      outSpy.mockRestore()
      errSpy.mockRestore()
      exitSpy.mockRestore()
    },
  }
}

// ─── Group 1: live-data branches (no module mocking) ──────────────────────────

describe('runKitList — filter / format branches (live data)', () => {
  let ctx: ReturnType<typeof captureStreams>

  beforeEach(() => {
    ctx = captureStreams()
  })
  afterEach(() => {
    ctx.restore()
    vi.restoreAllMocks()
  })

  it('filter=covered keeps only covered dims', async () => {
    const { runKitList } = await import('../../src/commands/kit.js')
    runKitList({ format: 'json', filter: 'covered' })
    const parsed = JSON.parse(ctx.cap.stdout) as Array<{ status: string }>
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed.every((d) => d.status === 'covered')).toBe(true)
  })

  it('filter=partial keeps only partial dims', async () => {
    const { runKitList } = await import('../../src/commands/kit.js')
    runKitList({ format: 'json', filter: 'partial' })
    const parsed = JSON.parse(ctx.cap.stdout) as Array<{ status: string }>
    expect(parsed.every((d) => d.status === 'partial')).toBe(true)
  })

  it('filter=missing keeps missing and missing-tracked dims', async () => {
    const { runKitList } = await import('../../src/commands/kit.js')
    runKitList({ format: 'json', filter: 'missing' })
    const parsed = JSON.parse(ctx.cap.stdout) as Array<{ status: string }>
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed.every((d) => d.status === 'missing' || d.status === 'missing-tracked')).toBe(true)
  })

  it('filter=all is a no-op (returns true branch) and keeps every dim', async () => {
    const { runKitList } = await import('../../src/commands/kit.js')
    runKitList({ format: 'json', filter: 'all' })
    const parsed = JSON.parse(ctx.cap.stdout) as unknown[]
    expect(parsed.length).toBe(78)
  })

  it('an unrecognized filter value falls through every branch to the trailing return true', async () => {
    const { runKitList } = await import('../../src/commands/kit.js')
    // Cast through unknown: exercises the final `return true` guard when no
    // filter clause matches, without weakening the public type.
    runKitList({ format: 'json', filter: 'bogus' as unknown as 'all' })
    const parsed = JSON.parse(ctx.cap.stdout) as unknown[]
    expect(parsed.length).toBe(78)
  })

  it('tml filter narrows to the requested tier', async () => {
    const { runKitList } = await import('../../src/commands/kit.js')
    runKitList({ format: 'json', tml: 'L2' })
    const parsed = JSON.parse(ctx.cap.stdout) as Array<{ tml: string }>
    expect(parsed.every((d) => d.tml === 'L2')).toBe(true)
  })

  it('stack filter drops dims whose chosen stack is a gap', async () => {
    const { runKitList } = await import('../../src/commands/kit.js')
    runKitList({ format: 'json', stack: 'rust' })
    const parsed = JSON.parse(ctx.cap.stdout) as Array<{
      perStack: Record<string, { kind: string }>
    }>
    expect(parsed.every((d) => d.perStack['rust']?.kind !== 'gap')).toBe(true)
  })

  it('format=table (default) writes header, divider, and total footer', async () => {
    const { runKitList } = await import('../../src/commands/kit.js')
    runKitList({})
    expect(ctx.cap.stdout).toContain('TML')
    expect(ctx.cap.stdout).toContain('Status')
    expect(ctx.cap.stdout).toMatch(/Total: \d+ dimensions/)
  })

  it('format=csv writes the CSV serialization', async () => {
    const { runKitList } = await import('../../src/commands/kit.js')
    runKitList({ format: 'csv' })
    expect(ctx.cap.stdout).toContain('id')
    expect(ctx.cap.stdout).toContain('\r\n')
  })
})

describe('runKitShow / runKitExplain — found vs not-found (live data)', () => {
  let ctx: ReturnType<typeof captureStreams>

  beforeEach(() => {
    ctx = captureStreams()
  })
  afterEach(() => {
    ctx.restore()
    vi.restoreAllMocks()
  })

  it('show writes the dim JSON when the id exists', async () => {
    const { runKitShow } = await import('../../src/commands/kit.js')
    runKitShow('N01')
    const parsed = JSON.parse(ctx.cap.stdout) as { id: string }
    expect(parsed.id).toBe('N01')
    expect(ctx.cap.exitCode).toBeUndefined()
  })

  it('show writes to stderr and exits 1 for an unknown id', async () => {
    const { runKitShow } = await import('../../src/commands/kit.js')
    expect(() => runKitShow('N99')).toThrow('exit:1')
    expect(ctx.cap.stderr).toContain('not found')
    expect(ctx.cap.exitCode).toBe(1)
  })

  it('explain exits 1 for an unknown id', async () => {
    const { runKitExplain } = await import('../../src/commands/kit.js')
    expect(() => runKitExplain('N99')).toThrow('exit:1')
    expect(ctx.cap.stderr).toContain('kit explain')
    expect(ctx.cap.exitCode).toBe(1)
  })

  it('explain on N01 emits the note + invariant optional sections', async () => {
    const { runKitExplain } = await import('../../src/commands/kit.js')
    runKitExplain('N01') // N01 has note + invLink in live data
    expect(ctx.cap.stdout).toContain('=== N01:')
    expect(ctx.cap.stdout).toContain('Invariant:')
    expect(ctx.cap.stdout).toContain('Per-stack projection')
  })

  it('explain on N08 emits the conditional-flag + follow-up optional sections', async () => {
    const { runKitExplain } = await import('../../src/commands/kit.js')
    runKitExplain('N08') // N08 has conditionalFlag + followupIssue in live data
    expect(ctx.cap.stdout).toContain('Conditional: --')
    expect(ctx.cap.stdout).toContain('Follow-up: #')
  })

  it('explain on a dim lacking invLink/generatorLink/conditionalFlag/followupIssue skips those sections', async () => {
    const { runKitExplain } = await import('../../src/commands/kit.js')
    runKitExplain('N03') // live data: has note, but no invLink/gen/conditional/follow-up
    const out = ctx.cap.stdout
    expect(out).toContain('=== N03:')
    expect(out).not.toContain('\nInvariant:')
    expect(out).not.toContain('Generator:')
    expect(out).not.toContain('Conditional: --')
    expect(out).not.toContain('Follow-up: #')
  })
})

describe('runKitValidate / enforceKitGate — clean live state', () => {
  let ctx: ReturnType<typeof captureStreams>

  beforeEach(() => {
    ctx = captureStreams()
  })
  afterEach(() => {
    ctx.restore()
    vi.restoreAllMocks()
  })

  it('validate exits 0 and reports OK for the live catalog', async () => {
    const { runKitValidate } = await import('../../src/commands/kit.js')
    expect(() => runKitValidate()).toThrow('exit:0')
    expect(ctx.cap.stdout).toContain('[arbiter kit validate] OK')
    expect(ctx.cap.exitCode).toBe(0)
  })

  it('gate returns 0 and writes nothing for the live catalog', async () => {
    const { enforceKitGate } = await import('../../src/commands/kit.js')
    expect(enforceKitGate()).toBe(0)
    expect(ctx.cap.stderr).toBe('')
  })
})

// ─── Group 2: injected-data branches (module mocking) ─────────────────────────
//
// loadDerived reads src/kit/derived.json via node:fs and validates it through
// DerivedKitSchema.parse. By mocking node:fs we drive loadDerived's
// missing-file / parse-error throws and inject a synthetic kit that contains the
// cell kinds + optional fields absent from the live data.

function fakeDim(over: Partial<DerivedKitDim> = {}): DerivedKitDim {
  return {
    id: 'N01',
    name: 'Synthetic',
    tml: 'L1',
    gate: 'BLOCKING',
    categoryRef: 'cat',
    archetypeGating: { applies: [], excludes: [] },
    status: 'covered',
    perStack: {
      java: { kind: 'tool', tool: 'junit5', matrixCategory: 'test' },
      typescript: { kind: 'equivalent', arbiterSlot: 'slot', reason: 'r'.repeat(40) },
      python: { kind: 'na-by-archetype', archetypes: ['cli', 'lib'], reason: 'r'.repeat(40) },
      go: { kind: 'na-by-paradigm', reason: 'r'.repeat(40) },
      rust: { kind: 'gap' },
    },
    ...over,
  } as DerivedKitDim
}

describe('loadDerived — failure branches (mocked node:fs)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('node:fs')
  })

  it('throws a build-kit hint when derived.json is missing', async () => {
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        existsSync: (p: string): boolean =>
          p.endsWith('derived.json') ? false : actual.existsSync(p),
      }
    })
    const { runKitList } = await import('../../src/commands/kit.js')
    expect(() => runKitList({ format: 'json' })).toThrow(/derived\.json not found/)
  })

  it('throws a stale-data hint when derived.json fails to parse', async () => {
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        existsSync: (): boolean => true,
        readFileSync: ((p: string, enc?: unknown): string => {
          if (typeof p === 'string' && p.endsWith('derived.json')) return '{ not json'
          return actual.readFileSync(p, enc as BufferEncoding)
        }) as typeof actual.readFileSync,
      }
    })
    const { runKitShow } = await import('../../src/commands/kit.js')
    expect(() => runKitShow('N01')).toThrow(/stale or invalid/)
  })
})

describe('describeCellKind via runKitExplain — all five cell kinds + generatorLink', () => {
  let ctx: ReturnType<typeof captureStreams>

  beforeEach(() => {
    ctx = captureStreams()
  })
  afterEach(() => {
    ctx.restore()
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('node:fs')
    vi.doUnmock('../../src/kit/schema.js')
  })

  it('renders tool / equivalent / na-by-archetype / na-by-paradigm / gap and the generatorLink line', async () => {
    const injected: DerivedKit = [
      fakeDim({
        id: 'N02',
        name: 'AllKinds',
        note: 'a synthetic note',
        invLink: 'INV-99',
        generatorLink: 'src/generators/foo.ts',
        conditionalFlag: 'enableFoo',
        followupIssue: 1234,
      }),
    ]
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        existsSync: (): boolean => true,
        readFileSync: ((p: string, enc?: unknown): string => {
          if (typeof p === 'string' && p.endsWith('derived.json')) return JSON.stringify(injected)
          return actual.readFileSync(p, enc as BufferEncoding)
        }) as typeof actual.readFileSync,
      }
    })
    vi.doMock('../../src/kit/schema.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/kit/schema.js')>()
      return { ...actual, DerivedKitSchema: { parse: (v: unknown): unknown => v } }
    })
    const { runKitExplain } = await import('../../src/commands/kit.js')
    runKitExplain('N02')
    const out = ctx.cap.stdout
    expect(out).toContain('tool: junit5 (via test)')
    expect(out).toContain('equivalent: slot')
    expect(out).toContain('N/A by archetype (cli, lib)')
    expect(out).toContain('N/A by paradigm')
    expect(out).toContain('gap')
    expect(out).toContain('Generator: src/generators/foo.ts')
    expect(out).toContain('Conditional: --enableFoo')
    expect(out).toContain('Follow-up: #1234')
    expect(out).toContain('a synthetic note')
  })
})

// ─── Group 3: validation severity ladder (mocked collaborators) ───────────────

describe('computeKitValidation — schema ERROR branch', () => {
  let ctx: ReturnType<typeof captureStreams>

  beforeEach(() => {
    ctx = captureStreams()
  })
  afterEach(() => {
    ctx.restore()
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('../../src/kit/schema.js')
  })

  it('validate exits 2 and reports a schema ERROR when the catalog fails parse', async () => {
    vi.resetModules()
    vi.doMock('../../src/kit/schema.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/kit/schema.js')>()
      return {
        ...actual,
        KitCatalogSchema: {
          parse: (): never => {
            throw new Error('synthetic schema break')
          },
        },
      }
    })
    const { runKitValidate } = await import('../../src/commands/kit.js')
    expect(() => runKitValidate()).toThrow('exit:2')
    expect(ctx.cap.stderr).toContain('schema ERROR')
    expect(ctx.cap.exitCode).toBe(2)
  })

  it('gate returns 2 and surfaces the schema ERROR on stderr (skips parity since catalog is null)', async () => {
    vi.resetModules()
    vi.doMock('../../src/kit/schema.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/kit/schema.js')>()
      return {
        ...actual,
        KitCatalogSchema: {
          parse: (): never => {
            // Non-Error throw to exercise the String(err) branch.
            throw 'plain-string-failure'
          },
        },
      }
    })
    const { enforceKitGate } = await import('../../src/commands/kit.js')
    expect(enforceKitGate()).toBe(2)
    expect(ctx.cap.stderr).toContain('schema ERROR')
    expect(ctx.cap.stderr).toContain('plain-string-failure')
    expect(ctx.cap.stderr).toContain('gate blocked')
  })
})

describe('computeKitValidation — redaction FAIL and redaction ERROR branches', () => {
  let ctx: ReturnType<typeof captureStreams>

  beforeEach(() => {
    ctx = captureStreams()
  })
  afterEach(() => {
    ctx.restore()
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('../../src/kit/redaction.js')
  })

  it('validate exits 1 and lists the leaked token when the scanner reports a match', async () => {
    vi.resetModules()
    vi.doMock('../../src/kit/redaction.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/kit/redaction.js')>()
      return {
        ...actual,
        scanForRedactedTokens: (): Array<{
          line: number
          token: string
          lineContent: string
        }> => [{ line: 7, token: 'SECRET', lineContent: '  leak here  ' }],
      }
    })
    const { runKitValidate } = await import('../../src/commands/kit.js')
    expect(() => runKitValidate()).toThrow('exit:1')
    expect(ctx.cap.stdout).toContain('[INV-85] redaction FAIL')
    expect(ctx.cap.stdout).toContain('line 7 [SECRET]')
    expect(ctx.cap.exitCode).toBe(1)
  })

  it('validate exits 2 when the redaction subcheck itself throws', async () => {
    vi.resetModules()
    vi.doMock('../../src/kit/redaction.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/kit/redaction.js')>()
      return {
        ...actual,
        scanForRedactedTokens: (): never => {
          throw new Error('scanner blew up')
        },
      }
    })
    const { runKitValidate } = await import('../../src/commands/kit.js')
    expect(() => runKitValidate()).toThrow('exit:2')
    expect(ctx.cap.stderr).toContain('redaction ERROR')
    expect(ctx.cap.stderr).toContain('scanner blew up')
    expect(ctx.cap.exitCode).toBe(2)
  })
})

describe('computeKitValidation — parity FAIL and parity ERROR branches', () => {
  let ctx: ReturnType<typeof captureStreams>

  beforeEach(() => {
    ctx = captureStreams()
  })
  afterEach(() => {
    ctx.restore()
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('node:fs')
  })

  it('validate exits 1 and prints parity FAIL lines when the mapping diverges from the catalog', async () => {
    // Replace only the mapping JSON read with a deliberately broken mapping so
    // runParityCheck accumulates fails (missing canonical_id, duplicate, unknown
    // id, field mismatches, BLOCKING-without-enforcement, and catalog-missing).
    const brokenMapping = {
      dimensions: [
        { id: 1 }, // missing canonical_id -> push
        {
          canonical_id: 'N01',
          name: 'Wrong Name',
          tml_source: 'L9',
          gate_type: 'NONBLOCKING',
          disposition: 'open',
        }, // field mismatches + (if BLOCKING) enforcement fail
        { canonical_id: 'N01' }, // duplicate canonical_id -> push
        { canonical_id: 'ZZZ' }, // not in catalog -> push
      ],
    }
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        readFileSync: ((p: string, enc?: unknown): string => {
          if (typeof p === 'string' && p.endsWith('kit-canonical-mapping.json')) {
            return JSON.stringify(brokenMapping)
          }
          return actual.readFileSync(p, enc as BufferEncoding) as string
        }) as typeof actual.readFileSync,
      }
    })
    const { runKitValidate } = await import('../../src/commands/kit.js')
    expect(() => runKitValidate()).toThrow('exit:1')
    expect(ctx.cap.stdout).toContain('[INV-86] kit catalog parity FAIL')
    expect(ctx.cap.stdout).toContain('missing canonical_id')
    expect(ctx.cap.stdout).toContain('duplicate canonical_id N01')
    expect(ctx.cap.stdout).toContain('not in catalog')
    expect(ctx.cap.exitCode).toBe(1)
  })

  it('validate exits 2 when the mapping file cannot be read (parity ERROR)', async () => {
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        readFileSync: ((p: string, enc?: unknown): string => {
          if (typeof p === 'string' && p.endsWith('kit-canonical-mapping.json')) {
            throw new Error('mapping unreadable')
          }
          return actual.readFileSync(p, enc as BufferEncoding) as string
        }) as typeof actual.readFileSync,
      }
    })
    const { runKitValidate } = await import('../../src/commands/kit.js')
    expect(() => runKitValidate()).toThrow('exit:2')
    expect(ctx.cap.stderr).toContain('parity ERROR')
    expect(ctx.cap.stderr).toContain('mapping unreadable')
    expect(ctx.cap.exitCode).toBe(2)
  })
})

describe('checkEnforcement — exemption acceptance branch (mocked mapping)', () => {
  let ctx: ReturnType<typeof captureStreams>

  beforeEach(() => {
    ctx = captureStreams()
  })
  afterEach(() => {
    ctx.restore()
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('node:fs')
  })

  it('a BLOCKING dim with no enforcement but a valid wave exemption is accepted (parity passes that dim)', async () => {
    // Build a mapping that mirrors the live catalog field-for-field for one
    // BLOCKING dim but carries no invariant/framework_realization — only an
    // adopt-framework disposition in an accepted wave. checkEnforcement returns
    // null, so no enforcement fail is pushed for it. We assert the specific
    // enforcement-fail string is absent while other dims still drive a FAIL.
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const root = resolve(fileURLToPath(import.meta.url), '../../..')
    const catalog = JSON.parse(
      readFileSync(resolve(root, 'src/kit/catalog.json'), 'utf-8'),
    ) as Array<{ id: string; name: string; tml: string; gate: string }>
    const blocking = catalog.find((c) => c.gate === 'BLOCKING')
    expect(blocking).toBeDefined()
    const b = blocking as { id: string; name: string; tml: string; gate: string }
    const mapping = {
      dimensions: [
        {
          canonical_id: b.id,
          name: b.name,
          tml_source: b.tml,
          gate_type: b.gate,
          disposition: 'adopt-framework',
          implementing_wave: 'W5', // in VALIDATE_ACCEPTED_WAVES
        },
      ],
    }
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        readFileSync: ((p: string, enc?: unknown): string => {
          if (typeof p === 'string' && p.endsWith('kit-canonical-mapping.json')) {
            return JSON.stringify(mapping)
          }
          return actual.readFileSync(p, enc as BufferEncoding) as string
        }) as typeof actual.readFileSync,
      }
    })
    const { runKitValidate } = await import('../../src/commands/kit.js')
    // Other catalog ids are missing from this single-entry mapping, so overall
    // it still FAILs (exit 1) — but the exempted dim must NOT carry the
    // "BLOCKING with no enforcement" message.
    expect(() => runKitValidate()).toThrow('exit:1')
    expect(ctx.cap.stdout).not.toContain(`${b.id} BLOCKING with no enforcement`)
    expect(ctx.cap.stdout).toContain(`missing from mapping`)
  })
})

// ─── Group 4: runKitGenerate branches (mocked generator) ──────────────────────

describe('runKitGenerate — success / prune / skip / protected / error', () => {
  let ctx: ReturnType<typeof captureStreams>

  beforeEach(() => {
    ctx = captureStreams()
  })
  afterEach(() => {
    ctx.restore()
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('../../src/generators/kit.js')
  })

  interface GenResult {
    written: string[]
    skipped: string[]
    pruned: string[]
    pruneProtected: string[]
  }

  async function withGenerate(
    result: GenResult,
    capturedOpts: { value?: unknown },
  ): Promise<typeof import('../../src/commands/kit.js')> {
    vi.resetModules()
    vi.doMock('../../src/generators/kit.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/generators/kit.js')>()
      return {
        ...actual,
        generateKitDocs: (opts: unknown): GenResult => {
          capturedOpts.value = opts
          return result
        },
      }
    })
    return import('../../src/commands/kit.js')
  }

  it('default out dir is used and force/prune are omitted when not requested', async () => {
    const captured: { value?: unknown } = {}
    const { runKitGenerate } = await withGenerate(
      { written: ['a.md'], skipped: [], pruned: [], pruneProtected: [] },
      captured,
    )
    runKitGenerate({})
    expect((captured.value as { outDir: string }).outDir).toBe('docs/REFERENCE')
    expect((captured.value as Record<string, unknown>).force).toBeUndefined()
    expect((captured.value as Record<string, unknown>).prune).toBeUndefined()
    expect(ctx.cap.stdout).toContain('written=1 skipped=0')
    expect(ctx.cap.stdout).not.toContain('pruned=')
  })

  it('force + prune flags are forwarded and the prune summary is printed', async () => {
    const captured: { value?: unknown } = {}
    const { runKitGenerate } = await withGenerate(
      {
        written: ['a.md'],
        skipped: ['b.md'],
        pruned: ['c.md'],
        pruneProtected: ['d.md'],
      },
      captured,
    )
    runKitGenerate({ out: 'custom/dir', force: true, prune: true })
    const opts = captured.value as { outDir: string; force?: boolean; prune?: boolean }
    expect(opts.outDir).toBe('custom/dir')
    expect(opts.force).toBe(true)
    expect(opts.prune).toBe(true)
    const out = ctx.cap.stdout
    expect(out).toContain('pruned=1 protected=1')
    expect(out).toContain('[skip] b.md')
    expect(out).toContain('[protected] d.md')
  })

  it('exits 2 and reports an error when generateKitDocs throws', async () => {
    vi.resetModules()
    vi.doMock('../../src/generators/kit.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/generators/kit.js')>()
      return {
        ...actual,
        generateKitDocs: (): never => {
          throw new Error('generation failed')
        },
      }
    })
    const { runKitGenerate } = await import('../../src/commands/kit.js')
    expect(() => runKitGenerate({})).toThrow('exit:2')
    expect(ctx.cap.stderr).toContain('[arbiter kit generate] ERROR: generation failed')
    expect(ctx.cap.exitCode).toBe(2)
  })

  it('error path stringifies a non-Error throw', async () => {
    vi.resetModules()
    vi.doMock('../../src/generators/kit.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/generators/kit.js')>()
      return {
        ...actual,
        generateKitDocs: (): never => {
          throw 'string failure'
        },
      }
    })
    const { runKitGenerate } = await import('../../src/commands/kit.js')
    expect(() => runKitGenerate({})).toThrow('exit:2')
    expect(ctx.cap.stderr).toContain('string failure')
  })
})
