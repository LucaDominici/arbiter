// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INVARIANT_CATALOG } from '../invariants/catalog.js'
import { ERROR_CATALOG } from '../utils/error-catalog.js'
import { loadCanonEntries } from '../utils/canon-loader.js'
import { writeFileTranslated } from '../utils/fs.js'
import { slugifyProjectName } from './init.js'

const DOCS_ROOT = resolve(fileURLToPath(import.meta.url), '../../..', 'docs')
const CANON_MD_PATH = join(DOCS_ROOT, 'internal/SYSTEM/CANON.md')
// Mirrors src/utils/render.ts's TEMPLATES_DIR: one level up from this file's own dir
// resolves to src/templates in dev and dist/templates in the built package (the build
// step copies src/templates -> dist/templates verbatim), unlike DOCS_ROOT above whose
// `docs/` lives at the true repo root in both modes.
const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
const HANDOFF_TEMPLATE_PATH = join(TEMPLATES_DIR, 'HANDOFF.template.md')

export interface ExplainOptions {
  format?: string
  list?: boolean
  /** #1817 (A7): topic for `arbiter explain --handoff <topic>` scaffold. */
  handoff?: string
  /** Target directory for the scaffolded handoff file. Defaults to cwd. */
  out?: string
}

/**
 * #1315 — wizard flag codes. `arbiter explain <flag>` tells a solo operator what
 * machinery a Yes answer to that wizard prompt actually generates, so they can
 * weigh the cost. Mirrors the per-flag cost lines in src/wizard/prompts.ts.
 */
interface FlagEntry {
  summary: string
  detail: string
}

const FLAG_CATALOG: ReadonlyMap<string, FlagEntry> = new Map([
  [
    'hasPublicApi',
    {
      summary: 'Project exposes a public API (REST / GraphQL / gRPC).',
      detail:
        'Generates: OWASP ZAP DAST scan, an OpenAPI/contract test suite, and an API deprecation policy with a breaking-change gate. Also unlocks the contractType prompt.',
    },
  ],
  [
    'isMultiTenant',
    {
      summary: 'Project serves multiple tenants from one deployment.',
      detail:
        'Descriptive metadata input only — adds a risk-register entry for tenant data isolation (R-008). Does not generate isolation/auth machinery; isolation topology is user-determined (row-level, schema-per-tenant, DB-per-tenant, or file-per-tenant).',
    },
  ],
  [
    'contractType',
    {
      summary: 'Contract-testing strategy for the public API.',
      detail:
        'Generates: a consumer/provider contract-test suite — Pact (rest-owned), OpenAPI-diff (rest-public), graphql-inspector (graphql), buf breaking (grpc), or schema-registry (message-queue) — wired into CI.',
    },
  ],
])

/** Resolve a flag code case-insensitively to its canonical camelCase key. */
function resolveFlagCode(code: string): string | undefined {
  const lower = code.toLowerCase()
  for (const key of FLAG_CATALOG.keys()) {
    if (key.toLowerCase() === lower) return key
  }
  return undefined
}

export interface ExplainResult {
  exitCode: number
  output: string
  error: string
}

export function runExplain(code: string, opts: ExplainOptions): ExplainResult {
  if (opts.handoff !== undefined) return scaffoldHandoff(opts.handoff, opts.out)

  if (opts.list) return listAll(opts.format)

  if (!code) {
    return {
      exitCode: 1,
      output: '',
      error: 'Usage: arbiter explain <code> [--format json] | --list\n',
    }
  }

  const flagKey = resolveFlagCode(code)
  if (flagKey) return explainFlag(flagKey, opts.format)

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

/**
 * #1817 (A7) — executable-handoff standard. The cheapest durable memory across
 * sessions/models is a file a COLD model can execute without re-derivation: context,
 * evidence pointers, atomic ordered tasks, an AC + verification command per task, and
 * a suggested model tier. Reference implementation: the #1817 gold-rebaseline plan
 * this pattern was distilled from.
 *
 * `arbiter explain --handoff <topic>` scaffolds `HANDOFF-<SLUG>.md` from
 * `src/templates/HANDOFF.template.md` into `--out` (defaults to cwd). Never overwrites
 * an existing file for the same topic — same "customizable, arbiter leaves edits alone"
 * contract as the generator `skipIfExists` convention (A4/#1817), kept here as a plain
 * fs check since this scaffold is deliberately outside the generator/registry pipeline.
 */
function scaffoldHandoff(topic: string, outDir: string | undefined): ExplainResult {
  if (!topic.trim()) {
    return {
      exitCode: 1,
      output: '',
      error: 'Usage: arbiter explain --handoff <topic>\n',
    }
  }

  const slug = slugifyProjectName(topic).toUpperCase()
  const targetDir = outDir ?? process.cwd()
  const filePath = join(targetDir, `HANDOFF-${slug}.md`)

  if (existsSync(filePath)) {
    return {
      exitCode: 0,
      output: `${filePath} already exists — not overwritten (edit it directly).\n`,
      error: '',
    }
  }

  const template = readFileSync(HANDOFF_TEMPLATE_PATH, 'utf-8')
  const date = new Date().toISOString().slice(0, 10)
  const content = template.replaceAll('{{TOPIC}}', topic).replaceAll('{{DATE}}', date)

  mkdirSync(targetDir, { recursive: true })
  writeFileTranslated(filePath, content)

  return {
    exitCode: 0,
    output: `Scaffolded ${filePath}\n`,
    error: '',
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

function explainFlag(key: string, format: string | undefined): ExplainResult {
  const entry = FLAG_CATALOG.get(key)
  if (!entry) {
    return { exitCode: 1, output: '', error: `Unknown flag: ${key}\n` }
  }

  if (format === 'json') {
    const payload = {
      code: key,
      category: 'FLAG',
      summary: entry.summary,
      detail: entry.detail,
    }
    return { exitCode: 0, output: JSON.stringify(payload, null, 2), error: '' }
  }

  const lines: string[] = [
    '',
    `${key} — ${entry.summary}`,
    '',
    `  ${entry.detail}`,
    '',
    `  Run \`arbiter explain --list\` to see all codes.`,
    '',
  ]
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
      ...Array.from(FLAG_CATALOG.entries()).map(([code, e]) => ({
        code,
        category: 'FLAG',
        summary: e.summary,
      })),
    ]
    return { exitCode: 0, output: JSON.stringify(items, null, 2), error: '' }
  }

  const flagCodes = Array.from(FLAG_CATALOG.keys())
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
    'FLAG codes (wizard answers):',
    ...flagCodes.map((c) => `  ${c}`),
    '',
    'Run `arbiter explain <code>` for details on any entry.',
    '',
  ]

  return { exitCode: 0, output: lines.join('\n'), error: '' }
}
