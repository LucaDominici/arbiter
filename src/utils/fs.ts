// SPDX-License-Identifier: Apache-2.0
import {
  constants as fsConstants,
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  readFileSync,
  appendFileSync,
  chmodSync,
  rmSync,
  symlinkSync,
  mkdtempSync,
  cpSync,
  openSync,
  closeSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { ArbiterError } from './errors.js'
import { getLogger } from './logger.js'
import { t } from '../i18n/index.js'
import { manifestKey } from '../state/manifest-key.js'

// ── Atomic write + signal cleanup ────────────────────────────────────────────

const inFlightTmpPaths = new Set<string>()
let handlersRegistered = false

const FS_ERROR_KEYS: Record<string, string> = {
  ENOSPC: 'errors.E_FS_ENOSPC',
  EACCES: 'errors.E_FS_EACCES',
  EROFS: 'errors.E_FS_EROFS',
  EDQUOT: 'errors.E_FS_EDQUOT',
  EPERM: 'errors.E_FS_EPERM',
  ENOTDIR: 'errors.E_FS_ENOTDIR',
  EISDIR: 'errors.E_FS_EISDIR',
  // #1717 (CANON-17): a missing output directory, a locked/busy file, and too-many-
  // open-files must also translate — no fs errno leaks a raw Node stack.
  ENOENT: 'errors.E_FS_ENOENT',
  EBUSY: 'errors.E_FS_EBUSY',
  EMFILE: 'errors.E_FS_EMFILE',
}

/**
 * Map a raw fs errno failure to an ArbiterError with an actionable i18n hint (CANON-17).
 * Returns the ORIGINAL error unchanged for codes not in the catalog, so unknown failures
 * still surface with their real stack/identity (never swallowed, never re-wrapped) and no
 * ternary arm is left permanently uncovered. Single source shared by `atomicWrite` and
 * `writeFileTranslated` so the errno→hint mapping is not duplicated (CANON-22).
 */
export function toFsError(err: unknown, path: string): Error {
  const e = err as NodeJS.ErrnoException
  // #1991: prefer the errno's OWN path when the runtime supplies one — for a two-path op
  // (copy, rename) the caller cannot know which side failed, and naming the wrong one
  // sends the user to a file that is perfectly fine.
  const key = FS_ERROR_KEYS[e.code ?? '']
  return key ? ArbiterError.fromKey(e.code ?? '', key, { path: e.path ?? path }) : e
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.arbiter-tmp-${randomBytes(4).toString('hex')}`
  inFlightTmpPaths.add(tmpPath)
  try {
    writeFileSync(tmpPath, content, 'utf-8')
    renameSync(tmpPath, filePath)
  } catch (err) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // best-effort cleanup; the primary error takes precedence.
      // the finally block will still remove tmpPath from inFlightTmpPaths,
      // so the signal handler will NOT retry — any stranded file from a read-only
      // or permission-denied filesystem must be removed manually.
    }
    throw toFsError(err, filePath)
  } finally {
    inFlightTmpPaths.delete(tmpPath)
  }
}

function doCleanup(): void {
  for (const p of inFlightTmpPaths) {
    try {
      unlinkSync(p)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // non-ENOENT means the file exists but could not be removed (EACCES, EBUSY, etc.)
        // process.stderr.write is safe inside a signal handler; cannot throw here
        process.stderr.write(
          `[arbiter] warning: could not remove in-flight tmp file ${p} (${code ?? 'unknown'}) — remove manually\n`,
        )
      }
    }
    inFlightTmpPaths.delete(p)
  }
}

/** Clean up in-flight tmp files on user-initiated abort. */
export function cleanupInFlightTmpFiles(): void {
  doCleanup()
}

/** Register SIGTERM/SIGINT handlers that clean up in-flight temp files.
 *  Must be called explicitly from the CLI entry point — NOT at module load time,
 *  as that would interfere with test runners. */
export function registerCleanupHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      doCleanup()
      // An active command runner owns orderly descendant teardown. Without one,
      // restore the signal's default termination behavior.
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
    })
  }
}

/** Exposed for testing only — registers a path as in-flight. */
export function _registerTmpPath(p: string): void {
  inFlightTmpPaths.add(p)
}

/** Exposed for testing only — returns i18n message for errno code, or null if not mapped. */
export function _translateFsError(code: string, path: string): string | null {
  const key = FS_ERROR_KEYS[code]
  return key ? t(key, { path }) : null
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * `'dry-run'` is retained for backward compatibility — a small number of
 * consumers (e.g. `kit-install` SCAFFOLD reporting) still pattern-match it. As
 * of #1077, the standard fs helpers (`writeFile`, `copyStaticFile`) no longer
 * emit it: in dryRun they compute the *prospective* action (created / skipped /
 * replaced / backed-up-and-replaced) without touching disk, so `diff` (registry-
 * dryRun) reports exactly what `update` (real run) would do. This is what makes
 * the two commands structurally incapable of drifting (F1/F7).
 */
export interface WriteResult {
  path: string
  action: 'created' | 'skipped' | 'replaced' | 'backed-up-and-replaced' | 'dry-run'
  /**
   * #1344: true when this was a `skipIfExists` file preserved because it is
   * user-modified / unknown-provenance AND the new template render differs — i.e.
   * the template fix was WITHHELD. The action stays `'skipped'` (the file is not
   * written), so existing `action !== 'skipped'` side-effect gates are unaffected;
   * this orthogonal flag is the visibility channel `diff`/`update` surface so a
   * withheld gate/security fix is no longer reported as a silent "unchanged".
   */
  withheld?: boolean
  /**
   * B6/#1491 (M1): set when a generator DELIBERATELY did not emit a file because it
   * is not applicable to this config (e.g. GLOBAL_INVARIANTS.md when no optional
   * invariant tiers are selected) — as opposed to a `skipIfExists` skip of a file
   * that is on disk. The action stays `'skipped'` (no write, side-effect gates
   * unaffected), but this flag lets reporting avoid the false "already exists"
   * claim and lets the post-write presence check skip a file that was never meant
   * to land.
   */
  reason?: 'not-applicable'
  /**
   * T1 (convergence playbook, `update --adopt`): true when a would-be-withheld
   * `skipIfExists` file was FORCE-ADOPTED instead — the session's
   * `adoptPredicate` matched, so the shipped fix was written over the
   * user-modified content rather than preserved. `withheld` stays `true`
   * alongside this flag (the file WAS diverged) so callers can tell "diverged
   * and now re-adopted" from "never diverged" without inspecting two runs.
   */
  adopted?: boolean
  /**
   * #2295: true when this file was ABSENT from disk but a manifest baseline
   * exists for its key — arbiter emitted those bytes to that path before and the
   * consumer removed them since. The write still lands (see the issue: 255 of the
   * java consumer's 281 manifest entries are absent at its pin, so declining
   * would make `update` a near-no-op there); the flag exists so the restoration is
   * REPORTED instead of disappearing into the `created` count.
   *
   * Deliberately distinct from `created` with no baseline, which is a brand-new
   * template and must keep landing silently.
   */
  restored?: boolean
  /**
   * #2353: this path was NOT written because the run's selection policy declined
   * it — `'ignored'` when the repo's `.arbiterignore` matched, `'deselected'` when
   * it fell outside `update --only`. The action stays `'skipped'` (no write, no
   * side-effect gate affected) and `withheld` stays unset: nothing was preserved
   * against the template's wishes, the consumer simply does not accept this file.
   *
   * The caller keeps the manifest entry for an excluded key, so removing the
   * pattern re-adopts the file on the next run.
   */
  excluded?: 'ignored' | 'deselected'
}

export type GeneratorRunOpts = { dryRun: boolean }

// ── Generation session (#1328) ───────────────────────────────────────────────
//
// A module-level "generation session" (same pattern as `inFlightTmpPaths`) lets
// `writeFile` make `skipIfExists` hash-aware WITHOUT threading a manifest param
// through the dozens of generator call-sites. The orchestrators (`init`,
// `update`, `diff`) bracket the registry run with begin/end; `writeFile` consults
// `prevHashes` to tell a pristine (unmodified-since-generation) file — safe to
// rewrite to propagate a fix — from a user-modified one, and records the new
// render hash into `newHashes` for the caller to persist to the manifest.

interface GenerationSession {
  targetDir: string
  prevHashes: Map<string, string>
  newHashes: Map<string, string>
  /** Test/observability seam: invoked when a fix is withheld from a file. */
  onWithheld?: (key: string) => void
  /**
   * T1: when a `skipIfExists` file would be withheld (user-modified), this
   * predicate decides whether to force-adopt it instead (write the shipped
   * content over the user-modified one) rather than preserve it. Adoption is
   * provenance-gated: only files arbiter previously emitted (a recorded
   * manifest baseline exists) are eligible; unknown-provenance files are
   * preserved (#2220). Domain-agnostic on purpose — `fs.ts` has no notion of
   * "safety-class"; the caller (`update.ts`) supplies the policy so this shared,
   * heavily-depended-on module stays a generic file-write primitive.
   */
  /**
   * T1: decides whether a withheld file is force-adopted (write the shipped
   * content over the user-modified one). Domain-agnostic on purpose — `fs.ts`
   * has no notion of "safety-class"; the caller supplies the policy. The
   * second argument is `provenanceKnown` (`prev !== undefined` — the file has
   * a recorded manifest baseline), letting the policy adopt the safety class
   * by default while keeping informative classes provenance-gated (#2220).
   */
  adoptPredicate?: (key: string, provenanceKnown: boolean) => boolean
  /**
   * #2353: the consumer's per-file opt-out (`.arbiterignore` / `update --only`).
   * Consulted BEFORE every other branch, so a declined file is never read,
   * compared, adopted, restored or written. Domain-agnostic like `adoptPredicate`:
   * the caller (`update`/`diff`) supplies the policy; `fs.ts` only obeys it.
   * Absent ⇒ every file is emitted, which is the pre-#2353 behaviour, and `init`
   * deliberately never passes one.
   */
  selectPredicate?: (key: string) => 'emit' | 'ignored' | 'deselected'
  /**
   * T1: invoked AFTER a force-adopt actually lands on disk, with the prior
   * (user-modified) content and the newly-written (shipped) content. The
   * caller uses this to persist an explicit, reversible local-override record
   * — adoption must never silently discard what the user had.
   */
  onAdopt?: (key: string, priorContent: string, newContent: string) => void
}

let generationSession: GenerationSession | null = null

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Begin a generation session. THROWS when a session is already active (#1531):
 * `writeFile` reads a single module-level session, so reentrancy is unsupported.
 * An active session at begin-time can only mean a missed `endGenerationSession`
 * (a leaked `finally`) or an attempted nested/concurrent generation — both real
 * bugs whose silent overwrite would discard the in-flight manifest baseline.
 * Surface them loudly rather than clobbering. Sequential `begin → end → begin`
 * reuse in one process stays valid because `end` clears the session first.
 */
export function beginGenerationSession(opts: {
  targetDir: string
  prevHashes: Record<string, string>
  onWithheld?: (key: string) => void
  adoptPredicate?: (key: string, provenanceKnown: boolean) => boolean
  selectPredicate?: (key: string) => 'emit' | 'ignored' | 'deselected'
  onAdopt?: (key: string, priorContent: string, newContent: string) => void
}): void {
  if (generationSession !== null) {
    throw new Error(
      'beginGenerationSession: a generation session is already active. This means a ' +
        'prior session was not ended (missing endGenerationSession in a finally block) ' +
        'or a nested/concurrent generation was attempted — both unsupported, since ' +
        'writeFile reads a single module-level session.',
    )
  }
  generationSession = {
    targetDir: opts.targetDir,
    prevHashes: new Map(Object.entries(opts.prevHashes)),
    newHashes: new Map(),
    ...(opts.onWithheld ? { onWithheld: opts.onWithheld } : {}),
    ...(opts.adoptPredicate ? { adoptPredicate: opts.adoptPredicate } : {}),
    ...(opts.selectPredicate ? { selectPredicate: opts.selectPredicate } : {}),
    ...(opts.onAdopt ? { onAdopt: opts.onAdopt } : {}),
  }
}

/**
 * End the active session and return the recorded render hashes (targetDir-
 * relative, posix keys) for the caller to merge + persist. Always clears the
 * session (idempotent: returns `{}` when none is active).
 */
export function endGenerationSession(): Record<string, string> {
  const session = generationSession
  generationSession = null
  return session ? Object.fromEntries(session.newHashes) : {}
}

/**
 * Record arbiter's canonical render hash as the new baseline for a file — but
 * ONLY when the on-disk content now equals `content` (the caller passes
 * `baselineMatches`). The manifest invariant is: `manifest[key]` is the hash of
 * the bytes arbiter most recently WROTE (or confirmed byte-identical on disk),
 * so `sha256(disk) === manifest[key]` ⇔ pristine. Recording on a *withheld* skip
 * (disk ≠ content, file NOT written) would poison the baseline to a render that
 * is not on disk, permanently marking the file user-modified — so those callers
 * pass `baselineMatches=false`. Called AFTER a successful side effect (A2) so a
 * throwing `atomicWrite` never leaves a phantom hash. Non-relative/escaping keys
 * are skipped + warned (A7).
 */
function recordGeneratedHash(filePath: string, content: string): void {
  const session = generationSession
  if (!session) return
  const key = manifestKey(session.targetDir, filePath)
  if (key === null) {
    getLogger().warn(
      'fs.manifest_key_skipped',
      { path: filePath },
      `generated-manifest: skipping non-relative path (cannot key portably): ${filePath}`,
    )
    return
  }
  session.newHashes.set(key, sha256(content))
}

interface ResolvedWrite {
  action: WriteResult['action']
  /** True when the on-disk bytes will equal `content` after this op (record-eligible). */
  baselineMatches: boolean
  /** #1344: true when a skipIfExists template fix is withheld from a user-modified file. */
  withheld: boolean
  /** T1: true when a would-be-withheld file was force-adopted instead. */
  adopted: boolean
  /** #2295: absent from disk, but a manifest baseline exists → re-emitted, not new. */
  restored?: boolean
  /** #2353: declined by the run's selection policy (`.arbiterignore` / `--only`). */
  excluded?: 'ignored' | 'deselected'
}

/**
 * #2353: the consumer's opt-out, ahead of EVERY other branch of
 * {@link resolveWriteAction} — including the absent-file/restore branch, which is
 * exactly the one a consumer is declining when it deletes a generated file and
 * lists it in `.arbiterignore`. Returns null when nothing declines this path.
 *
 * `baselineMatches` is false (the bytes did not land, so no new render hash may be
 * recorded) and `withheld` is false (nothing was preserved against the template —
 * the file was never a candidate this run).
 */
function resolveExclusion(session: GenerationSession, filePath: string): ResolvedWrite | null {
  if (!session.selectPredicate) return null
  const key = manifestKey(session.targetDir, filePath)
  if (key === null) return null
  const verdict = session.selectPredicate(key)
  if (verdict === 'emit') return null
  return {
    action: 'skipped',
    baselineMatches: false,
    withheld: false,
    adopted: false,
    excluded: verdict,
  }
}

/**
 * #2295: does the active session hold a recorded render baseline for this path?
 *
 * `recordGeneratedHash` writes a manifest entry ONLY after the bytes actually
 * landed, so an entry is positive evidence that arbiter wrote this file to this
 * path at some point. Combined with the file being absent, that is the one signal
 * separating "the consumer deleted what we emitted" from "a template we have
 * never emitted here" — the AC-3 boundary. No session (init before the manifest
 * era, a direct `writeFile` caller) → no evidence → not a restoration.
 */
function hasRecordedBaseline(filePath: string): boolean {
  const session = generationSession
  if (!session) return false
  const key = manifestKey(session.targetDir, filePath)
  return key !== null && session.prevHashes.get(key) !== undefined
}

/**
 * Compute the action `writeFile` would take, given on-disk state. Single source
 * of truth shared by real + dryRun paths so they can never diverge. The on-disk
 * bytes are read ONCE (A8) and reused for both the byte-identical check and the
 * pristine-hash check. Precedence:
 *   0. exists + differs + on-disk content carries the `arbiter:preserve` marker
 *                                               → skipped, NOT baselineMatches, withheld
 *                                                  (#1980; fail-safe — ahead of
 *                                                  skipIfExists/backup/adopt)
 *   1. missing                                  → created (baselineMatches)
 *   2. exists + byte-identical content          → skipped (baselineMatches; idempotent)
 *   3. exists + skipIfExists + session + pristine (sha256(disk)==prevHash) + differs
 *                                               → replaced (propagate fix, #1328; baselineMatches)
 *   4. exists + skipIfExists + session + provenance-known user-modified
 *      + adoptPredicate matches
 *                                               → replaced/backed-up-and-replaced (T1
 *                                                  force-adopt; baselineMatches; withheld+adopted)
 *   5. exists + skipIfExists (no session | unknown | user-modified, no adopt)
 *                                               → skipped, NOT baselineMatches (+ withheld warn
 *                                                  when a session knows)
 *   6. exists + backup                          → backed-up-and-replaced (baselineMatches)
 *   7. exists                                   → replaced (baselineMatches)
 */
/**
 * The provenance branch of {@link resolveWriteAction} when a generation session
 * is active and the on-disk content is readable — extracted to keep the parent
 * function's cyclomatic complexity within the lint ceiling (CANON-22). Handles
 * cases 3/4/5 of the precedence table above, for BOTH `skipIfExists` files and
 * (since #2120) always-rewrite ones.
 */
function resolveSessionSkip(
  session: GenerationSession,
  filePath: string,
  content: string,
  disk: string,
  opts: { backup: boolean; skipIfExists: boolean },
): ResolvedWrite {
  const { backup, skipIfExists } = opts
  const key = manifestKey(session.targetDir, filePath)
  const prev = key === null ? undefined : session.prevHashes.get(key)
  const rewrite: ResolvedWrite = {
    action: backup ? 'backed-up-and-replaced' : 'replaced',
    baselineMatches: true,
    withheld: false,
    adopted: false,
  }
  if (prev !== undefined && sha256(disk) === prev) {
    // Pristine: unmodified since arbiter generated it → safe to rewrite.
    return rewrite
  }
  // #2120: an always-rewrite file (`skipIfExists: false`) reaches the divergence
  // branch only on POSITIVE evidence — a recorded baseline that no longer matches
  // disk. Unknown provenance (no manifest entry) keeps today's replace behavior:
  // withholding it would turn `arbiter update` into a silent no-op on any repo
  // whose manifest predates the key, which is the same silence in the opposite
  // direction. `skipIfExists` is unaffected — skipping is already its safe default.
  if (!skipIfExists && prev === undefined) return rewrite
  // User-modified or unknown provenance.
  const withheldKey = key ?? filePath
  // Provenance is passed to the predicate, which decides per class: the safety
  // class (hooks) is adopt-by-default by contract (update.ts noAdoptSafety) —
  // enforcement must stay current, and the caller's onAdopt persists a
  // reversible local-override record, so no content is lost. The informative
  // classes (CLAUDE.md, settings, AGENTS.md, derived) stay provenance-gated
  // (#2220): unknown-provenance files there are preserved, never clobbered.
  if (session.adoptPredicate?.(withheldKey, prev !== undefined)) {
    session.onAdopt?.(withheldKey, disk, content)
    return {
      action: backup ? 'backed-up-and-replaced' : 'replaced',
      baselineMatches: true,
      withheld: true,
      adopted: true,
    }
  }
  // Not adopted → preserve + surface the withheld fix (unchanged #1344 path).
  ;(session.onWithheld ?? defaultWithheldWarn)(withheldKey)
  return { action: 'skipped', baselineMatches: false, withheld: true, adopted: false }
}

function resolveWriteAction(
  filePath: string,
  content: string,
  skipIfExists: boolean,
  backup: boolean,
  skipPreserveCheck: boolean,
): ResolvedWrite {
  const session = generationSession
  // #2353: the opt-out precedes everything, the preserve marker and the restore
  // branch included — a declined path is not inspected at all.
  if (session) {
    const excluded = resolveExclusion(session, filePath)
    if (excluded) return excluded
  }
  if (!existsSync(filePath))
    return {
      action: 'created',
      baselineMatches: true,
      withheld: false,
      adopted: false,
      // #2295: this was the one branch in the whole precedence table that consulted
      // no provenance at all — an absent path was always "new", so a deliberate
      // deletion by the consumer was re-materialized and counted as a creation.
      restored: hasRecordedBaseline(filePath),
    }
  // Single read: null = unreadable (treat as exists-but-unknown → legacy-safe).
  let disk: string | null
  try {
    disk = readFileSync(filePath, 'utf-8')
  } catch {
    disk = null
  }
  if (disk !== null && disk === content)
    return { action: 'skipped', baselineMatches: true, withheld: false, adopted: false }

  // #1980/#2533: a preserve-marked file is NEVER overwritten — fail-safe, ahead of
  // skipIfExists/backup/adopt. A generation session (when active) still gets
  // the same withheld-reporting/visibility treatment as any other withheld fix.
  // `skipPreserveCheck` is the one escape hatch (#2533): evidence/log/data writers
  // (TDD evidence, tech-debt.json, the unified task-status document) are internal
  // tooling state, never a generator-emitted target a downstream repo would
  // hand-customise and mark — so a captured log that happens to quote the marker
  // must not freeze them. See `assertWritten` below for the other half of the
  // fix: those same callers must never treat a withheld write as success.
  if (hasPreserveMarker(disk, skipPreserveCheck)) {
    if (session) {
      const key = manifestKey(session.targetDir, filePath)
      ;(session.onWithheld ?? defaultWithheldWarn)(key ?? filePath)
    }
    return { action: 'skipped', baselineMatches: false, withheld: true, adopted: false }
  }

  // #2120: the provenance test used to live INSIDE the skipIfExists branch, so an
  // always-rewrite file was overwritten with no provenance check at all — a local
  // fix in e.g. `scripts/debt-lib.mjs` silently reverted on every update. Hoisting
  // the session ahead of the branch reuses the machinery already built for the
  // divergent case: withheld reporting, the plan section, `--adopt`, and the
  // reversible local-override record.
  if (session && disk !== null)
    return resolveSessionSkip(session, filePath, content, disk, { backup, skipIfExists })
  if (skipIfExists)
    return { action: 'skipped', baselineMatches: false, withheld: false, adopted: false }

  return {
    action: backup ? 'backed-up-and-replaced' : 'replaced',
    baselineMatches: true,
    withheld: false,
    adopted: false,
  }
}

/**
 * #1980: grep-able preserve/do-not-edit marker. A destination file whose
 * on-disk content contains this string is NEVER overwritten by `writeFile`,
 * regardless of `skipIfExists`/`backup`/adopt policy — a downstream repo can
 * replace any arbiter-generated file (e.g. GLOBAL_INVARIANTS.md) with a
 * hand-maintained stub and mark it, and every future `arbiter update` treats
 * it exactly like a withheld user-modified file. Documented in
 * docs/REFERENCE/file-stability.md.
 */
export const PRESERVE_MARKER = 'arbiter:preserve'

/**
 * #2533: `skip` is the caller's `skipPreserveCheck` opt-out — folded in here
 * (rather than a second condition at each call site) so the branch counts
 * against this small, dedicated predicate's complexity budget instead of
 * `resolveWriteAction`'s (CANON-22).
 */
function hasPreserveMarker(disk: string | null, skip: boolean): boolean {
  return !skip && disk !== null && disk.includes(PRESERVE_MARKER)
}

function defaultWithheldWarn(key: string): void {
  getLogger().warn(
    'fs.fix_withheld',
    { path: key },
    `user-modified, template fix NOT applied: ${key} (review with \`arbiter diff --withheld\`; ` +
      `adopt every withheld fix with \`arbiter update --adopt\`)`,
  )
}

/**
 * Write a file atomically (temp-file + rename), creating parent directories as needed.
 * If the file already exists and skipIfExists=true, skip it — UNLESS a generation
 * session knows the on-disk content is pristine (matches the recorded render hash),
 * in which case it is rewritten to propagate a template fix (#1328).
 * If the file already exists and its content is byte-identical, skip it (idempotent).
 * If backup=true and file exists with differing content, copy it to
 * <path>.arbiter-backup before writing.
 * In dryRun mode the prospective action is computed and returned WITHOUT any
 * filesystem mutation. The render hash is recorded into the active generation
 * session AFTER a successful side effect, for every action.
 * On ENOSPC the temp file is cleaned up and a UserFacingError is thrown.
 * `skipPreserveCheck` (#2533) opts a caller OUT of the `arbiter:preserve` marker
 * check (see {@link PRESERVE_MARKER}) — for internal tooling state (evidence, logs,
 * data artifacts) that is never a generator-emitted, user-customisable target.
 * Defaults to `false`: every existing caller keeps today's protective behaviour.
 */
export interface WriteFileOpts {
  skipIfExists?: boolean
  backup?: boolean
  dryRun?: boolean
  skipPreserveCheck?: boolean
}

interface NormalizedWriteFileOpts {
  skipIfExists: boolean
  backup: boolean
  dryRun: boolean
  skipPreserveCheck: boolean
}

/**
 * Default-fill `writeFile`'s options. Extracted so the four `?? false` decision
 * points count against THIS function's complexity budget rather than
 * `writeFile`'s own (CANON-22) — a plain destructuring default for each field
 * would otherwise push `writeFile` over the lint ceiling.
 */
function normalizeWriteFileOpts(opts: WriteFileOpts): NormalizedWriteFileOpts {
  return {
    skipIfExists: opts.skipIfExists ?? false,
    backup: opts.backup ?? false,
    dryRun: opts.dryRun ?? false,
    skipPreserveCheck: opts.skipPreserveCheck ?? false,
  }
}

export function writeFile(
  filePath: string,
  content: string,
  opts: WriteFileOpts = {},
): WriteResult {
  const { skipIfExists, backup, dryRun, skipPreserveCheck } = normalizeWriteFileOpts(opts)
  const { action, baselineMatches, withheld, adopted, restored, excluded } = resolveWriteAction(
    filePath,
    content,
    skipIfExists,
    backup,
    skipPreserveCheck,
  )

  // Side effects (may throw → recordGeneratedHash below is never reached, so no
  // phantom hash is recorded for content that did not land — A2).
  if (!dryRun && action !== 'skipped') {
    if (action === 'backed-up-and-replaced') {
      copyFileSync(filePath, `${filePath}.arbiter-backup`)
    }
    mkdirSync(dirname(filePath), { recursive: true })
    atomicWrite(filePath, content)
  }

  // Record the baseline ONLY when disk == content (created/replaced/byte-identical)
  // and the side effect actually ran (never on dryRun — diff must not record a hash
  // for content that did not land — and never on a withheld skip, which would poison
  // the baseline; see recordGeneratedHash). An adopted write DOES land (baselineMatches
  // is true for it, dryRun permitting), so a force-adopt re-baselines the manifest to
  // the newly-adopted content — the next update sees it as pristine again.
  if (!dryRun && baselineMatches) recordGeneratedHash(filePath, content)
  // #2353: an excluded path is reported as its own outcome — never as a withheld
  // fix (nothing was preserved) and never as a plain "unchanged" skip (the file may
  // not even exist). The caller retains its manifest entry off this flag.
  if (excluded !== undefined) return { path: filePath, action, excluded }
  if (withheld && adopted) return { path: filePath, action, withheld: true, adopted: true }
  // #2295: only ever set alongside `created` (the absent-file branch), so it never
  // collides with the withheld/adopted shapes above.
  if (restored === true) return { path: filePath, action, restored: true }
  // Only attach the flag when true so non-withheld results keep their stable
  // `{ path, action }` shape (snapshot/JSON parity for the common case).
  return withheld ? { path: filePath, action, withheld: true } : { path: filePath, action }
}

/**
 * #2533: the write-truth half of the fix. A caller writing evidence, logs, or other
 * tooling-authored data artifacts (as opposed to a generator target, where `withheld`
 * is a normal, REPORTED outcome — see `arbiter diff --withheld`) must never treat a
 * `WriteResult` with `withheld: true` as success: it means the content it intended to
 * write did NOT land on disk. `adopted: true` is the one exception — a force-adopt DID
 * write the shipped content over the user-modified one, so `withheld` there records
 * "it WAS diverged" rather than "this write failed" (see {@link ResolvedWrite.adopted}).
 *
 * `description` names the artifact in the thrown message (e.g. `TDD evidence for #551`)
 * so the failure is actionable without inspecting the call site.
 */
export function assertWritten(result: WriteResult, description: string): void {
  if (result.withheld === true && result.adopted !== true) {
    throw new Error(
      `refusing to report success: ${description} was not written to ${result.path} — ` +
        `the write was withheld (the existing on-disk content could not be safely ` +
        `overwritten, e.g. it carries the \`${PRESERVE_MARKER}\` marker). Delete the ` +
        `stale file, or its marker, and retry.`,
    )
  }
}

/**
 * Write a file directly (one-shot, no atomic temp+rename, no skipIfExists / backup /
 * generation-session semantics), translating fs errno failures into an ArbiterError
 * (CANON-17). This is the approved facade for direct CLI-output writes, accepting string
 * or binary content through one errno-translation path. Unlike {@link writeFile}, this
 * does NOT mkdir the parent directory — a missing output directory surfaces as a
 * translated ENOENT rather than being silently created. It is not for generator-emitted
 * repo files.
 */
export function writeFileTranslated(path: string, data: string | Uint8Array): void {
  try {
    writeFileSync(path, data)
  } catch (err) {
    throw toFsError(err, path)
  }
}

function containedParts(relativePath: string): string[] {
  if (isAbsolute(relativePath)) throw new Error(`contained path must be relative: ${relativePath}`)
  const parts = relativePath.split(/[\\/]+/)
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`contained path has invalid components: ${relativePath}`)
  }
  return parts
}

