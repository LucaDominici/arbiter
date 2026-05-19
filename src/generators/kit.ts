// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderTemplate } from '../utils/render.js'
import { DerivedKitSchema } from '../kit/schema.js'
import type { DerivedCell, DerivedKitDim } from '../kit/schema.js'

const STACKS = ['java', 'typescript', 'python', 'go', 'rust'] as const
const MARKER_RE = /^<!-- arbiter-generated dim=(\S+) hash=([0-9a-f]{64}) generator=(\S+) -->$/

function describeCellKind(cell: DerivedCell): string {
  if (cell.kind === 'tool') return `tool: ${cell.tool} (via ${cell.matrixCategory})`
  if (cell.kind === 'equivalent') return `equivalent: ${cell.arbiterSlot}`
  if (cell.kind === 'na-by-archetype')
    return `N/A by archetype (${(cell as { archetypes: string[] }).archetypes.join(', ')})`
  if (cell.kind === 'na-by-paradigm') return 'N/A by paradigm'
  return 'gap'
}

function toSlug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s
}

function computeSlugs(dims: DerivedKitDim[]): Map<string, string> {
  const slugMap = new Map<string, string>()
  const seen = new Map<string, number>()
  for (const dim of dims) {
    const base = toSlug(dim.name) || `untitled-${dim.id.toLowerCase()}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    slugMap.set(dim.id, count === 0 ? base : `${base}-${count + 1}`)
  }
  return slugMap
}

function bodyHash(body: string): string {
  return createHash('sha256').update(body.replace(/\r\n/g, '\n')).digest('hex')
}

function parseMarker(content: string): { dim: string; hash: string } | null {
  const firstLine = content.split('\n')[0] ?? ''
  const m = firstLine.match(MARKER_RE)
  if (!m) return null
  return { dim: m[1] ?? '', hash: m[2] ?? '' }
}

function markerLine(dimId: string, hash: string): string {
  return `<!-- arbiter-generated dim=${dimId} hash=${hash} generator=kit@1 -->`
}

export interface KitGenerateOptions {
  outDir: string
  force?: boolean
  prune?: boolean
}

export interface KitGenerateResult {
  written: string[]
  skipped: string[]
  pruned: string[]
  pruneProtected: string[]
}

export function generateKitDocs(options: KitGenerateOptions): KitGenerateResult {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const derivedPath = join(root, 'src', 'kit', 'derived.json')

  if (!existsSync(derivedPath)) {
    throw new Error('src/kit/derived.json not found — run node scripts/build-kit.mjs first.')
  }

  const derivedKit = DerivedKitSchema.parse(JSON.parse(readFileSync(derivedPath, 'utf-8')))

  mkdirSync(options.outDir, { recursive: true })

  const slugs = computeSlugs(derivedKit)
  const result: KitGenerateResult = {
    written: [],
    skipped: [],
    pruned: [],
    pruneProtected: [],
  }

  const expectedFiles = new Set<string>()
  const ctx: WriteCtx = { options, result }

  // ─── Per-dimension docs ───────────────────────────────────────────────────
  for (const dim of derivedKit) {
    const slug = slugs.get(dim.id) ?? dim.id.toLowerCase()
    const numPart = dim.id.replace('N', '').padStart(2, '0')
    const filename = `dim-${numPart}-${slug}.md`
    const outPath = join(options.outDir, filename)
    expectedFiles.add(filename)

    const stackRows = STACKS.map((stack) => ({
      stack,
      kind: describeCellKind(dim.perStack[stack]),
    }))

    const body = renderTemplate('kit/dim.md.ejs', {
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

    const hash = bodyHash(body)
    const marker = markerLine(dim.id, hash)
    const fullContent = `${marker}\n${body}`

    writeOrSkip(outPath, filename, fullContent, ctx)
  }

  // ─── GLOBAL_KIT.md ────────────────────────────────────────────────────────
  const globalFilename = 'GLOBAL_KIT.md'
  expectedFiles.add(globalFilename)
  const globalPath = join(options.outDir, globalFilename)

  const dimRows = derivedKit.map((dim) => {
    const slug = slugs.get(dim.id) ?? dim.id.toLowerCase()
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

  const globalBody = renderTemplate('kit/GLOBAL_KIT.md.ejs', { dims: dimRows })
  const globalHash = bodyHash(globalBody)
  const globalMarker = markerLine('GLOBAL_KIT', globalHash)
  const globalContent = `${globalMarker}\n${globalBody}`

  writeOrSkip(globalPath, globalFilename, globalContent, ctx)

  // ─── Prune ────────────────────────────────────────────────────────────────
  if (options.prune) {
    const existing = readdirSync(options.outDir).filter((f) => f.match(/^dim-\d+-/))
    for (const f of existing) {
      if (expectedFiles.has(f)) continue
      const p = join(options.outDir, f)
      const content = readFileSync(p, 'utf-8')
      const marker = parseMarker(content)
      if (marker) {
        const bodyStart = content.indexOf('\n') + 1
        const fileBody = content.slice(bodyStart)
        if (bodyHash(fileBody) === marker.hash) {
          unlinkSync(p)
          result.pruned.push(f)
        } else {
          result.pruneProtected.push(f)
        }
      } else {
        result.pruneProtected.push(f)
      }
    }
  }

  return result
}

interface WriteCtx {
  options: KitGenerateOptions
  result: KitGenerateResult
}

function writeOrSkip(outPath: string, filename: string, fullContent: string, ctx: WriteCtx): void {
  if (!existsSync(outPath)) {
    writeFileSync(outPath, fullContent, 'utf-8')
    ctx.result.written.push(filename)
    return
  }

  const existing = readFileSync(outPath, 'utf-8')
  const marker = parseMarker(existing)

  if (!marker) {
    if (ctx.options.force) {
      writeFileSync(outPath, fullContent, 'utf-8')
      ctx.result.written.push(filename)
    } else {
      ctx.result.skipped.push(filename)
    }
    return
  }

  const bodyStart = existing.indexOf('\n') + 1
  const existingBody = existing.slice(bodyStart)
  const isPristine = bodyHash(existingBody) === marker.hash

  if (isPristine || ctx.options.force) {
    writeFileSync(outPath, fullContent, 'utf-8')
    ctx.result.written.push(filename)
  } else {
    ctx.result.skipped.push(filename)
  }
}
