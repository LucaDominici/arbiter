#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Derives src/kit/derived.json from catalog + overlay + cross-language-matrix + category-map.
// Idempotent. Must run before any kit tests.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

function read(rel) {
  const abs = join(ROOT, rel)
  try {
    return JSON.parse(readFileSync(abs, 'utf-8'))
  } catch (err) {
    process.stderr.write(`build-kit: cannot read ${rel}: ${err.message}\n`)
    process.exit(1)
  }
}

const catalog = read('src/kit/catalog.json')
const overlay = read('src/kit/overlay.json')
const matrix = read('src/compatibility/cross-language-matrix.json')
const categoryMap = read('src/kit/category-map.json')

const STACKS = ['java', 'typescript', 'python', 'go', 'rust']

// Build a lookup: category -> stack -> tool string (or null for N/A / missing)
function buildMatrixLookup() {
  const lookup = new Map()
  for (const [cat, stackMap] of Object.entries(matrix)) {
    if (cat.startsWith('_')) continue
    const stackTools = new Map()
    for (const stack of STACKS) {
      const cell = stackMap[stack]
      if (cell === undefined || cell === null) {
        stackTools.set(stack, null)
      } else {
        const tool = typeof cell === 'object' ? cell.tool : cell
        stackTools.set(stack, tool === 'N/A' ? null : tool)
      }
    }
    lookup.set(cat, stackTools)
  }
  return lookup
}

const matrixLookup = buildMatrixLookup()

function derivePerStack(dim) {
  const kitCategoryRef = dim.categoryRef
  const matrixCategories = categoryMap[kitCategoryRef] ?? []
  const perStack = {}

  for (const stack of STACKS) {
    // Check overlay first
    const overlayCell = overlay[dim.id]?.[stack]
    if (overlayCell !== undefined) {
      perStack[stack] = overlayCell
      continue
    }

    // Try matrix lookup — use first category that has a tool for this stack
    let found = null
    for (const cat of matrixCategories) {
      const stackTools = matrixLookup.get(cat)
      if (stackTools === undefined) continue
      const tool = stackTools.get(stack)
      if (tool !== null && tool !== undefined) {
        found = { kind: 'tool', tool, matrixCategory: cat }
        break
      }
    }

    if (found !== null) {
      perStack[stack] = found
    } else {
      perStack[stack] = { kind: 'gap' }
    }
  }

  return perStack
}

const derived = catalog.map((dim) => ({
  ...dim,
  perStack: derivePerStack(dim),
}))

const outPath = join(ROOT, 'src/kit/derived.json')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(derived, null, 2) + '\n')
process.stdout.write(`build-kit: derived ${derived.length} dimensions → src/kit/derived.json\n`)
