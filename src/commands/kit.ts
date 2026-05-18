// SPDX-License-Identifier: Apache-2.0

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEnabled } from '../experimental/index.js'
import { DerivedKitSchema, type DerivedKit, type DerivedCell, type Stack } from '../kit/schema.js'
import { toCsv } from '../kit/csv.js'

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

function getFlags(): Record<string, boolean> {
  const raw = process.env['ARBITER_EXPERIMENTAL']
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    process.stderr.write(
      '[arbiter] Warning: ARBITER_EXPERIMENTAL is not valid JSON — experimental flags ignored.\n',
    )
    return {}
  }
}

function assertKitEnabled(): void {
  if (!isEnabled('kit', getFlags())) {
    process.stderr.write(
      '[arbiter] The kit command requires --experimental.kit flag.\n' +
        '  Usage: arbiter --experimental.kit kit <subcommand>\n',
    )
    process.exit(1)
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
  tml?: 'L1' | 'L2' | 'L3'
}

export function runKitList(opts: KitListOptions): void {
  assertKitEnabled()
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
  assertKitEnabled()
  const kit = loadDerived()
  const dim = kit.find((d) => d.id === id)
  if (!dim) {
    process.stderr.write(`[arbiter] kit show: dimension "${id}" not found.\n`)
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(dim, null, 2) + '\n')
}

export function runKitExplain(id: string): void {
  assertKitEnabled()
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