function openContainedDirectory(rootDir: string, directoryParts: readonly string[]): number {
  if (process.platform === 'win32')
    throw new Error('descriptor-relative filesystem operations are unsupported on Windows')
  const flags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW
  let fd = -1
  try {
    fd = openSync('/', flags)
    const rootParts = resolve(rootDir).split('/').filter(Boolean)
    for (const part of [...rootParts, ...directoryParts]) {
      const child = `${process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'}/${fd}/${part}`
      try {
        mkdirSync(child)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw toFsError(err, child)
      }
      const next = openSync(child, flags)
      closeSync(fd)
      fd = next
    }
    return fd
  } catch (err) {
    if (fd !== -1) closeSync(fd)
    throw toFsError(err, rootDir)
  }
}

/** Write below an already-owned root without following replaceable directory components. */
function writeFileContained(rootDir: string, relativePath: string, data: string): void {
  const parts = containedParts(relativePath)
  const fileName = parts.pop() as string
  const fullPath = join(rootDir, relativePath)

  let dirFd = -1
  let tempFd = -1
  let tempPath: string | null = null
  try {
    dirFd = openContainedDirectory(rootDir, parts)
    const dirPath = `${process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'}/${dirFd}`
    tempPath = join(dirPath, `.arbiter-tmp-${randomBytes(4).toString('hex')}`)
    tempFd = openSync(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    )
    writeFileSync(tempFd, data)
    closeSync(tempFd)
    tempFd = -1
    renameSync(tempPath, join(dirPath, fileName))
    tempPath = null
  } catch (err) {
    if (tempFd !== -1) closeSync(tempFd)
    if (tempPath !== null) {
      try {
        unlinkSync(tempPath)
      } catch {
        // Best-effort cleanup; preserve the primary translated error.
      }
    }
    throw toFsError(err, fullPath)
  } finally {
    if (dirFd !== -1) closeSync(dirFd)
  }
}

