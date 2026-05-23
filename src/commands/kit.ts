// SPDX-License-Identifier: Apache-2.0

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DerivedKitSchema,
  KitCatalogSchema,
  type DerivedKit,
  type DerivedCell,
  type Stack,
} from '../kit/schema.js'
import { toCsv } from '../kit/csv.js'
import { scanForRedactedTokens, type LexiconEntry } from '../kit/redaction.js'
import { generateKitDocs } from '../generators/kit.js'

const STACKS = ['java', 'typescript', 'python', 'go', 'rust'] as const

function loadDerived(): DerivedKit {
  const derivedPath = resolve(fileURLToPath(import.meta.url), '../../..', 'src/kit/derived.json')
  if (!existsSync(derivedPath)) {
    throw new Error(
      '[arbiter] src/kit/derived.json not found — run node scripts/build-kit.mjs first.',
    )
  }
  try {
    return DerivedKitSchema.parse(JSON.parse(readFileSync(derivedPath, 'utf-8')))
  } catch (err) {
    throw new Error(
      '[arbiter] src/kit/derived.json is stale or invalid — run node scripts/build-kit.mjs to rebuild.',
      { cause: err },
    )
  }
}

function describeCellKind(cell: DerivedCell): string {
  if (cell.kind === 'tool') return `tool: ${cell.tool} (via ${cell.matrixCategory})`
  if (cell.kind === 'equivalent') return `equivalent: ${cell.arbiterSlot}`
  if (cell.kind === 'na-by-archetype')
    return `N/A by archetype (${(cell as { archetypes: string[] }).archetypes.join(', ')})`
  if (cell.kind === 'na-by-paradigm') return 'N/A by paradigm'
  return 'gap'
}

export type KitListFormat = 'table' | 'json' | 'csv'
export type KitListFilter = 'gaps' | 'covered' | 'partial' | 'missing' | 'all'

export interface KitListOptions {
  format?: KitListFormat
  filter?: KitListFilter
  stack?: Stack
  tml?: 'L1' | 'L2' | 'L3' | 'L4'
}

export function runKitList(opts: KitListOptions): void {
  let kit = loadDerived()

  if (opts.filter && opts.filter !== 'all') {
    kit = kit.filter((d) => {
      if (opts.filter === 'gaps') {
        return STACKS.some((s) => d.perStack[s].kind === 'gap')
      }
      if (opts.filter === 'covered') return d.status === 'covered'
      if (opts.filter === 'partial') return d.status === 'partial'
      if (opts.filter === 'missing') return d.status === 'missing' || d.status === 'missing-tracked'
      return true
    })
  }

  if (opts.stack) {
    const stack = opts.stack
    kit = kit.filter((d) => d.perStack[stack].kind !== 'gap')
  }

  if (opts.tml) {
    kit = kit.filter((d) => d.tml === opts.tml)
  }

  if (opts.format === 'json') {
    process.stdout.write(JSON.stringify(kit, null, 2) + '\n')
    return
  }

  if (opts.format === 'csv') {
    process.stdout.write(toCsv(kit))
    return
  }

  // Table format (default)
  const header = `${'ID'.padEnd(4)} ${'TML'.padEnd(3)} ${'Gate'.padEnd(10)} ${'Status'.padEnd(15)} Name`
  const divider = '-'.repeat(header.length)
  process.stdout.write(header + '\n')
  process.stdout.write(divider + '\n')
  for (const dim of kit) {
    process.stdout.write(
      `${dim.id.padEnd(4)} ${dim.tml.padEnd(3)} ${dim.gate.padEnd(10)} ${dim.status.padEnd(15)} ${dim.name}\n`,
    )
  }
  process.stdout.write(divider + '\n')
  process.stdout.write(`Total: ${kit.length} dimensions\n`)
}

export function runKitShow(id: string): void {
  const kit = loadDerived()
  const dim = kit.find((d) => d.id === id)
  if (!dim) {
    process.stderr.write(`[arbiter] kit show: dimension "${id}" not found.\n`)
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(dim, null, 2) + '\n')
}

