// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// build-kit.mjs resolves ROOT relative to its own location (scriptDir/..).
// We copy the real script into <tmp>/scripts/ and lay down fixture inputs
// under <tmp>/src/kit and <tmp>/src/compatibility, so ROOT points at the
// hermetic temp repo and the script writes <tmp>/src/kit/derived.json there.
const REAL_SCRIPT = resolve('scripts/build-kit.mjs')
const SCRIPT_SOURCE = readFileSync(REAL_SCRIPT, 'utf-8')

const STACKS = ['java', 'typescript', 'python', 'go', 'rust']

interface Fixture {
  catalog?: unknown
  overlay?: unknown
  matrix?: unknown
  categoryMap?: unknown
  /** Omit a file entirely to exercise the missing-input path. */
  omit?: ('catalog' | 'overlay' | 'matrix' | 'categoryMap')[]
  /** Write raw (possibly malformed) content for a file instead of JSON. */
  raw?: Partial<Record<'catalog' | 'overlay' | 'matrix' | 'categoryMap', string>>
}

function makeRepo(fx: Fixture): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'build-kit-test-'))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'src', 'kit'), { recursive: true })
  mkdirSync(join(root, 'src', 'compatibility'), { recursive: true })

  writeFileSync(join(root, 'scripts', 'build-kit.mjs'), SCRIPT_SOURCE)

  const omit = new Set(fx.omit ?? [])
  const raw = fx.raw ?? {}

  const writeInput = (
    key: 'catalog' | 'overlay' | 'matrix' | 'categoryMap',
    relPath: string,
    value: unknown,
  ): void => {
    if (omit.has(key)) return
    if (raw[key] !== undefined) {
      writeFileSync(join(root, relPath), raw[key] as string)
      return
    }
    writeFileSync(join(root, relPath), JSON.stringify(value, null, 2))
  }

  writeInput('catalog', 'src/kit/catalog.json', fx.catalog ?? [])
  writeInput('overlay', 'src/kit/overlay.json', fx.overlay ?? {})
  writeInput('matrix', 'src/compatibility/cross-language-matrix.json', fx.matrix ?? {})
  writeInput('categoryMap', 'src/kit/category-map.json', fx.categoryMap ?? {})

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function run(root: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [join(root, 'scripts', 'build-kit.mjs')], {
    encoding: 'utf-8',
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// A fixture that exercises all three derivation branches:
//  - D-overlay: id present in overlay → overlay cell used verbatim
//  - D-tool: categoryRef maps to a matrix category with a non-null tool
//  - D-gap: categoryRef maps to a category with no tool for any stack → gap
function validFixture(): Fixture {
  return {
    catalog: [
      { id: 'D-overlay', name: 'overlay dim', categoryRef: 'static_analysis' },
      { id: 'D-tool', name: 'tool dim', categoryRef: 'static_analysis' },
      { id: 'D-gap', name: 'gap dim', categoryRef: 'unmapped_category' },
    ],
    overlay: {
      'D-overlay': {
        java: { kind: 'manual', note: 'overlay wins' },
      },
    },
    matrix: {
      _meta: { ignored: true },
      static_analysis: {
        java: { tool: 'checkstyle', maturity: 'proven' },
        typescript: 'eslint',
        python: 'N/A',
        go: null,
        // rust intentionally absent
      },
    },
    categoryMap: {
      static_analysis: ['static_analysis'],
      // unmapped_category deliberately omitted from the map
    },
  }
}

describe('build-kit.mjs', () => {
  it('exits 0 and derives one entry per catalog dimension with perStack for all 5 stacks', () => {
    const { root, cleanup } = makeRepo(validFixture())
    try {
      const result = run(root)
      expect(result.status).toBe(0)
      // stderr, not stdout: build-kit.mjs runs in the `prepack` lifecycle, so a
      // stdout write here would corrupt any consumer parsing `npm pack --json`'s
      // own stdout (#1770 T8).
      expect(result.stderr).toContain('derived 3 dimensions')

      const derived = JSON.parse(readFileSync(join(root, 'src/kit/derived.json'), 'utf-8'))
      expect(Array.isArray(derived)).toBe(true)
      expect(derived).toHaveLength(3)
      for (const dim of derived) {
        expect(dim).toHaveProperty('perStack')
        for (const stack of STACKS) {
          expect(dim.perStack).toHaveProperty(stack)
        }
      }
    } finally {
      cleanup()
    }
  })

  it('uses the overlay cell verbatim when overlay[id][stack] is defined', () => {
    const { root, cleanup } = makeRepo(validFixture())
    try {
      run(root)
      const derived = JSON.parse(readFileSync(join(root, 'src/kit/derived.json'), 'utf-8'))
      const overlayDim = derived.find((d: { id: string }) => d.id === 'D-overlay')
      expect(overlayDim.perStack.java).toEqual({ kind: 'manual', note: 'overlay wins' })
    } finally {
      cleanup()
    }
  })

  it('resolves a matrix tool into {kind:tool, tool, matrixCategory}', () => {
    const { root, cleanup } = makeRepo(validFixture())
    try {
      run(root)
      const derived = JSON.parse(readFileSync(join(root, 'src/kit/derived.json'), 'utf-8'))
      const toolDim = derived.find((d: { id: string }) => d.id === 'D-tool')
      // object-form cell → cell.tool
      expect(toolDim.perStack.java).toEqual({
        kind: 'tool',
        tool: 'checkstyle',
        matrixCategory: 'static_analysis',
      })
      // string-form cell → used directly
      expect(toolDim.perStack.typescript).toEqual({
        kind: 'tool',
        tool: 'eslint',
        matrixCategory: 'static_analysis',
      })
      // 'N/A' and null cells, and an absent stack, all become gaps
      expect(toolDim.perStack.python).toEqual({ kind: 'gap' })
      expect(toolDim.perStack.go).toEqual({ kind: 'gap' })
      expect(toolDim.perStack.rust).toEqual({ kind: 'gap' })
    } finally {
      cleanup()
    }
  })

  it('falls back to {kind:gap} when the categoryRef has no matrix tool', () => {
    const { root, cleanup } = makeRepo(validFixture())
    try {
      run(root)
      const derived = JSON.parse(readFileSync(join(root, 'src/kit/derived.json'), 'utf-8'))
      const gapDim = derived.find((d: { id: string }) => d.id === 'D-gap')
      for (const stack of STACKS) {
        expect(gapDim.perStack[stack]).toEqual({ kind: 'gap' })
      }
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a required input file is missing', () => {
    const { root, cleanup } = makeRepo({ ...validFixture(), omit: ['matrix'] })
    try {
      const result = run(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('cannot read')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a required input file is malformed JSON', () => {
    const { root, cleanup } = makeRepo({
      ...validFixture(),
      raw: { catalog: '{ not valid json' },
    })
    try {
      const result = run(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('cannot read')
    } finally {
      cleanup()
    }
  })
})
