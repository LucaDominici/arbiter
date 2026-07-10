// SPDX-License-Identifier: Apache-2.0

import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DerivedKitSchema,
  KitCatalogSchema,
  type DerivedKit,
  type DerivedCell,
  type Stack,
} from '../kit/schema.js'
import { toCsv } from '../kit/csv.js'
import { kitDataPath } from '../kit/catalog.js'
import { scanForRedactedTokens, type LexiconEntry } from '../kit/redaction.js'
import { generateKitDocs } from '../generators/kit.js'
import { walkFiles } from '../kit/checks/fs-walk.js'
import {
  validateFlywayMigrations,
  type MigrationFile,
  type FlywayViolation,
} from '../kit/checks/flyway-validator.js'
import {
  checkJavaTestTaxonomy,
  isTaxonomyGatePass,
  type JavaTestFile,
} from '../kit/checks/java-test-taxonomy.js'
import {
  scanTokenHygiene,
  applyBaseline,
  findStaleBaselineEntries,
  isTokenHygieneGatePass,
  type HygieneFile,
  type TokenHygieneBaseline,
} from '../kit/checks/token-hygiene.js'

const STACKS = ['java', 'typescript', 'python', 'go', 'rust'] as const

function loadDerived(): DerivedKit {
  const derivedPath = kitDataPath('derived.json')
  if (!existsSync(derivedPath)) {
    throw new Error('[arbiter] kit derived.json not found — run node scripts/build-kit.mjs first.')
  }
  try {
    return DerivedKitSchema.parse(JSON.parse(readFileSync(derivedPath, 'utf-8')))
  } catch (err) {
    throw new Error(
      '[arbiter] kit derived.json is stale or invalid — run node scripts/build-kit.mjs to rebuild.',
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
type ImportSource = { import_id: number; import_name: string }
type UnmappedImportDim = { import_id: number; import_name: string }

const VALIDATE_ACCEPTED_WAVES = new Set(['W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11'])

function alnumKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function docsSlugPortion(docsPath: string): string {
  return docsPath.replace(/^.*\/dim-\d+-/, '').replace(/\.md$/, '')
}

/** Rule 5 (R-08): import_source.import_name must recognizably match the
 * framework_realization.docs pointer it moved in with. Docs slugs are
 * truncated, so this is an alnum-normalized prefix check, not equality. */
function checkProvenance(cid: string, dim: MappingDim): string | null {
  const src = dim['import_source'] as ImportSource | null | undefined
  if (!src) return null
  const fr = dim['framework_realization'] as Record<string, unknown> | undefined
  const docs = fr?.['docs'] as string | null | undefined
  if (docs == null) return null
  const nameKey = alnumKey(src.import_name)
  const docsKey = alnumKey(docsSlugPortion(docs))
  if (nameKey.startsWith(docsKey) || docsKey.startsWith(nameKey)) return null
  return `${cid} import_source.import_name="${src.import_name}" does not match framework_realization.docs="${docs}"`
}

/** Rule 6 (R-13): every non-null template/generator/validator path must
 * either be prefixed "planned:" or exist on disk relative to the arbiter
 * package root. Inapplicable in a published install (#1575) — those paths
 * point into the dev source tree (src/...), which never ships; the caller
 * skips this check entirely when root has no src/ directory. */
function checkPhantomPaths(cid: string, dim: MappingDim, root: string): string[] {
  const fails: string[] = []
  const fr = dim['framework_realization'] as Record<string, unknown> | undefined
  if (!fr) return fails
  for (const key of ['template', 'generator', 'validator'] as const) {
    const val = fr[key] as string | null | undefined
    if (val == null || val.startsWith('planned:')) continue
    if (!existsSync(resolve(root, val))) {
      fails.push(
        `${cid} framework_realization.${key}="${val}" does not exist on disk (prefix with "planned:" or build it)`,
      )
    }
  }
  return fails
}

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

/** Rule 7: every original import dim (1..importTotal) appears exactly once —
 * either attached to a canonical row via import_source, or recorded in
 * unmapped_import_dims. Gated on import_total (from canonical-mapping.json
 * metadata) so mapping files without the R-08 crosswalk skip this rule. */
function checkCrosswalkIntegrity(
  mappingDims: MappingDim[],
  unmappedImportDims: UnmappedImportDim[],
  importTotal: number | null,
): string[] {
  const fails: string[] = []
  if (importTotal == null || importTotal <= 0) return fails
  const seen = new Map<number, string>()
  for (const dim of mappingDims) {
    const src = dim['import_source'] as ImportSource | null | undefined
    if (!src) continue
    const existing = seen.get(src.import_id)
    const cid = dim['canonical_id'] as string
    if (existing) {
      fails.push(`import_id ${src.import_id} attached to both ${existing} and ${cid}`)
    } else {
      seen.set(src.import_id, cid)
    }
  }
  for (const u of unmappedImportDims) {
    const existing = seen.get(u.import_id)
    if (existing) {
      fails.push(`import_id ${u.import_id} in unmapped_import_dims AND attached to ${existing}`)
    } else {
      seen.set(u.import_id, 'unmapped_import_dims')
    }
  }
  for (let id = 1; id <= importTotal; id++) {
    if (!seen.has(id)) fails.push(`import_id ${id} missing from crosswalk entirely`)
  }
  return fails
}

function runParityCheck(catalogArr: CatalogArr, root: string): string[] {
  const fails: string[] = []
  let mappingDims: MappingDim[]
  let unmappedImportDims: UnmappedImportDim[]
  let importTotal: number | null
  try {
    const raw = JSON.parse(readFileSync(kitDataPath('canonical-mapping.json'), 'utf-8')) as {
      dimensions: MappingDim[]
      unmapped_import_dims?: UnmappedImportDim[]
      import_total?: number
    }
    mappingDims = raw.dimensions
    unmappedImportDims = raw.unmapped_import_dims ?? []
    importTotal = raw.import_total ?? null
  } catch (err) {
    throw new Error(`failed to load mapping: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    })
  }

  const catalogIds = new Set(catalogArr.map((d) => d.id))
  const mappingIds = new Set<string>()
  // Rule 6 points into the dev source tree (src/...), which never ships in a
  // published install (#1575) — skip it there rather than fail-closed on an
  // absence-by-design.
  const hasSrcTree = existsSync(resolve(root, 'src'))

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
    const provFail = checkProvenance(cid, dim)
    if (provFail) fails.push(provFail)
    if (hasSrcTree) fails.push(...checkPhantomPaths(cid, dim, root))
  }
  for (const id of catalogIds) {
    if (!mappingIds.has(id)) fails.push(`catalog ${id} missing from mapping`)
  }
  fails.push(...checkCrosswalkIntegrity(mappingDims, unmappedImportDims, importTotal))
  return fails
}

/** Result of a kit-state validation pass. severity: 0 OK, 1 FAIL, 2 ERROR. */
interface KitValidation {
  severity: number
  stdout: string[]
  stderr: string[]
}

/**
 * Redaction subcheck (INV-85). The lexicon (scripts/data/) is a maintainer asset
 * intentionally NOT shipped in the npm tarball, so in a published install it is
 * absent and the check is skipped (severity 0) rather than failing closed —
 * otherwise the gate would block every kit subcommand even though the shipped
 * catalog was already redaction-clean at build time (#1575). Extracted from
 * `computeKitValidation` to keep that function under the complexity ceiling.
 */
function runRedactionSubcheck(root: string): KitValidation {
  const stdout: string[] = []
  const stderr: string[] = []
  const lexiconPath = resolve(root, 'scripts/data/redaction-lexicon.json')
  if (!existsSync(lexiconPath)) return { severity: 0, stdout, stderr }
  try {
    const lexicon = JSON.parse(readFileSync(lexiconPath, 'utf-8')) as LexiconEntry[]
    const catalogText = readFileSync(kitDataPath('catalog.json'), 'utf-8')
    const matches = scanForRedactedTokens(catalogText, lexicon)
    if (matches.length > 0) {
      stdout.push('[INV-85] redaction FAIL')
      for (const m of matches) stdout.push(`  line ${m.line} [${m.token}]: ${m.lineContent.trim()}`)
      return { severity: 1, stdout, stderr }
    }
    return { severity: 0, stdout, stderr }
  } catch (err) {
    stderr.push(
      `[arbiter kit validate] redaction ERROR: ${err instanceof Error ? err.message : String(err)}`,
    )
    return { severity: 2, stdout, stderr }
  }
}

/**
 * Validate the kit catalog against its real state — schema, mapping parity, and
 * redaction. Pure with respect to process streams: returns the lines and the
 * aggregate severity rather than writing/exiting, so both the `kit validate`
 * command and the `kit` experimental gate (preAction) can reuse it (#1151).
 */
function computeKitValidation(): KitValidation {
  const root = resolve(fileURLToPath(import.meta.url), '../../..')
  let maxSeverity = 0
  const stdout: string[] = []
  const stderr: string[] = []

  // ─── Subcheck 1: schema ───────────────────────────────────────────────────
  let catalog: CatalogArr | null = null
  try {
    const catalogPath = kitDataPath('catalog.json')
    catalog = KitCatalogSchema.parse(JSON.parse(readFileSync(catalogPath, 'utf-8')) as unknown)
  } catch (err) {
    stderr.push(
      `[arbiter kit validate] schema ERROR: ${err instanceof Error ? err.message : String(err)}`,
    )
    maxSeverity = Math.max(maxSeverity, 2)
  }

  // ─── Subcheck 2: parity ───────────────────────────────────────────────────
  if (catalog) {
    try {
      const fails = runParityCheck(catalog, root)
      if (fails.length > 0) {
        stdout.push('[INV-86] kit catalog parity FAIL')
        for (const f of fails) stdout.push(`  [parity] ${f}`)
        maxSeverity = Math.max(maxSeverity, 1)
      }
    } catch (err) {
      stderr.push(
        `[arbiter kit validate] parity ERROR: ${err instanceof Error ? err.message : String(err)}`,
      )
      maxSeverity = Math.max(maxSeverity, 2)
    }
  }

  // ─── Subcheck 3: redaction (skipped when the maintainer lexicon is unshipped) ─
  const redaction = runRedactionSubcheck(root)
  maxSeverity = Math.max(maxSeverity, redaction.severity)
  stdout.push(...redaction.stdout)
  stderr.push(...redaction.stderr)

  // ─── Summary ──────────────────────────────────────────────────────────────
  if (maxSeverity === 0) {
    stdout.push(
      `[arbiter kit validate] OK (${catalog?.length ?? 0} dims, parity green, no redacted tokens)`,
    )
  }

  return { severity: maxSeverity, stdout, stderr }
}

export function runKitValidate(): void {
  const { severity, stdout, stderr } = computeKitValidation()
  for (const l of stdout) process.stdout.write(`${l}\n`)
  for (const l of stderr) process.stderr.write(`${l}\n`)
  process.exit(severity)
}

/**
 * Experimental-gate enforcement for the `kit` command family (#1151, INV-85/86).
 * Fails closed: if the kit catalog is invalid, parity-broken, or leaks redacted
 * tokens, the gate writes the offending lines and returns a nonzero severity so
 * the caller can exit. Returns 0 (silent) when the kit state is clean.
 */
export function enforceKitGate(): number {
  const { severity, stdout, stderr } = computeKitValidation()
  if (severity === 0) return 0
  for (const l of stdout) process.stderr.write(`${l}\n`)
  for (const l of stderr) process.stderr.write(`${l}\n`)
  process.stderr.write(
    `arbiter: "kit" gate blocked — kit catalog state is invalid (severity ${severity}). ` +
      `Run \`arbiter kit validate\` for details.\n`,
  )
  return severity
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

// ═══════════════════════════════════════════════════════════════════════════
// A9/A10 (#1817): opt-in java/fe kit checks — not wired into `kit install`'s
// mandatory SCAFFOLD pipeline; available on demand via these subcommands.
// ═══════════════════════════════════════════════════════════════════════════

function readMigrationSet(dir: string): MigrationFile[] {
  return walkFiles(dir, { extensions: ['.sql'] }).map((abs) => ({
    name: basename(abs),
    content: readFileSync(abs, 'utf-8'),
  }))
}

function reportFlywayViolations(violations: FlywayViolation[]): void {
  for (const v of violations) {
    process.stdout.write(`  [${v.rule}] ${v.file}: ${v.message}\n`)
  }
}

export interface KitCheckFlywayOptions {
  /** Primary migration set directory (e.g. db/migration). */
  dir: string
  /** Secondary dialect's migration set directory, for dual-set parity (opt-in). */
  secondaryDir?: string
}

/** A9 (opt-in): Flyway migration validator — naming, destructive-DDL, idempotency, dual-set parity. */
export function runKitCheckFlyway(opts: KitCheckFlywayOptions): void {
  const primary = readMigrationSet(opts.dir)
  const secondarySet = opts.secondaryDir ? readMigrationSet(opts.secondaryDir) : undefined
  const violations = validateFlywayMigrations(primary, secondarySet ? { secondarySet } : {})

  if (violations.length === 0) {
    process.stdout.write(
      `[arbiter kit check-flyway] OK (${primary.length} migration file(s), no violations)\n`,
    )
    process.exit(0)
  }

  process.stdout.write(`[arbiter kit check-flyway] FAIL (${violations.length} violation(s)):\n`)
  reportFlywayViolations(violations)
  process.exit(1)
}

export interface KitCheckTestTaxonomyOptions {
  dir: string
  requiredTags?: string[]
}

/** A9 (opt-in): Java test taxonomy count gate — zero untagged @Test files allowed. */
export function runKitCheckTestTaxonomy(opts: KitCheckTestTaxonomyOptions): void {
  const files: JavaTestFile[] = walkFiles(opts.dir, { extensions: ['.java'] })
    .filter((abs) => /(Test|IT|Spec)\.java$/.test(abs))
    .map((abs) => ({ path: abs, content: readFileSync(abs, 'utf-8') }))

  const result = checkJavaTestTaxonomy(
    files,
    opts.requiredTags ? { requiredTags: opts.requiredTags } : {},
  )

  if (isTaxonomyGatePass(result)) {
    process.stdout.write(
      `[arbiter kit check-test-taxonomy] OK (${result.totalFiles} test file(s), all tagged)\n`,
    )
    process.exit(0)
  }

  process.stdout.write(
    `[arbiter kit check-test-taxonomy] FAIL (${result.untaggedFiles.length}/${result.totalFiles} untagged — required: ${result.requiredTags.join(', ')}):\n`,
  )
  for (const f of result.untaggedFiles) process.stdout.write(`  [untagged] ${f}\n`)
  process.exit(1)
}

export interface KitCheckTokenHygieneOptions {
  dirs: string[]
  extensions?: string[]
  allowedColorNames?: string[]
  forbidStyleBlocks?: boolean
  baselinePath?: string
}

function loadHygieneBaseline(baselinePath?: string): TokenHygieneBaseline {
  if (!baselinePath || !existsSync(baselinePath)) return { grandfathered: [] }
  return JSON.parse(readFileSync(baselinePath, 'utf-8')) as TokenHygieneBaseline
}

/** A10 (opt-in): frontend token-hygiene check with baseline + ratchet. */
export function runKitCheckTokenHygiene(opts: KitCheckTokenHygieneOptions): void {
  const extensions = opts.extensions ?? ['.vue']
  const files: HygieneFile[] = opts.dirs
    .flatMap((dir) => walkFiles(dir, { extensions }))
    .map((abs) => ({ path: abs, content: readFileSync(abs, 'utf-8') }))

  const violations = scanTokenHygiene(files, {
    ...(opts.allowedColorNames ? { allowedColorNames: opts.allowedColorNames } : {}),
    ...(opts.forbidStyleBlocks ? { forbidStyleBlocks: opts.forbidStyleBlocks } : {}),
  })

  const baseline = loadHygieneBaseline(opts.baselinePath)
  const { newViolations, tolerated } = applyBaseline(violations, baseline)

  // Ratchet advisory: baseline entries no longer matched by any current violation
  // are fixed debt — surface them so the baseline can only shrink, never ossify.
  const staleBaseline = findStaleBaselineEntries(baseline, violations)
  for (const entry of staleBaseline) {
    process.stdout.write(
      `  [ratchet] baseline entry ${entry.file}:${entry.line} (${entry.pattern}) is fixed — prune it\n`,
    )
  }

  if (isTokenHygieneGatePass(newViolations)) {
    const toleratedNote =
      tolerated.length > 0 ? ` (${tolerated.length} tolerated via baseline)` : ''
    process.stdout.write(
      `[arbiter kit check-token-hygiene] OK (${files.length} file(s) scanned)${toleratedNote}\n`,
    )
    process.exit(0)
  }

  process.stdout.write(
    `[arbiter kit check-token-hygiene] FAIL (${newViolations.length} new violation(s)):\n`,
  )
  for (const v of newViolations) {
    process.stdout.write(`  [${v.rule}] ${v.file}:${v.line}: ${v.snippet}\n`)
  }
  process.exit(1)
}