/** Read below an owned root without following replaceable directory/file components. */
function readFileContained(rootDir: string, relativePath: string): string {
  const parts = containedParts(relativePath)
  const fileName = parts.pop() as string
  const fullPath = join(rootDir, relativePath)

  let dirFd = -1
  let fileFd = -1
  try {
    dirFd = openContainedDirectory(rootDir, parts)
    fileFd = openSync(
      `${process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'}/${dirFd}/${fileName}`,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    )
    return readFileSync(fileFd, 'utf8')
  } catch (err) {
    throw toFsError(err, fullPath)
  } finally {
    if (fileFd !== -1) closeSync(fileFd)
    if (dirFd !== -1) closeSync(dirFd)
  }
}

export { writeFileContained, readFileContained }

// ── Translated one-shot primitives (#1991, CANON-17) ─────────────────────────
//
// `src/utils/fs.ts` is the sole approved write façade for `src/`
// (scripts/check-no-direct-fs.mjs enforces it). Each wrapper below exists because a
// direct call to its node:fs twin would let a raw errno reach the user as an unstyled
// Node stack instead of an ArbiterError with an actionable hint. They are deliberately
// thin: no atomicity, no generation-session semantics, no dryRun — that is `writeFile`'s
// job. These are for the one-shot filesystem effects the rest of `src/` performs.

