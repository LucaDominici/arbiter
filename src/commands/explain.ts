// SPDX-License-Identifier: Apache-2.0
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INVARIANT_CATALOG } from '../invariants/catalog.js'
import { ERROR_CATALOG } from '../utils/error-catalog.js'
import { loadCanonEntries } from '../utils/canon-loader.js'

const DOCS_ROOT = resolve(fileURLToPath(import.meta.url), '../../..', 'docs')
const CANON_MD_PATH = join(DOCS_ROOT, 'SYSTEM/CANON.md')

export interface ExplainOptions {
  format?: string
  list?: boolean
}

export interface ExplainResult {
  exitCode: number
  output: string
  error: string
}

export function runExplain(code: string, opts: ExplainOptions): ExplainResult {
  if (opts.list) return listAll(opts.format)

  if (!code) {
    return {
      exitCode: 1,
      output: '',
      error: 'Usage: arbiter explain <code> [--format json] | --list\n',
    }
  }

  const normalized = code.toUpperCase()

  if (normalized.startsWith('INV-')) return explainInv(normalized, opts.format)
  if (normalized.startsWith('CANON-')) return explainCanon(normalized, opts.format)
  if (normalized.startsWith('E_') || ERROR_CATALOG.has(normalized)) {
    return explainError(normalized, opts.format)
  }

  if (opts.format === 'json') {
    return {
      exitCode: 1,
      output: JSON.stringify({ error: `Unknown code: ${code}` }, null, 2),
      error: '',
    }
  }

  return {
    exitCode: 1,
    output: '',
    error: `Unknown code: ${code}\nRun \`arbiter explain --list\` to see all known codes.\n`,
  }
}

function explainInv(id: string, format: string | undefined): ExplainResult {
  const inv = INVARIANT_CATALOG.find((i) => i.id === id)
  if (!inv) {
    return { exitCode: 1, output: '', error: `Unknown invariant: ${id}\n` }
  }

  if (format === 'json') {
    const payload = {
      code: inv.id,
      category: 'INV',
      summary: inv.title,
      detail: inv.description,
      enforcement: inv.enforcement ?? '',
      tier: inv.tier,
      alwaysActive: inv.alwaysActive,
    }
    return { exitCode: 0, output: JSON.stringify(payload, null, 2), error: '' }
  }

  const lines: string[] = ['', `${inv.id} — ${inv.title}`, '', `  ${inv.description}`, '']
  if (inv.enforcement) lines.push(`  Enforcement: ${inv.enforcement}`, '')
  lines.push(`  Tier: ${inv.tier}  |  Always active: ${inv.alwaysActive ? 'yes' : 'no'}`, '')
  lines.push(`  Run \`arbiter explain --list\` to see all codes.`, '')

  return { exitCode: 0, output: lines.join('\n'), error: '' }
}

function explainCanon(id: string, format: string | undefined): ExplainResult {
  const entries = loadCanonEntries(CANON_MD_PATH)
  const entry = entries.find((e) => e.id === id)
  if (!entry) {
    return { exitCode: 1, output: '', error: `Unknown CANON rule: ${id}\n` }
  }

  if (format === 'json') {
    const payload = {
      code: entry.id,
      category: 'CANON',
      summary: entry.title,
      rule: entry.rule,
      why: entry.why,
      enforcement: entry.enforcement,
      sourceIssues: entry.sourceIssues,
      promotedTo: entry.promotedTo,
    }
    return { exitCode: 0, output: JSON.stringify(payload, null, 2), error: '' }
  }

  const lines: string[] = [
    '',
    `${entry.id} — ${entry.title}`,
    '',
    `  Rule: ${entry.rule}`,
    '',
    `  Why: ${entry.why}`,
    '',
    `  Enforcement: ${entry.enforcement}`,
    '',
  ]
  if (entry.sourceIssues) lines.push(`  Source issues: ${entry.sourceIssues}`, '')
  if (entry.promotedTo) lines.push(`  Promoted to: ${entry.promotedTo}`, '')

  return { exitCode: 0, output: lines.join('\n'), error: '' }
}

function explainError(code: string, format: string | undefined): ExplainResult {
  const entry = ERROR_CATALOG.get(code)
  if (!entry) {
    return { exitCode: 1, output: '', error: `Unknown error code: ${code}\n` }
  }

  if (format === 'json') {
    const payload = {
      code: entry.code,
      category: 'ERROR',
      summary: entry.summary,
      detail: entry.detail,
      recovery: entry.recovery,
      docUrl: entry.docUrl,
    }
    return { exitCode: 0, output: JSON.stringify(payload, null, 2), error: '' }
  }

  const lines: string[] = [
    '',
    `${entry.code} — ${entry.summary}`,
    '',
    `  ${entry.detail}`,
    '',
    `  Recovery:`,
    `    ${entry.recovery}`,
    '',
  ]
  if (entry.docUrl) lines.push(`  See: ${entry.docUrl}`, '')

  return { exitCode: 0, output: lines.join('\n'), error: '' }
}

function listAll(format: string | undefined): ExplainResult {
  const errorCodes = Array.from(ERROR_CATALOG.keys())
  const invCodes = INVARIANT_CATALOG.map((i) => i.id)
  const canonEntries = loadCanonEntries(CANON_MD_PATH)
  const canonCodes = canonEntries.map((e) => e.id)

  if (format === 'json') {
    const items = [
      ...errorCodes.map((c) => {
        const e = ERROR_CATALOG.get(c)
        return { code: c, category: 'ERROR', summary: e?.summary ?? '' }
      }),
      ...INVARIANT_CATALOG.map((i) => ({ code: i.id, category: 'INV', summary: i.title })),
      ...canonEntries.map((c) => ({ code: c.id, category: 'CANON', summary: c.title })),
    ]
    return { exitCode: 0, output: JSON.stringify(items, null, 2), error: '' }
  }

  const lines: string[] = [
    '',
    'ERROR codes:',
    ...errorCodes.map((c) => `  ${c}`),
    '',
    'INV codes:',
    ...invCodes.map((c) => `  ${c}`),
    '',
    'CANON rules:',
    ...canonCodes.map((c) => `  ${c}`),
    '',
    'Run `arbiter explain <code>` for details on any entry.',
    '',
  ]

  return { exitCode: 0, output: lines.join('\n'), error: '' }
}
