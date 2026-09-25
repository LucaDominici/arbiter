// SPDX-License-Identifier: Apache-2.0
//
// Deterministic /ship tier widening (#2180): optional metadata may widen, never narrow.
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { runCli, runCliJson } from '../utils/run-cli.js'
import { readFileTranslated } from '../utils/fs.js'

type ShipTier = 'XS' | 'S' | 'Standard'
type ModelCapability = 'economy' | 'capable' | 'frontier'
type ShipExecutionOutcome =
  'new-risk' | 'no-progress' | 'timeout' | 'oom' | 'rate-limit' | 'tool-unavailable' | 'ci-queue'
export type { ShipTier, ShipExecutionOutcome }
type ReviewVertical =
  | 'domain'
  | 'type-safety'
  | 'test-quality'
  | 'security'
  | 'data-integrity'
  | 'concurrency'
  | 'money'
  | 'migration'
  | 'deployment'

export interface TierSignals {
  /** Distinct dependent files; null when the optional graph signal is unavailable. */
  blastRadius: number | null
  /** Lowercased issue labels; empty when the optional issue-metadata signal is unavailable. */
  labels: readonly string[]
  /** Whether the issue belongs to a GitHub milestone bundle. */
  milestoneBundled: boolean
  /** Complete, fresh inputs are required before XS/S may be selected. */
  complete?: boolean
  /** Complete planned or actual changed-file set used by the treatment. */
  changedFiles?: readonly string[]
  /** Directional callers outside changedFiles; null means unknown. */
  callerCount?: number | null
  executionOutcome?: ShipExecutionOutcome
}

export interface ShipTreatment {
  version: 1
  requestedTier: ShipTier
  tier: ShipTier
  sensitive: boolean
  planDepth: 'minimal' | 'brief' | 'full'
  finalReviewers: 1 | 2 | 3
  acceptanceFitReviewers: 1
  reviewerVerticals: ReviewVertical[]
  modelCapability: ModelCapability
  qualifiedNarrow: boolean
  signalsHash: string
  reasons: string[]
}

const SHIP_TIERS = new Set<ShipTier>(['XS', 'S', 'Standard'])
const PLAN_DEPTHS = new Set<ShipTreatment['planDepth']>(['minimal', 'brief', 'full'])
const MODEL_CAPABILITIES = new Set<ModelCapability>(['economy', 'capable', 'frontier'])
const REVIEW_VERTICALS = new Set<ReviewVertical>([
  'domain',
  'type-safety',
  'test-quality',
  'security',
  'data-integrity',
  'concurrency',
  'money',
  'migration',
  'deployment',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isIntegerIn(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
}

function isUniqueVerticalList(value: unknown, expected: unknown): value is ReviewVertical[] {
  if (!Array.isArray(value) || value.length !== expected) return false
  if (!value.every((vertical) => REVIEW_VERTICALS.has(vertical as ReviewVertical))) return false
  return new Set(value).size === value.length
}

function isReasonList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((reason) => typeof reason === 'string' && reason.length > 0)
  )
}

/** Validate the persisted treatment before any delivery guard trusts it. */
export function isShipTreatment(value: unknown): value is ShipTreatment {
  if (!isRecord(value) || Array.isArray(value)) return false
  return [
    value.version === 1,
    SHIP_TIERS.has(value.requestedTier as ShipTier),
    SHIP_TIERS.has(value.tier as ShipTier),
    typeof value.sensitive === 'boolean',
    PLAN_DEPTHS.has(value.planDepth as ShipTreatment['planDepth']),
    isIntegerIn(value.finalReviewers, 1, 3),
    value.acceptanceFitReviewers === 1,
    isUniqueVerticalList(value.reviewerVerticals, value.finalReviewers),
    MODEL_CAPABILITIES.has(value.modelCapability as ModelCapability),
    typeof value.qualifiedNarrow === 'boolean',
    typeof value.signalsHash === 'string' && /^[0-9a-f]{64}$/.test(value.signalsHash),
    isReasonList(value.reasons),
  ].every(Boolean)
}