/** Open an append-mode descriptor, creating the file when absent. */
export function openAppendDescriptorTranslated(path: string): number {
  try {
    return openSync(path, 'a')
  } catch (err) {
    throw toFsError(err, path)
  }
}

/** Close a descriptor, translating filesystem failures against its source path. */
export function closeDescriptorTranslated(fd: number, path: string): void {
  try {
    closeSync(fd)
  } catch (err) {
    throw toFsError(err, path)
  }
}

/**
 * Create a directory and its parents. The recursive form is what essentially every
 * call site wanted; a call needing `mode` or non-recursive semantics keeps its own
 * `mkdirSync` and is pinned in the allowlist rather than distorted to fit this.
 */
export function ensureDir(path: string): void {
  try {
    mkdirSync(path, { recursive: true })
  } catch (err) {
    throw toFsError(err, path)
  }
}

/** Append to a file, creating it if absent. */
export function appendFileTranslated(path: string, data: string): void {
  try {
    appendFileSync(path, data)
  } catch (err) {
    throw toFsError(err, path)
  }
}

/** Copy `src` to `dest`. `toFsError` names whichever side the errno actually carries. */
export function copyFileTranslated(src: string, dest: string): void {
  try {
    copyFileSync(src, dest)
  } catch (err) {
    throw toFsError(err, dest)
  }
}