export function runKitExplain(id: string): void {
  const kit = loadDerived()
  const dim = kit.find((d) => d.id === id)
  if (!dim) {
    process.stderr.write(`[arbiter] kit explain: dimension "${id}" not found.\n`)
    process.exit(1)
  }

  process.stdout.write(`\n=== ${dim.id}: ${dim.name} ===\n\n`)
  process.stdout.write(`TML: ${dim.tml}  Gate: ${dim.gate}  Status: ${dim.status}\n`)
  process.stdout.write(`Category: ${dim.categoryRef}\n`)
  if (dim.note) process.stdout.write(`\n${dim.note}\n`)
  if (dim.invLink) process.stdout.write(`\nInvariant: ${dim.invLink}\n`)
  if (dim.generatorLink) process.stdout.write(`Generator: ${dim.generatorLink}\n`)
  if (dim.conditionalFlag) process.stdout.write(`Conditional: --${dim.conditionalFlag}\n`)
  if (dim.followupIssue) process.stdout.write(`Follow-up: #${dim.followupIssue}\n`)

  process.stdout.write(`\nPer-stack projection:\n`)
  for (const stack of STACKS) {
    const desc = describeCellKind(dim.perStack[stack])
    process.stdout.write(`  ${stack.padEnd(12)} ${desc}\n`)
  }
  process.stdout.write('\n')
}

type CatalogArr = Array<{ id: string; name: string; tml: string; gate: string }>
type MappingDim = Record<string, unknown>
type CatalogEntry = { id: string; name: string; tml: string; gate: string }

const VALIDATE_ACCEPTED_WAVES = new Set(['W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11'])

function checkFieldParity(cid: string, dim: MappingDim, cat: CatalogEntry): string[] {
  const fails: string[] = []
  const dimName = dim['name'] as string | undefined
  if (dimName?.normalize('NFC').trim() !== cat.name.normalize('NFC').trim())
    fails.push(`${cid} name mismatch`)
  if (dim['tml_source'] !== cat.tml) fails.push(`${cid} tml mismatch`)
  const dimGate = dim['gate_type'] as string | undefined
  if (dimGate?.replace(/\s*\([^)]+\)$/, '').trim() !== cat.gate) fails.push(`${cid} gate mismatch`)
  return fails
}

function checkEnforcement(cid: string, dim: MappingDim): string | null {
  const fr = dim['framework_realization'] as Record<string, unknown> | undefined
  const hasEnf =
    dim['invariant_id'] != null ||
    (fr != null &&
      (fr['invariant'] != null ||
        fr['validator'] != null ||
        fr['template'] != null ||
        fr['generator'] != null))
  const disp = dim['disposition'] as string | undefined
  const wave = dim['implementing_wave'] as string | null | undefined
  const hasExempt =
    disp === 'done' ||
    ((disp === 'adopt-framework' || disp === 'stack-adapter') &&
      wave != null &&
      VALIDATE_ACCEPTED_WAVES.has(wave))
  return hasEnf || hasExempt ? null : `${cid} BLOCKING with no enforcement and no valid exemption`
}