const TIER_RANK: Record<ShipTier, number> = { XS: 0, S: 1, Standard: 2 }
const WAVE_OR_EPIC = /^(?:wave|epic)(?:\/.*)?$/i
const GRAPH_MAX_BYTES = 256 * 1024 * 1024
const ALLOWED_RELATIONS = new Set([
  'imports',
  'imports_from',
  'calls',
  'references',
  're_exports',
  'implements',
  'inherits',
  'extends',
  'uses',
  'depends_on',
])

// #2180 calibration on this repo: leaf test=4, small generator=20, task-ship.ts=30,
// cli.ts=78, catalog.ts=116, registry.ts=236, and #1730's M-sized plan manifest=679.
const BLAST_RADIUS_S = 25
const BLAST_RADIUS_STANDARD = 75

export function normTier(tier: string | undefined): ShipTier {
  if (tier === 'XS' || tier === 'S') return tier
  return 'Standard'
}

/** Return the highest deterministic floor; signals are intentionally unable to narrow a tier. */
export function widenTier(base: ShipTier, signals: TierSignals): ShipTier {
  let result = base
  const widenTo = (floor: ShipTier): void => {
    if (TIER_RANK[floor] > TIER_RANK[result]) result = floor
  }

  if (signals.labels.some((label) => WAVE_OR_EPIC.test(label))) {
    widenTo('Standard')
  }

  const blastRadius = signals.blastRadius
  if (typeof blastRadius === 'number' && Number.isFinite(blastRadius) && blastRadius >= 0) {
    if (blastRadius >= BLAST_RADIUS_STANDARD) widenTo('Standard')
    else if (blastRadius >= BLAST_RADIUS_S) widenTo('S')
  }
  return result
}

const CORE_PATH =
  /^(?:src\/cli\.ts|src\/commands\/(?:task|task-ship|ship-tier|ship-review|ship-train)\.ts|src\/config\/schema\.ts|scripts\/check-all\.mjs|\.githooks\/|\.github\/)/

const SENSITIVE_PATHS: readonly [RegExp, ReviewVertical][] = [
  [/(^|\/)(?:auth|authz|crypto|secrets?)(\/|$)|(^|\/)\.env[^/]*$|\.(?:pem|key)$/i, 'security'],
  [/(^|\/)(?:migrations?)(\/|$)|\.sql$/i, 'migration'],
  [/(^|\/)(?:billing|payments?|money)(\/|$)/i, 'money'],
  [/(?:^|\/)(?:locks?|mutex|concurrenc)(?:y|ies)?(?:\/|\.|-)|gate-mutex/i, 'concurrency'],
  [/^(?:\.github\/|Dockerfile$|docker\/|deploy\/|release\/)/i, 'deployment'],
]

// #2890 — path classes the premortem decision keys off. Paths and treatment only, never file
// contents (AC-2890.3).
const HOOK_PATH = /(?:^|\/)hooks\//
const TEMPLATE_EJS = /^src\/templates\/.*\.ejs$/
const BAKE_SNAP = /__snapshots__\//
const WORKFLOW_PATH = /^\.github\/workflows\//
const SRC_PATH = /^src\//

// #2895 — prose the graph never indexes (AST-only), any path, not just the repo root. Narrower
// than the documentation-only routing check below on purpose: `docs/*.ts` is still code.
const GRAPH_UNINDEXED_PATH = /\.md$/

function isGraphUnindexed(file: string): boolean {
  return GRAPH_UNINDEXED_PATH.test(file)
}

interface PremortemDecision {
  decision: 'required' | 'deterministic' | 'skip-llm'
  reason: string
  areas: number
  hooks: boolean
  templates: boolean
  workflows: boolean
  sensitive: boolean
  tier: ShipTier
  checklist?: true
}