/** Rename/move `from` to `to`. `toFsError` names whichever side the errno actually carries. */
export function renameTranslated(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch (err) {
    throw toFsError(err, to)
  }
}

/**
 * Set a file's permission bits. Every call site in `src/` marks a generated script
 * executable right after emitting it; an EPERM/EROFS here otherwise surfaces as a raw
 * Node stack on a file the user has no idea arbiter just wrote.
 */
export function chmodTranslated(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch (err) {
    throw toFsError(err, path)
  }
}

/** Remove a single file. Throws on a missing path — use {@link rmTranslated} with
 *  `force` when absence is acceptable. */
export function unlinkTranslated(path: string): void {
  try {
    unlinkSync(path)
  } catch (err) {
    throw toFsError(err, path)
  }
}

/**
 * Remove a path. `force` suppresses ENOENT and `recursive` descends into directories,
 * exactly as `fs.rmSync` — the options are passed through rather than baked in because
 * both shapes are in real use (`{ force }` for a legacy dotfile, `{ recursive, force }`
 * for a scratch directory).
 */
export function rmTranslated(path: string, opts: { recursive?: boolean; force?: boolean }): void {
  try {
    rmSync(path, opts)
  } catch (err) {
    throw toFsError(err, path)
  }
}

/**
 * Create a symlink at `path` pointing at `target`. EEXIST is NOT in the errno catalog, so
 * `toFsError` returns it unchanged and a caller's TOCTOU re-check on `err.code` keeps
 * working (CANON-17 deliberately exempts handlers that inspect `err.code`).
 */