function runParityCheck(root: string, catalogArr: CatalogArr): string[] {
  const fails: string[] = []
  let mappingDims: MappingDim[]
  try {
    const raw = JSON.parse(
      readFileSync(resolve(root, 'docs/audits/kit-canonical-mapping.json'), 'utf-8'),
    ) as { dimensions: MappingDim[] }
    mappingDims = raw.dimensions
  } catch (err) {
    throw new Error(`failed to load mapping: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    })
  }

  const catalogIds = new Set(catalogArr.map((d) => d.id))
  const mappingIds = new Set<string>()

  for (const dim of mappingDims) {
    const cid = dim['canonical_id'] as string | undefined
    if (!cid) {
      fails.push(`mapping id=${String(dim['id'])} missing canonical_id`)
      continue
    }
    if (mappingIds.has(cid)) {
      fails.push(`duplicate canonical_id ${cid}`)
      continue
    }
    mappingIds.add(cid)
    const cat = catalogArr.find((c) => c.id === cid)
    if (!cat) {
      fails.push(`mapping canonical_id ${cid} not in catalog`)
      continue
    }
    fails.push(...checkFieldParity(cid, dim, cat))
    if (cat.gate === 'BLOCKING') {
      const enfFail = checkEnforcement(cid, dim)
      if (enfFail) fails.push(enfFail)
    }
  }
  for (const id of catalogIds) {
    if (!mappingIds.has(id)) fails.push(`catalog ${id} missing from mapping`)
  }
  return fails
}

export function runKitValidate(): void {
  const root = resolve(fileURLToPath(import.meta.url), '../../..')
  let maxSeverity = 0

  // ─── Subcheck 1: schema ───────────────────────────────────────────────────
  let catalog: CatalogArr | null = null
  try {
    const catalogPath = resolve(root, 'src/kit/catalog.json')
    catalog = KitCatalogSchema.parse(JSON.parse(readFileSync(catalogPath, 'utf-8')) as unknown)
  } catch (err) {
    process.stderr.write(
      `[arbiter kit validate] schema ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    maxSeverity = Math.max(maxSeverity, 2)
  }

  // ─── Subcheck 2: parity ───────────────────────────────────────────────────
  if (catalog) {
    try {
      const fails = runParityCheck(root, catalog)
      if (fails.length > 0) {
        process.stdout.write('[INV-86] kit catalog parity FAIL\n')
        for (const f of fails) process.stdout.write(`  [parity] ${f}\n`)
        maxSeverity = Math.max(maxSeverity, 1)
      }
    } catch (err) {
      process.stderr.write(
        `[arbiter kit validate] parity ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
      )
      maxSeverity = Math.max(maxSeverity, 2)
    }
  }

  // ─── Subcheck 3: redaction ────────────────────────────────────────────────
  try {
    const lexicon = JSON.parse(
      readFileSync(resolve(root, 'scripts/data/redaction-lexicon.json'), 'utf-8'),
    ) as LexiconEntry[]
    const catalogText = readFileSync(resolve(root, 'src/kit/catalog.json'), 'utf-8')
    const matches = scanForRedactedTokens(catalogText, lexicon)
    if (matches.length > 0) {
      process.stdout.write('[INV-85] redaction FAIL\n')
      for (const m of matches)
        process.stdout.write(`  line ${m.line} [${m.token}]: ${m.lineContent.trim()}\n`)
      maxSeverity = Math.max(maxSeverity, 1)
    }
  } catch (err) {
    process.stderr.write(
      `[arbiter kit validate] redaction ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    maxSeverity = Math.max(maxSeverity, 2)
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  if (maxSeverity === 0) {
    process.stdout.write(
      `[arbiter kit validate] OK (${catalog?.length ?? 0} dims, parity green, no redacted tokens)\n`,
    )
  }

  process.exit(maxSeverity)
}

export interface KitGenerateOptions {
  out?: string
  force?: boolean
  prune?: boolean
}

export function runKitGenerate(opts: KitGenerateOptions): void {
  const outDir = opts.out ?? 'docs/REFERENCE'
  try {
    const genOpts: { outDir: string; force?: boolean; prune?: boolean } = { outDir }
    if (opts.force) genOpts.force = true
    if (opts.prune) genOpts.prune = true
    const result = generateKitDocs(genOpts)
    process.stdout.write(
      `[arbiter kit generate] written=${result.written.length} skipped=${result.skipped.length}` +
        (opts.prune
          ? ` pruned=${result.pruned.length} protected=${result.pruneProtected.length}`
          : '') +
        '\n',
    )
    if (result.skipped.length > 0) {
      for (const f of result.skipped)
        process.stdout.write(`  [skip] ${f} (user edit detected — use --force to overwrite)\n`)
    }
    if (result.pruneProtected.length > 0) {
      for (const f of result.pruneProtected)
        process.stdout.write(`  [protected] ${f} (user edit detected — not pruned)\n`)
    }
  } catch (err) {
    process.stderr.write(
      `[arbiter kit generate] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }
}
