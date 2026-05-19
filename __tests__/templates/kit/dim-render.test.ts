// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { DerivedKitSchema, type DerivedKitDim } from '../../../src/kit/schema.js'

const ROOT = resolve('.')

const STACKS = ['java', 'typescript', 'python', 'go', 'rust'] as const

let derived: DerivedKitDim[]

beforeAll(() => {
  derived = DerivedKitSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'src/kit/derived.json'), 'utf-8')),
  )
})

function describeCellKind(cell: { kind: string; [k: string]: unknown }): string {
  if (cell.kind === 'tool')
    return `tool: ${cell['tool'] as string} (via ${cell['matrixCategory'] as string})`
  if (cell.kind === 'equivalent') return `equivalent: ${cell['arbiterSlot'] as string}`
  if (cell.kind === 'na-by-archetype')
    return `N/A by archetype (${(cell['archetypes'] as string[]).join(', ')})`
  if (cell.kind === 'na-by-paradigm') return 'N/A by paradigm'
  return 'gap'
}

function renderDim(dim: DerivedKitDim): string {
  const stackRows = STACKS.map((stack) => ({
    stack,
    kind: describeCellKind(dim.perStack[stack]),
  }))
  return renderTemplate('kit/dim.md.ejs', {
    id: dim.id,
    name: dim.name,
    tml: dim.tml,
    gate: dim.gate,
    status: dim.status,
    categoryRef: dim.categoryRef,
    note: dim.note ?? '',
    invLink: dim.invLink ?? '',
    generatorLink: dim.generatorLink ?? '',
    conditionalFlag: dim.conditionalFlag ?? '',
    followupIssue: dim.followupIssue ?? 0,
    stackRows,
  })
}

describe('dim.md.ejs renders without throw', () => {
  it('renders N01 without throw', () => {
    const n01 = derived.find((d) => d.id === 'N01')!
    expect(() => renderDim(n01)).not.toThrow()
  })

  it('renders N40 without throw', () => {
    const n40 = derived.find((d) => d.id === 'N40')!
    expect(() => renderDim(n40)).not.toThrow()
  })

  it('renders N76 without throw', () => {
    const n76 = derived.find((d) => d.id === 'N76')!
    expect(() => renderDim(n76)).not.toThrow()
  })
})

describe('dim.md.ejs output contains required fields', () => {
  it('contains id, name, tml, gate for N01', () => {
    const dim = derived.find((d) => d.id === 'N01')!
    const output = renderDim(dim)
    expect(output).toContain(dim.id)
    expect(output).toContain(dim.name)
    expect(output).toContain(dim.tml)
    expect(output).toContain(dim.gate)
  })

  it('contains Per-Stack Coverage section', () => {
    const dim = derived.find((d) => d.id === 'N01')!
    const output = renderDim(dim)
    expect(output).toContain('Per-Stack Coverage')
  })

  it('contains all 5 stack names', () => {
    const dim = derived.find((d) => d.id === 'N01')!
    const output = renderDim(dim)
    for (const stack of STACKS) {
      expect(output).toContain(stack)
    }
  })
})

describe('dim.md.ejs optional field rendering', () => {
  it('renders invLink when present', () => {
    const dimWithLink = derived.find((d) => d.invLink)
    if (!dimWithLink) return // skip if none in dataset
    const output = renderDim(dimWithLink)
    expect(output).toContain(dimWithLink.invLink!)
  })

  it('omits invLink row when absent', () => {
    const dimNoLink = derived.find((d) => !d.invLink && !d.generatorLink)
    if (!dimNoLink) return
    const output = renderDim(dimNoLink)
    expect(output).not.toContain('| Invariant |')
  })

  it('renders followupIssue when present', () => {
    const dimWithIssue = derived.find((d) => d.followupIssue)
    if (!dimWithIssue) return
    const output = renderDim(dimWithIssue)
    expect(output).toContain(`#${dimWithIssue.followupIssue}`)
  })
})

describe('dim.md.ejs stable output', () => {
  it('produces identical output on two renders of N01', () => {
    const dim = derived.find((d) => d.id === 'N01')!
    const first = renderDim(dim)
    const second = renderDim(dim)
    expect(first).toBe(second)
  })
})
