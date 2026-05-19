// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { DerivedKitSchema, type DerivedKitDim } from '../../../src/kit/schema.js'

const ROOT = resolve('.')

let derived: DerivedKitDim[]

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function renderGlobal(dims: DerivedKitDim[]): string {
  const dimRows = dims.map((dim) => {
    const slug = toSlug(dim.name) || `untitled-${dim.id.toLowerCase()}`
    const numPart = dim.id.replace('N', '').padStart(2, '0')
    return {
      id: dim.id,
      tml: dim.tml,
      gate: dim.gate,
      status: dim.status,
      name: dim.name,
      filename: `dim-${numPart}-${slug}.md`,
    }
  })
  return renderTemplate('kit/GLOBAL_KIT.md.ejs', { dims: dimRows })
}

beforeAll(() => {
  derived = DerivedKitSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'src/kit/derived.json'), 'utf-8')),
  )
})

describe('GLOBAL_KIT.md.ejs renders all 76 dims', () => {
  it('renders without throw', () => {
    expect(() => renderGlobal(derived)).not.toThrow()
  })

  it('contains a link for every dim filename', () => {
    const output = renderGlobal(derived)
    for (const dim of derived) {
      const slug = toSlug(dim.name) || `untitled-${dim.id.toLowerCase()}`
      const numPart = dim.id.replace('N', '').padStart(2, '0')
      const filename = `dim-${numPart}-${slug}.md`
      expect(output, `missing link to ${filename}`).toContain(filename)
    }
  })

  it('contains all 76 dim IDs', () => {
    const output = renderGlobal(derived)
    for (const dim of derived) {
      expect(output, `missing id ${dim.id}`).toContain(dim.id)
    }
  })

  it('contains expected heading', () => {
    const output = renderGlobal(derived)
    expect(output).toContain('KIT Canonical Dimensions Reference')
  })
})

describe('GLOBAL_KIT.md.ejs no timestamps', () => {
  it('output does not contain ISO timestamp pattern', () => {
    const output = renderGlobal(derived)
    // No timestamps like 2026-05-19T12:00 anywhere in output
    expect(output).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })
})

describe('GLOBAL_KIT.md.ejs idempotent', () => {
  it('produces identical output on two consecutive renders', () => {
    const first = renderGlobal(derived)
    const second = renderGlobal(derived)
    expect(first).toBe(second)
  })
})