/**
 * #2890 AC-2 — six ordered rules over the plan manifest + resolved ship treatment, deciding
 * whether the (costly, $11-17/run) LLM premortem is required, runs on the deterministic CI-infra
 * checklist instead, or is skipped entirely for a consumer-only XS/S delivery.
 *
 * Rule order is force > hooks/templates > workflows > sensitive > standard-multi-area >
 * consumer-xs > default. AC-2 lists the consumer-xs skip as rule (1) and workflows as rule (5)
 * after sensitive as rule (3); both are evaluated earlier here on purpose (premortem brief §1):
 * `.github/workflows/**` always matches the `deployment` SENSITIVE_PATHS entry, so sensitive
 * must be checked after workflows or rule 5 is unreachable (the brief's recommended order); and
 * hooks/templates/workflows must be checked before the consumer-xs skip or an XS plan that only
 * touches `__snapshots__/` or `packages/kernel/hooks/` would wrongly skip the premortem.
 */
type PremortemBase = Omit<PremortemDecision, 'decision' | 'reason' | 'checklist'>

function premortemBase(files: readonly string[], treatment: ShipTreatment): PremortemBase {
  const hooks = files.some((file) => HOOK_PATH.test(file))
  const templates = files.some((file) => TEMPLATE_EJS.test(file) || BAKE_SNAP.test(file))
  const workflows = files.some((file) => WORKFLOW_PATH.test(file))
  const areas = new Set(files.map((file) => file.split('/').slice(0, 2).join('/'))).size
  return {
    areas,
    hooks,
    templates,
    workflows,
    sensitive: treatment.sensitive,
    tier: treatment.tier,
  }
}

/** Rules force → hooks/templates → workflows → sensitive — split out to hold complexity ≤10. */
function earlyPremortemRule(base: PremortemBase, force: boolean): PremortemDecision | null {
  if (force) return { decision: 'required', reason: 'forced', ...base }
  if (base.hooks || base.templates) {
    return { decision: 'required', reason: 'R1-hooks-templates', ...base }
  }
  if (base.workflows)
    return { decision: 'deterministic', reason: 'R8-ci-infra', checklist: true, ...base }
  if (base.sensitive) return { decision: 'required', reason: 'R4-sensitive', ...base }
  return null
}

function evaluatePremortem(
  files: readonly string[],
  treatment: ShipTreatment | undefined,
  opts: { force?: boolean } = {},
): PremortemDecision {
  if (!treatment) {
    return {
      decision: 'required',
      reason: 'R7-no-treatment',
      areas: 0,
      hooks: false,
      templates: false,
      workflows: false,
      sensitive: false,
      tier: 'Standard',
    }
  }
  const base = premortemBase(files, treatment)
  const early = earlyPremortemRule(base, opts.force === true)
  if (early) return early
  const small = treatment.tier !== 'Standard'
  if (!small && base.areas >= 2)
    return { decision: 'required', reason: 'R3-standard-multi-area', ...base }
  // Fail-closed (premortem brief §3): an unreadable/empty manifest must never resolve skip-llm.
  if (files.length === 0) return { decision: 'required', reason: 'R7-empty-manifest', ...base }
  if (small && !files.some((file) => SRC_PATH.test(file))) {
    return { decision: 'skip-llm', reason: 'R5-consumer-xs', ...base }
  }
  return { decision: 'deterministic', reason: 'R6-default', ...base }
}

/**
 * #2890 AC-3 — the plan's `premortem:` frontmatter value, or a manifest path matching
 * `PREMORTEM_*`. Extraction only (no existence/content check); the caller validates the
 * reference fail-closed.
 */