export function symlinkTranslated(
  target: string,
  path: string,
  type?: 'dir' | 'file' | 'junction',
): void {
  try {
    symlinkSync(target, path, type)
  } catch (err) {
    throw toFsError(err, path)
  }
}

/** Create a uniquely-named temp directory from `prefix` and return its path. */
export function mkdtempTranslated(prefix: string): string {
  try {
    return mkdtempSync(prefix)
  } catch (err) {
    throw toFsError(err, prefix)
  }
}

/**
 * Atomically create a file with exclusive-create semantics (`writeFileSync(path, content, { flag: 'wx' })`).
 * This is the locking primitive, NOT "write a file": the `wx` flag is the atomic
 * exclusive-create that IS the mutual exclusion, so a `writeFileTranslated` here would
 * destroy it.
 *
 * Contract: EEXIST is deliberately NOT translated — the caller branches on
 * `err.code === 'EEXIST'` (file-lock.ts's contention path builds a LockConflictError
 * from it), and a translated ArbiterError would silently kill that arm. Every other
 * errno is passed through toFsError (CANON-17), which translates the cataloged codes
 * and returns unknown codes unchanged. writeFileSync (not openSync+writeSync) so a
 * short write or a close error cannot mask the primary failure.
 */
export function createExclusiveTranslated(path: string, content: string): void {
  try {
    writeFileSync(path, content, { flag: 'wx' })
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'EEXIST') throw err
    throw toFsError(err, path)
  }
}

