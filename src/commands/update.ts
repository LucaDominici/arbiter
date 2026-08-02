// SPDX-License-Identifier: Apache-2.0
import { mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { acquireLock } from '../utils/file-lock.js'
import { UserFacingError, FatalError } from '../utils/errors.js'
import {
  beginGenerationSession,
  endGenerationSession,
  writeFileTranslated,
  type WriteResult,
} from '../utils/fs.js'
import {
  loadGeneratedManifest,
  saveGeneratedManifest,
  manifestKey,
} from '../state/generated-manifest.js'
import {
  isGateSpineKey,
  isGovernanceClassKey,
  isSafetyClassKey,
} from '../generators/safety-class.js'
import { isDerivedTrackKey } from '../generators/derived-class.js'
import { t } from '../i18n/index.js'
import { jsonOutput, statusToExitCode, type JsonOutputOpts } from '../utils/json-output.js'
import { getLogger } from '../utils/logger.js'
import { detectAdverseGitState } from '../detectors/git.js'
import { detectGithubAccess } from '../detectors/github.js'
import { detectLegacyWorkflowCollisionWarning } from '../detectors/workflow-collision.js'
import { resolveAxisFields } from '../detectors/axis.js'
import { detectInstalledSkills } from '../integrations/skill-detector.js'
import { excludeOwnEmittedSkills } from '../generators/skills.js'
import { loadConfig, loadSnapshot, saveConfigAndSnapshot } from '../utils/config.js'
import { runGithubSetup, printResults, runPlugins, slugifyProjectName } from './init.js'
import { resolveProjectName } from '../config/resolve-project-name.js'
import { diffConfig, impactedGenerators } from '../config/diff.js'
import { validateConfig } from '../config/schema.js'
import { resolveProjectConfig } from '../config/resolve-project-config.js'
import {
  buildRegistry,
  runGeneratorsFromRegistry,
  runGeneratorsSelective,
  type GeneratorFailure,
} from '../generators/registry.js'
import type { GeneratorKey } from '../config/diff.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { ArbiterConfigV2 } from '../utils/config.js'

export interface UpdateOptions {
  dir: string | undefined
  github: boolean
  json?: boolean | undefined
  /** Override adverse git state check (detached HEAD, rebase, merge, etc.). Emits warning then continues. */
  force?: boolean
  /**
   * T1 (anti-erosion): force-adopt ALL currently-withheld `skipIfExists` files
   * (not only safety-class ones), each recorded as a reversible local-override.
   * Safety-class files (`.claude/hooks/*.mjs`) are adopted by default already
   * (see `noAdoptSafety`) — this flag broadens adoption to every other
   * withheld file too.
   */
  adopt?: boolean
  /**
   * T1: opt OUT of the default-on safety-class adoption. Safety-class files
   * normally adopt regardless of `adopt` — this is the explicit escape hatch
   * for a user who deliberately wants even a safety hook frozen. Named
   * negatively (mirrors commander's `--no-*` convention) so the SAFE default
   * (adopt) requires no flag at all.
   */
  noAdoptSafety?: boolean
  /**
   * #2119 (reverses #2109): opt IN to force-adopting the gate spine
   * (`scripts/check-all.mjs`, `scripts/lib/*.mjs`) over a user-modified copy.
   * Withholding it is the default.
   *
   * #2109 modelled `check-all.mjs` as a CONTAINER arbiter owns, like a safety
   * hook. It is not: that file is by construction the point where a project
   * wires its OWN checks, so the template render is not a superset of the
   * local copy and adopting it DELETES content rather than restoring a fix
   * (measured on a copy of a real governed consumer: a bare `arbiter update`
   * erased 25 project checks, 12 of them security, and the gate stayed green
   * because the checks did not fail — they disappeared). Still independent of
   * `noAdoptSafety`: a safety hook is a whole file arbiter owns, and it keeps
   * adopting by default.
   */
  adoptGateSpine?: boolean
  /**
   * T1 (two-phase plan/apply): compute and print what `--adopt`/the default
   * safety-class adoption WOULD change — file list + diff — without writing
   * anything (config, manifest, generated files all untouched). Read-only.
   */
  adoptPlan?: boolean
  /**
   * #1983: force-refresh the known codex-track derived file set
   * (`.agents/rules/*`, `.claude/hooks/*` when codex-only, `.codex/codex-
   * adapter.mjs` — see `generators/derived-class.ts`) even when a copy already
   * exists on disk (these are `skipIfExists: true` by default so a downstream
   * governed repo never silently regresses once initialized). Reuses the same
   * two-phase adopt/plan machinery as `--adopt` (#1926): combine with
   * `--adopt-plan` to preview the diff before applying. A file carrying the
   * `arbiter:preserve` marker is never overwritten regardless (#1980).
   */
  refreshDerived?: boolean
}

/** One captured adopt decision: a withheld file that the adopt predicate matched. */
export interface AdoptRecord {
  /** targetDir-relative, posix-normalized path. */
  key: string
  /** The user-modified content that was on disk before adoption. */
  priorContent: string
  /** The shipped template content that replaced it (or would, in plan mode). */
  newContent: string
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Build the T1 adopt predicate from CLI flags. Safety-class files
 * (`.claude/hooks/*.mjs`) adopt by default — `noAdoptSafety` is the only way to
 * freeze one deliberately. Gate-spine files (`scripts/check-all.mjs`,
 * `scripts/lib/*.mjs`) are the opposite since #2119: WITHHELD by default,
 * adopted only under an explicit `adoptGateSpine`, because that file is where a
 * project wires its own checks and the template render is not a superset of it.
 * The two stay independent. `adopt` broadens to every withheld file.
 * `refreshDerived` (#1983) broadens it to exactly the codex-track derived
 * file set, independent of `adopt`/`noAdoptSafety`. Exported for unit testing
 * independent of the filesystem.
 */
export function buildAdoptPredicate(
  options: Pick<UpdateOptions, 'adopt' | 'noAdoptSafety' | 'adoptGateSpine' | 'refreshDerived'>,
): (key: string) => boolean {
  const adoptAll = options.adopt === true
  const adoptSafety = options.noAdoptSafety !== true
  const adoptGateSpine = options.adoptGateSpine === true
  const refreshDerived = options.refreshDerived === true
  return (key: string): boolean =>
    adoptAll ||
    (adoptSafety && isSafetyClassKey(key)) ||
    (adoptGateSpine && isGateSpineKey(key)) ||
    // #2120: no opt-out flag. These two are force-rendered on every selective
    // update by #2056, so the new provenance test would otherwise freeze them
    // and re-open the #2040 drift. `arbiter:preserve` is the deliberate freeze,
    // and it is checked ahead of every adopt policy.
    isGovernanceClassKey(key) ||
    (refreshDerived && isDerivedTrackKey(key))
}

/**
 * Persist an explicit, reversible local-override record for a force-adopted
 * file (T1). Deliberately human-inspectable JSON, not a stray `.arbiter-
 * backup` sibling: both the prior (user-modified) and new (shipped) content
 * are stored verbatim so the adoption is fully reversible without re-running
 * arbiter or digging through git history.
 */
function localOverrideSlug(key: string): string {
  return key.replace(/^\.+/, '').replace(/[/\\]+/g, '__')
}

/**
 * #1983: the local-override reason must name the actual trigger — a derived-
 * track file refreshed via `--refresh-derived` was not necessarily "user-
 * modified" (it may simply predate a template fix), so the `--adopt` wording
 * would misdescribe it.
 */
function localOverrideReason(key: string): string {
  if (isDerivedTrackKey(key)) {
    return (
      'update --refresh-derived: codex-track derived file force-refreshed to the ' +
      'current template render (skipIfExists bypassed for this known set only)'
    )
  }
  if (isGovernanceClassKey(key)) {
    return (
      'update: governance file force-adopted over locally-modified content — ' +
      'AGENTS.md carries the Iron Laws and .claude/settings.json the ARBITER_* ' +
      'deny list, and both are re-rendered on every update so they cannot go ' +
      'stale (#2056, #2120; mark the file `arbiter:preserve` to freeze it)'
    )
  }
  if (isGateSpineKey(key)) {
    return (
      'update: gate-spine file force-adopted over user-modified content — the gate ' +
      'entrypoint and its libs are the delivery vector for every later fix ' +
      '(#2109, reversed by #2119: this now happens only under explicit --adopt-gate-spine)'
    )
  }
  return (
    'update --adopt: template fix force-adopted over user-modified content ' +
    '(safety-class files adopt by default; see --no-adopt-safety)'
  )
}

export function recordLocalOverride(
  targetDir: string,
  record: AdoptRecord,
  now: () => Date = () => new Date(),
): string {
  const dir = join(targetDir, '.arbiter', 'evidence', 'local-overrides')
  mkdirSync(dir, { recursive: true })
  const envelope = {
    path: record.key,
    adoptedAt: now().toISOString(),
    reason: localOverrideReason(record.key),
    priorContent: record.priorContent,
    priorContentSha256: sha256(record.priorContent),
    newContent: record.newContent,
    newContentSha256: sha256(record.newContent),
  }
  const file = join(dir, `${localOverrideSlug(record.key)}.json`)
  writeFileTranslated(file, JSON.stringify(envelope, null, 2) + '\n')
  return file
}

/**
 * The targetDir-relative, posix-normalized keys of PROTECTED files — safety
 * class (`.claude/hooks/*.mjs`) and gate spine (`scripts/check-all.mjs`,
 * `scripts/lib/*.mjs`, #2109) — that are STILL withheld (user-modified, not
 * adopted) after this run. A safety hook lands here only when adoption was
 * explicitly disabled (`--no-adopt-safety`) or could not be recorded.
 *
 * #2119: a CUSTOMIZED GATE SPINE now stays on this list ON PURPOSE, with no
 * flag passed at all — that is the point, not an oversight. Withholding it
 * stops the destruction; leaving it listed is the honest register of the debt
 * the withholding creates (every check arbiter ships later that the project's
 * own `check-all.mjs` does not wire). Dropping it from the list would turn
 * #2119 into #2109 pointed the other way: silent again, in the safe direction.
 * The two exits are wiring the new checks by hand or marking the file
 * `arbiter:preserve` — the documented exception the ratchet accepts.
 *
 * This is exactly the list `check-safety-adopt-ratchet.mjs` fails on. Exported
 * for unit testing the pure decision.
 */
export function withheldSafetyKeys(results: WriteResult[], targetDir: string): string[] {
  return results
    .filter((r) => r.withheld === true && r.adopted !== true)
    .map((r) => manifestKey(targetDir, r.path))
    .filter((k): k is string => k !== null && (isSafetyClassKey(k) || isGateSpineKey(k)))
}

/** targetDir-relative keys of files force-adopted during this run (reporting). */
export function adoptedKeys(results: WriteResult[], targetDir: string): string[] {
  return results
    .filter((r) => r.withheld === true && r.adopted === true)
    .map((r) => manifestKey(targetDir, r.path))
    .filter((k): k is string => k !== null)
}

export interface UpdateResult {
  keysRun: Set<GeneratorKey | '*'> | null
}

function printStats(results: WriteResult[]): void {
  const created = results.filter((r) => r.action === 'created').length
  const replaced = results.filter((r) => r.action === 'backed-up-and-replaced').length
  const skipped = results.filter((r) => r.action === 'skipped' || r.action === 'dry-run').length
  // #1344: withheld files ARE skipped (preserved), but surface them separately so
  // the operator sees template fixes that did not land, not just a "skipped" lump.
  // T1: a force-adopted file (`adopted: true`) is NOT still withheld — it landed —
  // so it is excluded here (reported instead via the separate adoption notice).
  const withheld = results.filter((r) => r.withheld === true && r.adopted !== true).length
  process.stdout.write(`${t('cli.update.done', { created, replaced, skipped, withheld })}\n`)
}

/** A newly LANDED gate script (created or replaced) named `scripts/check-*.mjs`. */
function isNewlyLandedCheckScript(r: WriteResult): boolean {
  if (r.action !== 'created' && r.action !== 'backed-up-and-replaced') return false
  const norm = r.path.replace(/\\/g, '/')
  return /(^|\/)scripts\/check-[^/]+\.mjs$/.test(norm)
}

/**
 * #1410: detect the un-wired-gate footgun. When `arbiter update` emits a NEW
 * `scripts/check-*.mjs` gate AND `scripts/check-all.mjs` is WITHHELD (user-
 * modified, so the template fix that would wire the new gate did not land), the
 * new gate sits on disk but is never invoked — a silently inert check. Returns a
 * human-readable warning string, or null when there is nothing to warn about.
 *
 * Exported for unit testing the pure decision independent of the heavy runUpdate
 * filesystem/git path.
 */
/**
 * The newly-landed `scripts/check-*.mjs` gate scripts that are unwired because
 * `scripts/check-all.mjs` is withheld. The single source for BOTH the post-update
 * warning ({@link detectUnwiredGateWarning}) and the honest manifest section
 * ({@link unwiredGuardKeys}) — they must list exactly the same set so the file on
 * disk and the operator's console can never disagree.
 */
function unwiredGuardResults(results: WriteResult[]): WriteResult[] {
  const checkAllWithheld = results.some(
    (r) =>
      r.withheld === true &&
      r.adopted !== true &&
      r.path.replace(/\\/g, '/').endsWith('/scripts/check-all.mjs'),
  )
  if (!checkAllWithheld) return []
  return results.filter(isNewlyLandedCheckScript)
}

/**
 * #1504 (M1): the targetDir-relative manifest keys of the shipped-but-unwired
 * guards, for recording in `.arbiter-generated-manifest.json`. Paths that escape
 * targetDir (manifestKey → null) are dropped, matching the manifest's own
 * portable-key contract. Exported for unit testing the pure decision.
 */
export function unwiredGuardKeys(results: WriteResult[], targetDir: string): string[] {
  return unwiredGuardResults(results)
    .map((r) => manifestKey(targetDir, r.path))
    .filter((k): k is string => k !== null)
}

export function detectUnwiredGateWarning(results: WriteResult[]): string | null {
  const newGates = unwiredGuardResults(results).map((r) => {
    const norm = r.path.replace(/\\/g, '/')
    return norm.slice(norm.lastIndexOf('/') + 1)
  })
  if (newGates.length === 0) return null
  const list = newGates.join(', ')
  return (
    `Warning: ${list} added but check-all.mjs is withheld — the new gate is NOT wired ` +
    `(it will never run). Your check-all.mjs is user-modified, so the template fix that ` +
    `wires it was preserved, not applied. Please re-sync check-all.mjs (delete it and re-run ` +
    `\`arbiter update\`, or manually add the runCheck line) to activate the gate.`
  )
}

/** CI workflows that invoke the gate as `node scripts/check-all.mjs <level> --json <path>`. */
const GATE_INVOKING_WORKFLOWS = ['01-pr-fast.yml', '06-nightly.yml', 'drift-shadow.yml']

/**
 * #1504: detect a possible gate-signature mismatch. When `arbiter update`
 * (re)writes a CI workflow that runs `node scripts/check-all.mjs L2 --json <path>`
 * AND `scripts/check-all.mjs` is WITHHELD (user-modified), the withheld gate may
 * not parse that invocation — a parser that reads the level positionally as
 * `process.argv[2]` only (or ignores `--json`) runs the wrong level and writes no
 * gate-result artifact while the job stays GREEN (the B1 fake-green). Returns a
 * human-readable warning string, or null when there is nothing to warn about.
 *
 * Exported for unit testing the pure decision independent of runUpdate.
 */
export function detectGateSignatureWarning(results: WriteResult[]): string | null {
  const checkAllWithheld = results.some(
    (r) => r.withheld === true && r.path.replace(/\\/g, '/').endsWith('/scripts/check-all.mjs'),
  )
  if (!checkAllWithheld) return null
  const wroteGateWorkflow = results.some((r) => {
    if (r.action !== 'created' && r.action !== 'backed-up-and-replaced') return false
    const norm = r.path.replace(/\\/g, '/')
    return GATE_INVOKING_WORKFLOWS.some((w) => norm.endsWith(`/.github/workflows/${w}`))
  })
  if (!wroteGateWorkflow) return null
  return (
    `Warning: a CI workflow that invokes \`node scripts/check-all.mjs <level> --json <path>\` ` +
    `was (re)written but check-all.mjs is withheld (user-modified) — its arg parser may not ` +
    `match this invocation. Verify your check-all.mjs accepts a POSITIONAL level (\`L2\`) and ` +
    `\`--json [path]\`; a parser that reads the level only as \`process.argv[2]\` or ignores ` +
    `\`--json\` will silently run the wrong level and write no gate-result artifact while the ` +
    `job stays green (a fake-green). Re-sync check-all.mjs to the template, or update its parser.`
  )
}

function selectAndRun(
  specs: ReturnType<typeof buildRegistry>,
  snapshot: ArbiterConfigV2 | null,
  stored: ArbiterConfigV2,
  dryRun: boolean,
): {
  results: WriteResult[]
  keysRun: Set<GeneratorKey | '*'> | null
  errors: GeneratorFailure[]
} {
  const errors: GeneratorFailure[] = []
  if (!snapshot) {
    return {
      results: runGeneratorsFromRegistry(specs, errors, { dryRun }),
      keysRun: null,
      errors,
    }
  }
  const diff = diffConfig(snapshot, stored)
  if (diff.paths.length === 0) {
    process.stdout.write(`${t('cli.update.no_config_changes')}\n`)
    return {
      results: runGeneratorsFromRegistry(specs, errors, { dryRun }),
      keysRun: null,
      errors,
    }
  }
  const keys = impactedGenerators(diff)
  if (keys.has('*') || keys.size === 0) {
    const reason = keys.size === 0 ? 'Unknown config change' : 'Governance/axis change'
    process.stdout.write(`${t('cli.update.reason_regen', { reason })}\n`)
    return {
      results: runGeneratorsFromRegistry(specs, errors, { dryRun }),
      keysRun: keys,
      errors,
    }
  }
  // #2056: the governance-bearing generators must refresh on EVERY selective
  // update, not only when the diff happens to map to them. `agents-md` owns the
  // Iron Laws and `claude` owns the ARBITER_* deny list in .claude/settings.json —
  // both render from the whole config + their templates, which can carry updated
  // governance content independent of which config field changed. Without this a
  // routine update (e.g. toggling securityScanning → only `security`) leaves those
  // sections stale, the root cause behind the #2040 downstream-consumer drift. Both
  // no-op (byte-identical → skipped) when nothing actually changed, and a disabled
  // generator (e.g. claude when the tool isn't selected) is filtered out by
  // runGeneratorsSelective, so the blast radius stays minimal.
  keys.add('agents-md')
  keys.add('claude')
  process.stdout.write(`${t('cli.update.selective', { count: keys.size })}\n`)
  return {
    results: runGeneratorsSelective(specs, keys, errors, { dryRun }),
    keysRun: keys,
    errors,
  }
}

/** T1: the adopt-policy hooks threaded into a generation session. */
interface AdoptOpts {
  adoptPredicate: (key: string) => boolean
  onAdopt: (key: string, priorContent: string, newContent: string) => void
}

/**
 * Run the generator registry bracketed by a #1328 generation session: load the
 * prev manifest, make `writeFile` hash-aware (pristine skipIfExists files are
 * rewritten to propagate template fixes; user-modified ones are preserved +
 * warned), then persist the merged manifest. Persistence happens HERE — before
 * `saveConfigAndSnapshot`/`runPlugins` — so `arbiter.json`/`.arbiter-generated.json`
 * and plugin-written files never become manifest keys (A1/A6).
 *
 * T1: also threads the adopt policy (`adoptOpts`) into the session, so a
 * withheld safety-class (or, with `--adopt`, any) file is force-adopted
 * rather than preserved, and records the still-withheld safety-class set into
 * the manifest's honest `withheldSafety` section (mirrors #1504's
 * `unwiredGuards` pattern) for `check-safety-adopt-ratchet.mjs` to read.
 */
function selectAndRunWithManifest(
  specs: ReturnType<typeof buildRegistry>,
  snapshot: ArbiterConfigV2 | null,
  stored: ArbiterConfigV2,
  targetDir: string,
  adoptOpts: AdoptOpts,
): ReturnType<typeof selectAndRun> {
  const prevManifest = loadGeneratedManifest(targetDir)
  beginGenerationSession({
    targetDir,
    prevHashes: prevManifest,
    adoptPredicate: adoptOpts.adoptPredicate,
    onAdopt: adoptOpts.onAdopt,
  })
  const out = selectAndRun(specs, snapshot, stored, false)
  const generatedHashes = endGenerationSession()
  // #1504 (M1): record any delivered-but-unwired guard scripts (check-all withheld)
  // as an HONEST status in the manifest — re-derived every update so wiring the
  // gate later clears it. Without this the manifest's `files` map over-claims a
  // guard that never runs as "delivered protection" (the exact fake-green this wave
  // exists to kill). Mirrors the post-update warning surfaced in runUpdate.
  const unwired = unwiredGuardKeys(out.results, targetDir)
  const stillWithheldSafety = withheldSafetyKeys(out.results, targetDir)
  // A full registry run is also the authoritative ownership inventory. Keeping
  // prior-only keys here leaves retired hooks permanently marked as Arbiter-owned,
  // so routing audits report a false-but-actionable DEAD hook after every update.
  // A visited-but-withheld file is still Arbiter-emitted even though its user-modified
  // bytes cannot establish a new render baseline. Retain only those visited ownership
  // entries; dropping them would let routing/liveness checks silently ignore the file.
  // Partial, config-impacted runs still merge because untouched generators were
  // not visited and their ownership entries remain valid.
  const fullRegistryRun = out.keysRun === null || out.keysRun.has('*')
  const retainedWithheldHashes = Object.fromEntries(
    out.results.flatMap((result) => {
      if (result.withheld !== true || result.adopted === true) return []
      const key = manifestKey(targetDir, result.path)
      return key !== null && prevManifest[key] !== undefined ? [[key, prevManifest[key]]] : []
    }),
  )
  const nextHashes = fullRegistryRun
    ? { ...retainedWithheldHashes, ...generatedHashes }
    : { ...prevManifest, ...generatedHashes }
  saveGeneratedManifest(targetDir, nextHashes, unwired, stillWithheldSafety)
  return out
}

/**
 * T1 (two-phase plan/apply — `update --adopt-plan`): compute what adoption
 * WOULD change, with zero mutation. Reuses the exact same decision path as
 * the real run (dryRun:true means `resolveWriteAction` still classifies and
 * invokes `onAdopt`, but `writeFile`'s side-effect block never touches disk),
 * so plan and apply can never independently drift on "what would be adopted".
 */
function runAdoptPlan(
  specs: ReturnType<typeof buildRegistry>,
  snapshot: ArbiterConfigV2 | null,
  stored: ArbiterConfigV2,
  targetDir: string,
  adoptPredicate: (key: string) => boolean,
): { records: AdoptRecord[]; results: WriteResult[] } {
  const prevManifest = loadGeneratedManifest(targetDir)
  const collected: AdoptRecord[] = []
  beginGenerationSession({
    targetDir,
    prevHashes: prevManifest,
    adoptPredicate,
    onAdopt: (key, priorContent, newContent) => collected.push({ key, priorContent, newContent }),
  })
  let results: WriteResult[]
  try {
    // #2120: the dryRun already computes the prospective action for EVERY emitted
    // file, not only the adopt-channel ones. Dropping this return value is what
    // made the plan show one write channel out of three.
    results = selectAndRun(specs, snapshot, stored, true).results
  } finally {
    endGenerationSession()
  }
  return { records: collected, results }
}

/** Minimal built-in line diff (no dependency): lines present only on one side. */
function summarizeDiff(
  priorContent: string,
  newContent: string,
): { removed: number; added: number } {
  const oldLines = priorContent.split('\n')
  const newLines = newContent.split('\n')
  const oldSet = new Map<string, number>()
  for (const l of oldLines) oldSet.set(l, (oldSet.get(l) ?? 0) + 1)
  const newSet = new Map<string, number>()
  for (const l of newLines) newSet.set(l, (newSet.get(l) ?? 0) + 1)
  let removed = 0
  for (const [line, count] of oldSet) removed += Math.max(0, count - (newSet.get(line) ?? 0))
  let added = 0
  for (const [line, count] of newSet) added += Math.max(0, count - (oldSet.get(line) ?? 0))
  return { removed, added }
}

/**
 * #2120: the two write channels the plan used to hide. `update` has three ways
 * to put bytes on disk and the preview only ever showed the adopt one, so a
 * local fix in an always-rewrite file (`skipIfExists: false`) was reverted by a
 * run whose plan never named the file. Split by meaning, not by action:
 *   - `regenerate` — will be overwritten, no adopt decision involved (the
 *     invisible channel: nothing warns about these today).
 *   - `withheld` — diverged and preserved because no adopt policy matched (the
 *     same set `arbiter diff` surfaces; kept as its own bucket so a file that
 *     moves between the two channels never drops out of the plan entirely).
 * `skipped` is deliberately not a bucket: it is every unchanged file, and a
 * preview nobody reads protects nobody.
 */
function partitionPlanResults(results: WriteResult[]): {
  regenerate: WriteResult[]
  withheld: WriteResult[]
} {
  return {
    regenerate: results.filter(
      (r) =>
        (r.action === 'replaced' || r.action === 'backed-up-and-replaced') && r.withheld !== true,
    ),
    withheld: results.filter((r) => r.withheld === true && r.adopted !== true),
  }
}

function printAdoptPlan(
  records: AdoptRecord[],
  results: WriteResult[],
  targetDir: string,
  json: boolean | undefined,
): void {
  const { regenerate, withheld } = partitionPlanResults(results)
  const rel = (r: WriteResult): string => manifestKey(targetDir, r.path) ?? r.path
  if (json) {
    jsonOutput('update', 'ok', {
      adoptPlan: records.map((r) => ({
        path: r.key,
        ...summarizeDiff(r.priorContent, r.newContent),
      })),
      wouldRegenerate: regenerate.map(rel),
      withheld: withheld.map(rel),
    })
    return
  }
  if (records.length === 0) {
    process.stdout.write(
      '\n  adopt-plan: nothing to adopt (no withheld file matches the adopt policy).\n',
    )
  } else {
    process.stdout.write(`\n  adopt-plan: ${records.length} file(s) would be adopted:\n`)
    for (const r of records) {
      const { removed, added } = summarizeDiff(r.priorContent, r.newContent)
      process.stdout.write(
        `    - ${r.key}  (-${removed} +${added} lines vs. current on-disk content)\n`,
      )
    }
  }
  if (regenerate.length > 0) {
    process.stdout.write(
      `\n  would regenerate ${regenerate.length} file(s) (always-rewrite — local edits are lost, ` +
        `prior content goes to <file>.arbiter-backup where the generator asks for a backup):\n`,
    )
    printResults(regenerate, targetDir)
  }
  if (withheld.length > 0) {
    process.stdout.write(
      `\n  would withhold ${withheld.length} file(s) (locally diverged, no adopt policy matches):\n`,
    )
    for (const r of withheld) process.stdout.write(`    - ${rel(r)}\n`)
  }
  process.stdout.write('  Re-run without --adopt-plan to apply. Nothing was written.\n')
}

/**
 * Build the to-be-persisted config from the stored config + freshly resolved axis
 * fields. #1317: the DERIVED databaseEngine is threaded in so saveConfigAndSnapshot
 * does not drop it every update (which would leave the diff engine-change detection
 * inert with snapshot + nextConfig both carrying the stale `...stored`).
 */
function buildNextConfig(
  stored: ArbiterConfigV2,
  axisFields: ReturnType<typeof resolveAxisFields>,
  language: ProjectConfig['language'],
  needsMigration: boolean,
  projectName: string,
): ArbiterConfigV2 {
  const {
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    databaseEngine,
    hasPublicApi,
    contractType,
    lanes,
  } = axisFields
  return {
    ...stored,
    // #2120: persist the RESOLVED name (same slugified form `init` writes, see
    // build-arbiter-config.ts). `resolveProjectName` re-derives it every run from
    // stored → package.json → git remote → basename, and never wrote step 1 back:
    // a repo whose arbiter.json predates #1978 keeps resolving to its
    // package.json name, so every update silently renames the project in every
    // generated artifact. Writing it back makes arbiter.json the durable source
    // and freezes the answer at the first update.
    projectName,
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    databaseEngine,
    hasPublicApi,
    contractType,
    language,
    ...(lanes.length > 0 && { lanes }),
    ...(needsMigration && { collaborationMode: 'trunk-solo' }),
  }
}

function detectProjectInfo(
  targetDir: string,
  projectName: string,
  stored: ArbiterConfigV2,
  options: UpdateOptions,
  log: (msg: string) => void,
): {
  config: ProjectConfig
  specs: ReturnType<typeof buildRegistry>
  useGitHub: boolean
  axisFields: ReturnType<typeof resolveAxisFields>
} {
  log('  Detecting project...')
  const arbGhEnv = process.env['ARBITER_GITHUB']
  const envGitHub = arbGhEnv === '1'
  if (arbGhEnv !== undefined && !envGitHub) {
    process.stderr.write(
      `Warning: ARBITER_GITHUB=${arbGhEnv} is not '1' — only ARBITER_GITHUB=1 activates GitHub API calls. Ignored.\n`,
    )
  }
  const useGitHub = options.github || envGitHub ? detectGithubAccess().authenticated : false

  // Shared resolver: builds the SAME ProjectConfig as `diff` (registry-dryRun)
  // so the two commands cannot drift on config either (#1077 secondary drift).
  const { config } = resolveProjectConfig(targetDir, projectName, stored, useGitHub)
  const { language, framework } = config
  log(`  ├── Language: ${language}${framework ? ` / ${framework}` : ''}`)
  log(`  ├── Config: tools=[${stored.tools.join(',')}] level=${stored.governanceLevel}`)

  const axisFields = resolveAxisFields(stored, targetDir, language, framework)
  const claudeHome = process.env['HOME'] ? `${process.env['HOME']}/.claude` : ''
  // #1640: exclude arbiter's own emitted project skills so update does not append
  // them to the AGENTS.md Integrations table as third-party rows (init == update).
  const installedSkills = excludeOwnEmittedSkills(detectInstalledSkills({ targetDir, claudeHome }))
  const specs = buildRegistry(config, installedSkills)
  return { config, specs, useGitHub, axisFields }
}

function handlePluginError(err: unknown, json: boolean | undefined): never {
  const msg = err instanceof Error ? err.message : String(err)
  if (json) {
    jsonOutput('update', 'error', {}, [msg], { errorClass: 'fatal' })
    process.exit(2)
  }
  throw new FatalError('E_PLUGIN_FATAL', msg)
}

interface UpdateSummary extends Record<string, unknown> {
  created: number
  updated: number
  skipped: number
  /** #1344: skipIfExists files whose template fix was withheld (user-modified). */
  withheld: number
  /** T1: withheld files force-adopted this run (template fix landed anyway). */
  adopted: number
  /** T1: safety-class files still withheld (adoption disabled) — the ratchet fails on this. */
  withheldSafety: number
}

/**
 * Surface generator failures and backend warnings via the canonical 0/1/2 exit-
 * code convention (#483, INV-53). Extracted from {@link runUpdate} to keep that
 * function within the lint budget (max-lines-per-function 100, complexity 15).
 */
function emitUpdateOutcome(
  options: UpdateOptions,
  summary: UpdateSummary,
  generatorErrors: GeneratorFailure[],
  backendWarnings: string[],
): void {
  const generatorErrorLines = generatorErrors.map((e) => `${e.key}: ${e.message}`)
  if (options.json) {
    const status =
      generatorErrorLines.length > 0 ? 'error' : backendWarnings.length > 0 ? 'warning' : 'ok'
    const jsonOpts: JsonOutputOpts = {}
    if (backendWarnings.length > 0) jsonOpts.warnings = backendWarnings
    if (status === 'error') jsonOpts.errorClass = 'fatal'
    else if (status === 'warning') jsonOpts.errorClass = 'recoverable'
    jsonOutput(
      'update',
      status,
      summary,
      generatorErrorLines.length > 0 ? generatorErrorLines : undefined,
      status !== 'ok' || backendWarnings.length > 0 ? jsonOpts : undefined,
    )
    if (status !== 'ok') process.exit(statusToExitCode(status))
    return
  }
  if (generatorErrorLines.length > 0) {
    process.stdout.write(
      `\n  Generator failures (${generatorErrorLines.length}):\n${generatorErrorLines
        .map((line) => `    - ${line}`)
        .join('\n')}\n`,
    )
    if (backendWarnings.length > 0) {
      process.stderr.write(
        `\n  GitHub warnings (${backendWarnings.length}):\n${backendWarnings
          .map((w) => `    - ${w}`)
          .join('\n')}\n`,
      )
    }
    process.exit(statusToExitCode('error'))
  }
  if (backendWarnings.length > 0) {
    process.stderr.write(
      `\n  GitHub warnings (${backendWarnings.length}):\n${backendWarnings
        .map((w) => `    - ${w}`)
        .join('\n')}\n`,
    )
    process.exit(statusToExitCode('warning'))
  }
  process.stdout.write(`${t('cli.update.verify_hint')}\n`)
}

/**
 * T1: compute + (in text mode) print the adoption outcome. Adoption is loud,
 * never buried in a generic "skipped" count — an erosion fix that lands over
 * user-modified content is exactly the event this tranche exists to make
 * visible. Extracted from {@link runUpdate} to keep it within the lint budget
 * (max-lines-per-function 100, complexity 15, CANON-22).
 */
function reportAdoption(
  results: WriteResult[],
  targetDir: string,
  json: boolean | undefined,
): { adopted: string[]; stillWithheldSafety: string[] } {
  const adopted = adoptedKeys(results, targetDir)
  if (!json && adopted.length > 0) {
    process.stdout.write(
      `\n  Adopted ${adopted.length} safety-class/withheld file(s) (template fix landed over ` +
        `user-modified content; prior content preserved in .arbiter/evidence/local-overrides/):\n` +
        adopted.map((k) => `    - ${k}\n`).join(''),
    )
  }
  const stillWithheldSafety = withheldSafetyKeys(results, targetDir)
  if (!json && stillWithheldSafety.length > 0) {
    process.stderr.write(
      `\n  Warning: ${stillWithheldSafety.length} protected file(s) remain withheld ` +
        `(user-modified; safety hooks adopt by default — a gate-spine file adopts only under ` +
        `--adopt-gate-spine): ${stillWithheldSafety.join(', ')}\n` +
        `  \`scripts/check-safety-adopt-ratchet.mjs\` will FAIL for any of these NOT marked ` +
        `\`arbiter:preserve\` — re-adopt it, wire the new checks by hand, or mark it.\n`,
    )
  }
  return { adopted, stillWithheldSafety }
}

/**
 * Resolve the project info + next-config for an update run (project
 * detection, axis fields, the soloDevMode migration, the merged nextConfig).
 * Extracted from {@link runUpdate} to keep it within the lint budget
 * (max-lines-per-function 100, CANON-22).
 */
function prepareUpdateConfig(
  targetDir: string,
  projectName: string,
  stored: ArbiterConfigV2,
  options: UpdateOptions,
  log: (msg: string) => void,
): {
  config: ProjectConfig
  specs: ReturnType<typeof buildRegistry>
  snapshot: ArbiterConfigV2 | null
  nextConfig: ArbiterConfigV2
} {
  const { config, specs, axisFields } = detectProjectInfo(
    targetDir,
    projectName,
    stored,
    options,
    log,
  )
  const snapshot = loadSnapshot(targetDir)
  log('\n  Updating...')

  // ADR-051: migrate soloDevMode → collaborationMode on first update after upgrade.
  const needsMigration = stored.features.soloDevMode === true && !stored.collaborationMode
  if (needsMigration) {
    log("  Migrating soloDevMode=true → collaborationMode='trunk-solo' (ADR-051)")
  }
  const nextConfig = buildNextConfig(
    stored,
    axisFields,
    config.language,
    needsMigration,
    projectName,
  )
  return { config, specs, snapshot, nextConfig }
}

function handleAdverseState(
  adverseState: ReturnType<typeof detectAdverseGitState>,
  force: boolean | undefined,
): void {
  if (!adverseState) return
  const warning = `\n  Warning: ${adverseState.message}\n  ${adverseState.suggestedFix}\n`
  if (!force) {
    throw new UserFacingError(
      `${adverseState.message}\n${adverseState.suggestedFix}\n${t('cli.shared.force_override_hint')}`,
    )
  }
  getLogger().warn(
    'update.adverse_git_state',
    { message: adverseState.message, suggested_fix: adverseState.suggestedFix },
    warning,
  )
}

export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const targetDir = resolve(options.dir ?? process.cwd())
  const log: (msg: string) => void = options.json
    ? (): void => {}
    : (msg: string): void => {
        process.stdout.write(`${msg}\n`)
      }

  log('\n  Arbiter — update\n')

  mkdirSync(join(targetDir, '.arbiter'), { recursive: true })
  const lock = await acquireLock(join(targetDir, '.arbiter', '.lock'))
  try {
    const stored = loadConfig(targetDir)
    if (!stored) {
      if (options.json) {
        jsonOutput('update', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'], {
          errorClass: 'config',
        })
      } else {
        log('  No arbiter.json found. Run `arbiter init` first.\n')
      }
      process.exit(78)
      return { keysRun: null }
    }
    // #1978: resolve via the durable-source precedence chain (stored name →
    // package.json → git remote → cwd basename) — NEVER the cwd basename
    // directly, since worktree-based invocations run in a dir whose basename
    // is not the project name.
    const projectName = slugifyProjectName(resolveProjectName(targetDir, stored))

    handleAdverseState(detectAdverseGitState(targetDir), options.force)

    const { config, specs, snapshot, nextConfig } = prepareUpdateConfig(
      targetDir,
      projectName,
      stored,
      options,
      log,
    )

    // T1 (two-phase plan/apply): --adopt-plan is fully read-only — compute what
    // would be adopted and stop before ANY write (config, manifest, generated
    // files, plugins, GitHub calls). Never reaches saveConfigAndSnapshot.
    const adoptPredicate = buildAdoptPredicate(options)
    if (options.adoptPlan) {
      const plan = runAdoptPlan(specs, snapshot, nextConfig, targetDir, adoptPredicate)
      printAdoptPlan(plan.records, plan.results, targetDir, options.json)
      return { keysRun: null }
    }

    // T1: force-adopt matches (safety-class by default, or --adopt for all)
    // land here over user-modified content; each is recorded as an explicit,
    // reversible local-override BEFORE it can be reported as adopted.
    const onAdopt = (key: string, priorContent: string, newContent: string): void => {
      recordLocalOverride(targetDir, { key, priorContent, newContent })
    }

    // #1328: registry run bracketed by a generation session (manifest persisted
    // BEFORE saveConfigAndSnapshot/runPlugins — A1/A6). See selectAndRunWithManifest.
    const {
      results,
      keysRun,
      errors: generatorErrors,
    } = selectAndRunWithManifest(specs, snapshot, nextConfig, targetDir, {
      adoptPredicate,
      onAdopt,
    })
    const pluginResults = await runPlugins(
      targetDir,
      Array.isArray(stored.plugins) ? stored.plugins : [],
      stored,
    ).catch((err: unknown) => handlePluginError(err, options.json))
    results.push(...pluginResults)

    if (!options.json) {
      printResults(results, targetDir)
      printStats(results)
    }

    const { adopted, stillWithheldSafety } = reportAdoption(results, targetDir, options.json)

    const backendResult = runGithubSetup(config, log)

    // #1410: surface the un-wired-gate footgun (new check-*.mjs emitted while a
    // user-modified check-all.mjs withheld the wiring fix) through the same
    // warnings channel as backend warnings — json mode lists it, text mode prints it.
    const unwiredWarning = detectUnwiredGateWarning(results)
    const gateSigWarning = detectGateSignatureWarning(results)
    // B2 (#1502): after emitting the numbered workflow set, scan the target for
    // pre-existing LEGACY workflows whose triggers collide (double-running CI,
    // racing release/signing on one tag). Conservative warn-only — never deletes.
    const legacyCollisionWarning = detectLegacyWorkflowCollisionWarning(targetDir)
    const allWarnings = [
      ...backendResult.warnings,
      ...(unwiredWarning ? [unwiredWarning] : []),
      ...(gateSigWarning ? [gateSigWarning] : []),
      ...(legacyCollisionWarning ? [legacyCollisionWarning] : []),
    ]

    const validation = validateConfig(nextConfig)
    if (!validation.ok) {
      if (options.json) {
        jsonOutput('update', 'error', {}, [
          `Config invalid after update: ${validation.errors.join('; ')}`,
        ])
      } else {
        process.stderr.write(
          `${t('cli.update.config_invalid', { errors: validation.errors.join('; ') })}\n`,
        )
      }
      process.exit(2)
    }

    saveConfigAndSnapshot(targetDir, validation.config)

    const summary: UpdateSummary = {
      created: results.filter((r) => r.action === 'created').length,
      updated: results.filter((r) => r.action === 'backed-up-and-replaced').length,
      skipped: results.filter((r) => r.action === 'skipped' || r.action === 'dry-run').length,
      withheld: results.filter((r) => r.withheld === true && r.adopted !== true).length,
      adopted: adopted.length,
      withheldSafety: stillWithheldSafety.length,
    }
    emitUpdateOutcome(options, summary, generatorErrors, allWarnings)

    return { keysRun }
  } finally {
    // A3 leak-guard: clear any session left active by a throw/early-exit so it can
    // never corrupt the next in-process command (tests, batch mode). Idempotent.
    endGenerationSession()
    await lock.release()
  }
}