function parsePremortemRef(plan: string, manifest: readonly string[]): string | null {
  const frontMatter = plan.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  const declared = frontMatter?.match(/^premortem:\s*(\S.*?)\s*$/m)?.[1]
  if (declared !== undefined) return declared
  return manifest.find((file) => /(^|\/)PREMORTEM_[^/]*$/.test(file)) ?? null
}

// Bundled on one line to hold publicApiSurface net-zero (#2890 premortem brief §1 export budget):
// readPlanManifest (defined below) is otherwise module-local.
export { evaluatePremortem, parsePremortemRef, readPlanManifest, type PremortemDecision }

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function relevantVerticals(files: readonly string[]): ReviewVertical[] {
  if (files.length === 0) return ['domain']
  const sensitive = SENSITIVE_PATHS.flatMap(([pattern, vertical]) =>
    files.some((file) => pattern.test(file)) ? [vertical] : [],
  )
  if (sensitive.length > 0) return unique(sensitive)
  if (files.every((file) => /(?:^|\/)(?:__tests__|tests?)\//.test(file))) return ['test-quality']
  if (files.some((file) => /(?:schema|types?|api|contract)/i.test(file))) return ['type-safety']
  return ['domain']
}

function treatmentVerticals(relevant: readonly ReviewVertical[]): ReviewVertical[] {
  const specialists = relevant.filter((vertical) =>
    ['security', 'data-integrity', 'concurrency', 'money', 'migration', 'deployment'].includes(
      vertical,
    ),
  )
  if (specialists.length > 0) return unique(specialists).slice(0, 3)
  return [relevant.find((vertical) => vertical !== 'test-quality') ?? relevant[0] ?? 'domain']
}

const MODEL_RANK: Record<ModelCapability, number> = { economy: 0, capable: 1, frontier: 2 }

function maxModel(a: ModelCapability, b: ModelCapability): ModelCapability {
  return MODEL_RANK[a] >= MODEL_RANK[b] ? a : b
}

function nextModel(model: ModelCapability): ModelCapability {
  return model === 'economy' ? 'capable' : 'frontier'
}

function hasCompleteQualification(signals: TierSignals, changedFiles: readonly string[]): boolean {
  const values = [signals.callerCount, signals.blastRadius]
  return (
    signals.complete === true &&
    changedFiles.length > 0 &&
    values.every(
      (value) =>
        typeof value === 'number' &&
        Number.isInteger(value) &&
        Number.isFinite(value) &&
        value >= 0,
    )
  )
}

function qualifiedTier(
  initial: ShipTier,
  signals: TierSignals,
  changedFiles: readonly string[],
  reasons: string[],
): ShipTier {
  let tier = initial
  if (changedFiles.some((file) => CORE_PATH.test(file))) {
    tier = 'Standard'
    reasons.push('core delivery or authority path changed')
  }
  if (Number(signals.callerCount) > 1 && tier === 'XS') {
    tier = 'S'
    reasons.push('more than one directional caller')
  }
  if (Number(signals.callerCount) > 5) {
    tier = 'Standard'
    reasons.push('more than five directional callers')
  }
  return tier
}

function resolvedTier(
  requested: ShipTier,
  signals: TierSignals,
  changedFiles: readonly string[],
  previous: ShipTreatment | undefined,
  reasons: string[],
): ShipTier {
  const complete = hasCompleteQualification(signals, changedFiles)
  let tier = widenTier(requested, signals)
  if (requested !== 'Standard' && !complete) {
    tier = 'Standard'
    reasons.push('narrow treatment refused: qualification inputs are incomplete or stale')
  }
  if (complete) tier = qualifiedTier(tier, signals, changedFiles, reasons)
  if (signals.labels.some((label) => WAVE_OR_EPIC.test(label))) reasons.push('wave or epic scope')
  if (previous !== undefined && TIER_RANK[previous.tier] > TIER_RANK[tier]) {
    reasons.push('preserved prior widening')
    return previous.tier
  }
  return tier
}

function resolvedModel(
  tier: ShipTier,
  sensitive: boolean,
  outcome: ShipExecutionOutcome | undefined,
  previous: ShipTreatment | undefined,
  reasons: string[],
): ModelCapability {
  const baseline = sensitive ? 'frontier' : tier === 'Standard' ? 'capable' : 'economy'
  const model = maxModel(previous?.modelCapability ?? 'economy', baseline)
  if (outcome === 'new-risk') {
    reasons.push('model escalated after a new material risk')
    return nextModel(model)
  }
  if (
    outcome === 'no-progress' ||
    previous?.reasons.some((reason) => reason.startsWith('BLOCKED:')) === true
  ) {
    reasons.push('BLOCKED: the current implementation approach made no progress')
  } else if (outcome !== undefined) {
    reasons.push(`infrastructure state: ${outcome}; model unchanged`)
  }
  return model
}

function treatmentReview(
  initialTier: ShipTier,
  previous: ShipTreatment | undefined,
  changedFiles: readonly string[],
): { tier: ShipTier; sensitive: boolean; reviewerVerticals: ReviewVertical[] } {
  const relevant = unique([
    ...(previous?.reviewerVerticals ?? []),
    ...relevantVerticals(changedFiles),
  ])
  const sensitive =
    previous?.sensitive === true ||
    relevant.some((vertical) =>
      ['security', 'data-integrity', 'concurrency', 'money', 'migration', 'deployment'].includes(
        vertical,
      ),
    )
  const tier = sensitive ? 'Standard' : initialTier
  return { tier, sensitive, reviewerVerticals: treatmentVerticals(relevant) }
}

/**
 * Resolve the one delivery treatment consumed by /ship and lifecycle gates.
 * A narrow request is only a candidate: incomplete evidence always resolves to Standard.
 */
export function resolveShipTreatment(
  requested: string | undefined,
  signals: TierSignals,
  previous?: ShipTreatment,
): ShipTreatment {
  const requestedTier = normTier(requested)
  const changedFiles = unique(signals.changedFiles ?? []).sort()
  const complete = hasCompleteQualification(signals, changedFiles)
  const reasons: string[] = []
  let tier = resolvedTier(requestedTier, signals, changedFiles, previous, reasons)
  const review = treatmentReview(tier, previous, changedFiles)
  tier = review.tier
  const { sensitive, reviewerVerticals } = review
  const finalReviewers = reviewerVerticals.length as 1 | 2 | 3
  const modelCapability = resolvedModel(
    tier,
    sensitive,
    signals.executionOutcome,
    previous,
    reasons,
  )
  const reviewContract = {
    tier,
    sensitive,
    finalReviewers,
    reviewerVerticals,
    modelCapability,
  }

  return {
    version: 1,
    requestedTier,
    tier,
    sensitive,
    planDepth: tier === 'XS' ? 'minimal' : tier === 'S' ? 'brief' : 'full',
    finalReviewers,
    acceptanceFitReviewers: 1,
    reviewerVerticals,
    modelCapability,
    qualifiedNarrow: tier !== 'Standard' && complete,
    signalsHash: createHash('sha256').update(JSON.stringify(reviewContract)).digest('hex'),
    reasons: unique(
      reasons.length > 0
        ? reasons
        : [
            complete
              ? 'complete affirmative qualification'
              : 'Standard treatment selected without narrow qualification',
          ],
    ),
  }
}

/**
 * Collect optional, deterministic routing signals. Every unavailable or malformed source becomes
 * its neutral value so /ship retains its existing fail-safe tier behaviour.
 */
export function gatherTierSignals(
  root: string,
  taskId: string | undefined,
  planPath?: string,
): TierSignals {
  try {
    const issue = gatherIssueSignals(root, taskId)
    const manifest = readPlanManifest(root, planPath)
    if (manifest === null) {
      return {
        ...issue,
        blastRadius: null,
        callerCount: null,
        changedFiles: [],
        complete: false,
      }
    }
    const actual = gatherActualChangedFiles(root)
    const planned = actual !== null && [...actual].every((file) => manifest.has(file))
    const changedFiles = unique([...manifest, ...(actual ?? [])]).sort()
    const candidates = new Set(changedFiles)
    const documentationOnly = changedFiles.every((file) => /^(?:docs\/|[^/]+\.md$)/.test(file))
    const graphCandidates = new Set([...candidates].filter((file) => !isGraphUnindexed(file)))
    const graph = documentationOnly
      ? { blastRadius: 0, callerCount: 0, complete: true }
      : gatherGraphSignals(root, graphCandidates)
    return {
      ...issue,
      ...graph,
      changedFiles,
      complete: issue.available && graph.complete && planned,
    }
    // FAIL-OPEN-INTENT: errors become incomplete qualification, which forces Standard.
  } catch {
    return {
      blastRadius: null,
      callerCount: null,
      changedFiles: [],
      complete: false,
      labels: [],
      milestoneBundled: false,
    }
  }
}

function gatherActualChangedFiles(root: string): Set<string> | null {
  try {
    const files = new Set<string>()
    const commands = [
      ['diff', '--name-only', '--no-renames', 'origin/main...HEAD'],
      ['diff', '--name-only', '--no-renames'],
      ['diff', '--cached', '--name-only', '--no-renames'],
      ['ls-files', '--others', '--exclude-standard'],
    ]
    for (const args of commands) {
      for (const file of runCli('git', args, { cwd: root, timeoutMs: 10_000 }).stdout.split(
        /\r?\n/,
      )) {
        if (file.length > 0 && isRepoRelativePosixPath(file)) files.add(file)
      }
    }
    return files
    // FAIL-OPEN-INTENT: errors return null, which makes narrow qualification fail closed.
  } catch {
    return null
  }
}

function gatherIssueSignals(
  root: string,
  taskId: string | undefined,
): Pick<TierSignals, 'labels' | 'milestoneBundled'> & { available: boolean } {
  const issueNumber = taskId?.replace(/^#/, '')
  if (issueNumber === undefined || !/^\d+$/.test(issueNumber)) {
    return { labels: [], milestoneBundled: false, available: false }
  }
  try {
    const response = runCliJson(
      'gh',
      ['issue', 'view', issueNumber, '--json', 'labels,milestone'],
      { cwd: root, timeoutMs: 10_000 },
    )
    if (!isIssueResponse(response)) return { labels: [], milestoneBundled: false, available: false }
    return {
      labels: response.labels.map((label) => label.name.toLowerCase()),
      milestoneBundled: response.milestone !== null,
      available: true,
    }
    // FAIL-OPEN-INTENT: `gh issue view` is optional and offline/unauthenticated hosts are expected; no labels means no widening signal, never a narrower tier.
  } catch {
    return { labels: [], milestoneBundled: false, available: false }
  }
}

function gatherGraphSignals(
  root: string,
  manifest: ReadonlySet<string>,
): { blastRadius: number | null; callerCount: number | null; complete: boolean } {
  try {
    const graphPath = join(root, 'graphify-out', 'graph.json')
    if (!existsSync(graphPath)) return { blastRadius: null, callerCount: null, complete: false }
    const graphStat = statSync(graphPath)
    if (graphStat.size > GRAPH_MAX_BYTES)
      return { blastRadius: null, callerCount: null, complete: false }
    for (const file of manifest) {
      const path = join(root, file)
      if (existsSync(path) && graphStat.mtimeMs < statSync(path).mtimeMs) {
        return { blastRadius: null, callerCount: null, complete: false }
      }
    }

    return graphSignals(JSON.parse(readFileTranslated(graphPath, 'utf-8')) as unknown, manifest)
    // FAIL-OPEN-INTENT: errors return incomplete graph evidence, which forces Standard.
  } catch {
    return { blastRadius: null, callerCount: null, complete: false }
  }
}

function readPlanManifest(root: string, plan: string | undefined): Set<string> | null {
  if (typeof plan !== 'string' || !isRepoRelativePosixPath(plan)) return null
  try {
    const files = parsePlanFilesManifest(readFileTranslated(join(root, plan), 'utf-8'))
    return files === null || files.length === 0 ? null : new Set(files)
    // FAIL-OPEN-INTENT: unreadable plans return no manifest, which forces Standard.
  } catch {
    return null
  }
}

function parsePlanFilesManifest(plan: string): string[] | null {
  const frontMatter = plan.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  if (frontMatter === undefined) return null
  const lines = frontMatter.split(/\r?\n/)
  const filesIndex = lines.findIndex((line) => /^files:\s*$/.test(line))
  if (filesIndex === -1) return null
  const files: string[] = []
  for (const line of lines.slice(filesIndex + 1)) {
    if (/^[A-Za-z][A-Za-z0-9_-]*:\s*/.test(line)) break
    if (line.trim() === '') continue
    const match = line.match(/^\s+-\s+(.+?)\s*$/)
    const file = match?.[1]
    if (file === undefined || !isRepoRelativePosixPath(file)) return null
    files.push(file)
  }
  return files
}

function graphSignals(
  graph: unknown,
  manifest: ReadonlySet<string>,
): { blastRadius: number | null; callerCount: number | null; complete: boolean } {
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    return { blastRadius: null, callerCount: null, complete: false }
  }
  const sourceFiles = graphNodeSourceFiles(graph.nodes)
  const covered = new Set(sourceFiles.values())
  if ([...manifest].some((file) => !covered.has(file))) {
    return { blastRadius: null, callerCount: null, complete: false }
  }

  const dependents = new Set<string>()
  const callers = new Set<string>()
  for (const link of graph.links) {
    if (!isGraphLink(link)) {
      return { blastRadius: null, callerCount: null, complete: false }
    }
    const { source, target, relation } = link
    const sourceFile = sourceFiles.get(source)
    const targetFile = sourceFiles.get(target)
    if (sourceFile === undefined || targetFile === undefined) {
      return { blastRadius: null, callerCount: null, complete: false }
    }
    if (ALLOWED_RELATIONS.has(relation)) {
      addRelatedFiles(manifest, dependents, callers, [sourceFile, targetFile])
    }
  }
  return { blastRadius: dependents.size, callerCount: callers.size, complete: true }
}

function isGraphLink(
  value: unknown,
): value is { source: string; target: string; relation: string } {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    typeof value.target === 'string' &&
    typeof value.relation === 'string'
  )
}

function graphNodeSourceFiles(nodes: unknown[]): Map<string, string> {
  const sourceFiles = new Map<string, string>()
  for (const node of nodes) {
    if (isGraphNode(node)) sourceFiles.set(node.id, node.source_file)
  }
  return sourceFiles
}

function isGraphNode(value: unknown): value is { id: string; source_file: string } {
  return isRecord(value) && typeof value.id === 'string' && typeof value.source_file === 'string'
}

function addRelatedFiles(
  manifest: ReadonlySet<string>,
  dependents: Set<string>,
  callers: Set<string>,
  [source, target]: readonly [string, string],
): void {
  if (manifest.has(source) && !manifest.has(target)) dependents.add(target)
  if (manifest.has(target) && !manifest.has(source)) {
    dependents.add(source)
    callers.add(source)
  }
}

function isIssueResponse(value: unknown): value is {
  labels: { name: string }[]
  milestone: unknown
} {
  return (
    isRecord(value) &&
    Array.isArray(value.labels) &&
    value.labels.every((label) => isRecord(label) && typeof label.name === 'string') &&
    Object.hasOwn(value, 'milestone')
  )
}

function isRepoRelativePosixPath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
}