/**
 * Copy a file or a directory tree from `src` to `dest`. `recursive` is passed through
 * exactly as `fs.cpSync` — a directory copy requires it. `toFsError` names whichever
 * side of a two-path failure the errno actually carries (`e.path` wins), so the caller
 * does not have to guess which side failed.
 */
export function copyTreeTranslated(
  src: string,
  dest: string,
  opts: { recursive?: boolean } = {},
): void {
  try {
    cpSync(src, dest, opts)
  } catch (err) {
    throw toFsError(err, dest)
  }
}

/**
 * Read a file, translating a raw fs errno into an ArbiterError (CANON-17, #2293).
 * The 25 bare readFileSync sites in src/ had no enclosing try, so a raw errno
 * (ENOENT, EACCES, EISDIR, ...) reached the user as an unstyled Node stack. This is
 * the single route for a read whose failure must surface as an actionable hint.
 * Callers that need a fallback for a MISSING file keep their existsSync guard (the
 * residual here is EACCES/EISDIR/TOCTOU, not ENOENT) or catch the translated error
 * and branch on `err.code` — ArbiterError preserves the errno code.
 */
export function readFileTranslated(path: string): Buffer
export function readFileTranslated(path: string, encoding: 'utf8' | 'utf-8'): string
export function readFileTranslated(path: string, encoding?: 'utf8' | 'utf-8'): string | Buffer {
  try {
    return encoding ? readFileSync(path, encoding) : readFileSync(path)
  } catch (err) {
    throw toFsError(err, path)
  }
}

