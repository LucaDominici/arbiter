// SPDX-License-Identifier: Apache-2.0
// T3 (gold-doc-capability Tranche 3, gold-doc-tranches-t3-t5.md §1) — real per-doc skeleton
// generator, closing H5 ("--generate" only ever wrote a one-line "STUB — fill me in" banner,
// scripts/check-doc-set.mjs `stubFor()`). This file is the "one resolution engine" doctrine's
// consumer, not a second engine: it shells scripts/check-doc-set.mjs (via the existing thin
// wrapper `runDocSet`, src/commands/doc-set.ts) for ALL presence/tiers/overlay resolution, and
// only decides WHICH skeleton template (the manifest's dormant `template:` field) satisfies a
// reported gap, then writes it through the standard writeFile/renderTemplate primitives — the
// same pattern src/generators/docs.ts and gold-kit.ts already use (check-no-direct-fs-in-
// generators.mjs compliance: existsSync/readFileSync are read-only, never guarded).
import { basename, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { renderTemplate } from '../utils/render.js'
import { runDocSet } from '../commands/doc-set.js'
import type { WriteResult } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { DocSetPayload } from '../commands/doc-set.js'

/**
 * Minimal shape the generator needs. A full `ProjectConfig` (the registry.ts pipeline, `init`/
 * `update`/`diff`) satisfies it structurally; the standalone `arbiter doc-set --plan/--apply` CLI
 * path (no wizard run) builds a bare `{ targetDir, projectName }` literal instead — `object`-typed
 * `renderTemplate` doesn't require the rest of `ProjectConfig`, so nothing is faked to satisfy it.
 */
export type DocSetGenConfig = Pick<ProjectConfig, 'targetDir'> & Partial<ProjectConfig>

type TierColumn = DocSetPayload['tierColumn']

/**
 * One skeleton-template id -> its EJS source(s). A `string` is tier-invariant; a per-column
 * record right-sizes the body (gold-doc-tranches-t3-t5.md §1.2b table) — the SAME resolved
 * `tierColumn` the engine already computed, never re-derived here (no second tier axis).
 * `targetOverride` exists for the one dir/glob row (ADR): `check.path` is a directory
 * (`docs/ADR`), not the file to scaffold, so the catalog entry carries the real target.
 */
interface CatalogEntry {
  variants: string | Record<TierColumn, string>
  targetOverride?: string
}

/**
 * The dormant `template:` manifest field is always a plain catalog-id string (e.g. `arc42`); the
 * per-tier split (when the design table calls for one) lives HERE, in the catalog, not in the
 * manifest YAML — keeps the manifest declarative ("this row needs an arc42 doc") and the
 * generator authoritative for "which arc42 body a given tier gets".
 */
const SKELETON_CATALOG: Record<string, CatalogEntry> = {
  arc42: {
    variants: {
      solo: 'docs/skeletons/arc42-canvas.md.ejs',
      small: 'docs/skeletons/arc42-canvas.md.ejs',
      enterprise: 'docs/skeletons/arc42-full.md.ejs',
    },
  },
  // Reuses the existing ADR template verbatim (docs.ts already emits it at init-time under
  // docs/adr/); the gold-doc-set manifest's ADR row targets uppercase docs/ADR/ — same content,
  // the canonical location the presence check's glob/adr:true recognize.
  'adr-seed': {
    variants: 'docs/adr/ADR-000_template.md.ejs',
    targetOverride: 'docs/ADR/ADR-000_template.md',
  },
  slo: { variants: 'docs/skeletons/slo.md.ejs' },
  'threat-model': {
    variants: {
      solo: 'docs/skeletons/threat-model-4q.md.ejs',
      small: 'docs/skeletons/threat-model-4q.md.ejs',
      enterprise: 'docs/skeletons/threat-model-stride.md.ejs',
    },
  },
  'er-model': { variants: 'docs/skeletons/er-model.md.ejs' },
  glossary: { variants: 'docs/skeletons/glossary.md.ejs' },
  'test-strategy': { variants: 'docs/skeletons/test-strategy.md.ejs' },
  governance: { variants: 'docs/skeletons/governance.md.ejs' },
  'technical-debt': { variants: 'docs/skeletons/technical-debt.md.ejs' },
  // #2036: blocked-project-decision register (D-NN), tracked by the gold-doc-set
  // manifest row `DECISION_REGISTRY.md` (accept_any COSTITUZIONE.md for
  // haben-style adoption). Existing Code Survey: no decision-registry template
  // existed (haben's COSTITUZIONE.md is a hand-built consumer file, not in this
  // repo) — new file justified.
  'decision-registry': { variants: 'docs/skeletons/decision-registry.md.ejs' },
}

function resolveTemplatePath(entry: CatalogEntry, column: TierColumn): string {
  return typeof entry.variants === 'string' ? entry.variants : entry.variants[column]
}

/**
 * Conforming frontmatter for every skeleton (title/doc_version/status/last_review/owner/
 * canonical_id/tags/related) — the same shape `stubFor()` emits for docs/*.md
 * (scripts/check-doc-set.mjs), so check-doc-style.mjs and the T4 freshness gate grade a skeleton
 * from birth. Centralized here (not duplicated per .ejs) so there is one place that can drift.
 */
function frontmatter(title: string, today: string): string {
  return [
    '---',
    `title: '${title}'`,
    "doc_version: '0.1.0'",
    'status: draft',
    `last_review: '${today}'`,
    "owner: ''",
    "canonical_id: ''",
    "tags: ['audience/dev', 'kind/reference']",
    'related: []',
    '---',
    '',
  ].join('\n')
}

/**
 * Mirrors `stubFor()`'s docs/*.md output (scripts/check-doc-set.mjs) — used ONLY to detect an
 * untouched engine-scaffolded banner stub, never to compute presence (that stays the engine's
 * job). The `last_review` date is normalized to a fixed sentinel on BOTH sides before comparing so a
 * banner scaffolded on an earlier day still upgrades today (mirrors the intent of the engine's
 * own `--refresh-stubs`, which is same-day-only) — every other byte, including the whole body,
 * must match exactly, so a single hand-edited character anywhere withholds the upgrade.
 */
function bannerStubFingerprint(path: string, purpose: string | undefined): string {
  const title = basename(path).replace(/\.md$/, '')
  const banner =
    `> **STUB — fill me in.** Scaffolded by \`check-doc-set --generate\` to satisfy the gold doc-set. ${purpose ?? ''}`.trim()
  return [frontmatter(title, '<DATE>'), `# ${title}`, '', banner, ''].join('\n')
}

function isUntouchedBannerStub(disk: string, path: string, purpose: string | undefined): boolean {
  const normalizedDisk = disk.replace(/^last_review: '.*'$/m, "last_review: '<DATE>'")
  return normalizedDisk === bannerStubFingerprint(path, purpose)
}

export interface ScaffoldReport {
  path: string
  template: string
  action: WriteResult['action']
}

export interface DocSetSkeletonsResult {
  files: WriteResult[]
  /** Per-file detail (template id + action) for `--plan`/`--apply` human reporting. */
  scaffolded: ScaffoldReport[]
  /** §1.2(b): rows with a `missing[]` entry but no catalog binding — reported, never guessed. */
  unbound: string[]
  /** Effective tier column the engine resolved this run (undefined when the engine SKIPped). */
  tierColumn?: TierColumn
}

interface TaggedRow {
  path: string
  template?: string
  purpose?: string
  isMissing: boolean
}

interface RowContext {
  repo: string
  config: DocSetGenConfig
  projectName: string
  today: string
  tierColumn: TierColumn
  dryRun: boolean
}

/**
 * Resolve + (maybe) write ONE row. Extracted from {@link generateDocSetSkeletons} to keep that
 * function's cyclomatic complexity within the lint ceiling (CANON-22, mirrors
 * src/generators/docs.ts `emitSpecKitFamilies`) — this is where §1.2(c)'s banner-upgrade
 * decision table lives:
 *   missing + target absent                    -> create (skipIfExists is a no-op there)
 *   missing + target exists, untouched stub     -> upgrade (the ADR override-target edge case)
 *   missing + target exists, real content       -> withheld (never touched, no entry)
 *   present + untouched stub                    -> upgrade
 *   present + real/unknown content               -> withheld (never touched, no entry)
 * Returns null for "never touched" (no side effect, no report entry) and for an unbound row
 * (caller records it in `unbound[]` instead).
 */
function scaffoldRow(
  item: TaggedRow,
  entry: CatalogEntry,
  ctx: RowContext,
): { result: WriteResult; targetRel: string } | null {
  const templatePath = resolveTemplatePath(entry, ctx.tierColumn)
  const targetRel = entry.targetOverride ?? item.path
  const targetAbs = resolvedPath(ctx.repo, targetRel)
  const diskExists = existsSync(targetAbs)
  const bannerDetected =
    item.path.endsWith('.md') &&
    diskExists &&
    isUntouchedBannerStub(readFileSync(targetAbs, 'utf-8'), item.path, item.purpose)

  const shouldWrite = bannerDetected || (item.isMissing && !diskExists)
  if (!shouldWrite) return null // present-real, or missing-but-override-target-taken -> withheld

  const title = basename(targetRel).replace(/\.md$/, '')
  const body = renderTemplate(templatePath, {
    ...ctx.config,
    projectName: ctx.projectName,
    title,
    today: ctx.today,
  })
  const rendered = templatePath.startsWith('docs/skeletons/')
    ? frontmatter(title, ctx.today) + body
    : body

  const result = writeFile(targetAbs, rendered, {
    skipIfExists: !bannerDetected,
    dryRun: ctx.dryRun,
  })
  return { result, targetRel }
}

/**
 * Generate real per-doc-type skeletons for every gap the engine reports, right-sized by tier.
 * Registered in registry.ts (key `doc-set-skeletons`) for the init/update/diff pipeline; also
 * invoked standalone by `arbiter doc-set --plan/--apply` via {@link runDocSetPlanApply} below.
 */
export function generateDocSetSkeletons(
  config: DocSetGenConfig,
  opts: { dryRun: boolean; manifest?: string; profile?: string } = { dryRun: false },
): DocSetSkeletonsResult {
  const files: WriteResult[] = []
  const scaffolded: ScaffoldReport[] = []
  const unbound: string[] = []
  const repo = config.targetDir

  const { payload } = runDocSet({
    repo,
    json: true,
    quiet: true,
    ...(opts.manifest !== undefined ? { manifest: opts.manifest } : {}),
    ...(opts.profile !== undefined ? { profile: opts.profile } : {}),
  })
  // §1.2(e) dry-run edge: a fresh `init --dry-run` has no manifest on disk yet, so the engine
  // SKIPs (plain-text, not JSON) and `payload` is null — honest no-op, not a phantom plan.
  if (!payload) return { files, scaffolded, unbound }

  const ctx: RowContext = {
    repo,
    config,
    projectName: config.projectName ?? basename(resolve(repo)),
    today: new Date().toISOString().slice(0, 10),
    tierColumn: payload.tierColumn,
    dryRun: opts.dryRun,
  }

  // Presence is content-blind (a file merely existing satisfies the engine's check) — an
  // untouched `--generate` banner stub is "present", not "missing", so the banner-upgrade path
  // (§1.2c) must also walk `present[]`, not only `missing[]`.
  const rows: TaggedRow[] = [
    ...(payload.missing ?? []).map((m) => ({ ...m, isMissing: true })),
    ...(payload.present ?? []).map((p) => ({ ...p, isMissing: false })),
  ]

  for (const item of rows) {
    const entry = item.template ? SKELETON_CATALOG[item.template] : undefined
    if (!entry) {
      if (item.isMissing) unbound.push(item.path)
      continue
    }
    const scaffoldedRow = scaffoldRow(item, entry, ctx)
    if (!scaffoldedRow) continue
    files.push(scaffoldedRow.result)
    scaffolded.push({
      path: scaffoldedRow.targetRel,
      template: item.template as string,
      action: scaffoldedRow.result.action,
    })
  }

  return { files, scaffolded, unbound, tierColumn: payload.tierColumn }
}

export interface DocSetPlanApplyOptions {
  repo?: string
  apply?: boolean
  manifest?: string
  profile?: string
}

/**
 * CLI-facing entry point for `arbiter doc-set --plan/--apply` (src/cli.ts). Builds the minimal
 * config {@link generateDocSetSkeletons} needs standalone (no wizard `ProjectConfig` exists
 * outside `init`/`update`/`diff`) and forwards `--apply` as `dryRun: false` — `--plan` is the
 * default (dryRun: true), matching the engine's own advisory-by-default posture.
 */
export function runDocSetPlanApply(opts: DocSetPlanApplyOptions = {}): DocSetSkeletonsResult {
  const repo = opts.repo ? resolve(opts.repo) : process.cwd()
  const config: DocSetGenConfig = { targetDir: repo, projectName: basename(repo) }
  return generateDocSetSkeletons(config, {
    dryRun: !opts.apply,
    ...(opts.manifest !== undefined ? { manifest: opts.manifest } : {}),
    ...(opts.profile !== undefined ? { profile: opts.profile } : {}),
  })
}