/**
 * Deeply merge two settings.json objects. Arrays are unioned (no duplicates by 'command').
 * All top-level keys from `existing` are preserved unchanged unless arbiter manages them
 * (currently: `hooks`, `permissions`).
 *
 * When a non-special incoming key collides with a non-undefined existing value, the existing
 * value wins (no clobber) but a logger.warn is emitted listing the dropped keys so users
 * can pick up the new arbiter defaults if they choose (#286).
 */
export function mergeSettingsJson(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing }
  const dropped: string[] = []

  for (const [key, incomingVal] of Object.entries(incoming)) {
    const existingVal = existing[key]

    if (key === 'hooks' && isHooksObject(incomingVal) && isHooksObject(existingVal)) {
      result[key] = mergeHooks(existingVal, incomingVal)
    } else if (key === 'permissions' && isPermissions(incomingVal) && isPermissions(existingVal)) {
      result[key] = mergePermissions(existingVal, incomingVal)
    } else if (existingVal === undefined) {
      result[key] = incomingVal
    } else {
      dropped.push(key)
    }
  }

  if (dropped.length > 0) {
    getLogger().warn(
      'fs.settings_merge_preserved',
      { dropped_keys: dropped.join(',') },
      `settings.json merge preserved your existing values for these top-level keys; ` +
        `arbiter's new defaults were NOT applied: ${dropped.join(', ')}. ` +
        `Remove these keys from .claude/settings.json and re-run to pick up the new defaults.`,
    )
  }

  return result
}

type HookEntry = {
  matcher: string
  hooks: { type: string; command: string; timeout?: number }[]
}
type HooksObject = Record<string, HookEntry[]>
type Permissions = { allow?: string[]; deny?: string[] }

function isHooksObject(val: unknown): val is HooksObject {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function isPermissions(val: unknown): val is Permissions {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Known arbiter-managed hook basenames — used to clean up old entries when
 * upgrading to the dispatcher pattern (#248).
 */
const ARBITER_HOOK_BASENAMES = new Set([
  'stop-dangerous',
  'enforce-read-only',
  'pre-edit-ssot-guard',
  'check-no-orphan-todo',
  'check-no-placeholders',
  'lib',
  'post-commit-check',
  'check-no-unused-exports',
  'pre-edit-plan-anchor',
  'pre-compact',
  'post-edit-dispatch',
  'debug-state-on-failure',
  'skill-forced-eval',
  'guard-task-completion',
  'guard-done-evidence',
  'check-circular-deps',
  'check-no-pii',
  'hooks',
])

function extractHookBasename(command: string): string | null {
  const match = command.match(/\.claude\/hooks\/([^./\s]+)\.\w+/)
  return match?.[1] ?? null
}

function isDispatcherCommand(command: string): boolean {
  return /\.claude\/hooks\/hooks\.mjs\b/.test(command)
}

function mergeHooks(existing: HooksObject, incoming: HooksObject): HooksObject {
  const result: HooksObject = { ...existing }

  for (const [event, incomingEntries] of Object.entries(incoming)) {
    const existingEntries = existing[event] ?? []
    const merged = [...existingEntries]

    for (const incomingEntry of incomingEntries) {
      const existingEntry = merged.find((e) => e.matcher === incomingEntry.matcher)
      if (existingEntry) {
        mergeHookEntry(existingEntry, incomingEntry, event)
      } else {
        merged.push(incomingEntry)
      }
    }

    result[event] = merged
  }

  return result
}

function mergeHookEntry(existingEntry: HookEntry, incomingEntry: HookEntry, event: string): void {
  const hasDispatcherIncoming = incomingEntry.hooks.some((h) => isDispatcherCommand(h.command))

  for (const hook of incomingEntry.hooks) {
    if (hasDispatcherIncoming && isDispatcherCommand(hook.command)) {
      // Dispatcher upgrade: remove all previously arbiter-managed hook entries
      // so old individual hook commands don't persist alongside the dispatcher.
      const existingDispatcher = existingEntry.hooks.find((h) => isDispatcherCommand(h.command))
      existingEntry.hooks = existingEntry.hooks.filter((h) => {
        const basename = extractHookBasename(h.command)
        return (
          isDispatcherCommand(h.command) ||
          basename === null ||
          !ARBITER_HOOK_BASENAMES.has(basename)
        )
      })
      if (existingDispatcher && existingDispatcher.command !== hook.command) {
        getLogger().warn(
          'fs.hook_command_preserved',
          {
            hook_event: event,
            matcher: existingEntry.matcher,
            existing_command: existingDispatcher.command,
            incoming_command: hook.command,
          },
          `settings.json merge preserved your existing dispatcher command for matcher ` +
            `${existingEntry.matcher}; arbiter's dispatcher command was NOT applied.`,
        )
        continue
      }
    } else {
      const incomingBasename = extractHookBasename(hook.command)
      if (incomingBasename) {
        // Remove old variants of the same hook (e.g. .sh → .mjs upgrade)
        existingEntry.hooks = existingEntry.hooks.filter((h) => {
          const existingBasename = extractHookBasename(h.command)
          return existingBasename !== incomingBasename
        })
      }
    }
    // Add the incoming hook if not already present
    const existingCommands = new Set(existingEntry.hooks.map((h) => h.command))
    if (!existingCommands.has(hook.command)) {
      existingEntry.hooks.push(hook)
    }
  }
}

function mergePermissions(existing: Permissions, incoming: Permissions): Permissions {
  const unionArrays = (a: string[] = [], b: string[] = []): string[] => [...new Set([...a, ...b])]
  return {
    allow: unionArrays(existing.allow, incoming.allow),
    deny: unionArrays(existing.deny, incoming.deny),
  }
}

export function resolvedPath(targetDir: string, ...parts: string[]): string {
  return join(targetDir, ...parts)
}
