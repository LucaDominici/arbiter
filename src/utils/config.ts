// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { ensureDir } from './fs.js'
import { join } from 'node:path'
import { writeFile, assertWritten } from './fs.js'
import { acquireLock } from './file-lock.js'
import { getLogger } from './logger.js'
import { ConfigError } from './errors.js'
import { type ArbiterConfigV2, sanitizeCoercibleFields, validateConfig } from '../config/schema.js'
import { migrate } from '../config/migrations/index.js'
import { applyEnvOverrides } from '../config/env-overrides.js'
import { rotateBackup } from '../state/backups.js'
import {
  SnapshotChecksumError,
  canonicalJson,
  wrapSnapshot,
  unwrapSnapshot,
} from '../state/envelope.js'
import { migrateState } from '../state/migrations/index.js'

export type { ArbiterConfigV2 }
export type ArbiterConfig = ArbiterConfigV2

const CONFIG_FILE = 'arbiter.json'
const SNAPSHOT_FILE = '.arbiter-generated.json'

/**
 * Persist `arbiter.json` under a robust advisory lock.
 *
 * Mutual exclusion across the whole config-writer set is the COMMAND-level
 * `.arbiter/.lock`: every config-mutating command — init, configure, plugin,
 * upgrade-level, update AND kit-install (#1617) — acquires `.arbiter/.lock`
 * around its entire `loadConfig → mutate → save`, so no two of them can
 * lost-update each other's `arbiter.json`. `acquireLock` is reentrant (#1617),
 * so holding that command lock and re-entering it from a nested writer is a
 * ref-counted no-op rather than a self-deadlock.
 *
 * Within that boundary `saveConfig` ALSO serialises through `.arbiter/kit.lock`
 * via the crash-safe `acquireLock` primitive (file-lock.ts): it performs
 * stale-takeover (a lock orphaned by a crashed/SIGKILL'd run is reclaimed
 * instead of bricking every future write), registers exit/SIGINT/SIGTERM/SIGHUP
 * cleanup, refuses symlinked lock paths, and raises actionable `E_LOCK_*` errors
 * that point at `arbiter doctor recover-lock`. `kit.lock` is a distinct inner
 * lock from `.arbiter/.lock`; `doctor` is taught about both (#1517).
 *
 * #2541: `arbiter.json` is never a generator-emitted target — no `src/generators/*.ts`
 * writes it, and `arbiter update`'s own docs (docs/REFERENCE/file-stability.md) record
 * that it is "never recorded as a manifest entry"; its user-edit protection is the
 * load→mutate→save merge every caller (`configure`, `plugin`, `update`, `upgrade-level`,
 * `init`) already performs at the JS-object level, not `writeFile`'s template-regeneration
 * machinery. It is therefore written with `skipPreserveCheck`, exempting it from the
 * `arbiter:preserve` marker (a config VALUE that happens to contain that literal
 * substring must not permanently freeze the user's own config out from under `arbiter
 * configure`/`update`). The returned `WriteResult` is asserted via `assertWritten` so a
 * write that still did not land — for whatever reason — is a loud failure, never a
 * silently-skipped success.
 */
export async function saveConfig(dir: string, config: ArbiterConfig): Promise<void> {
  const lockDir = join(dir, '.arbiter')
  ensureDir(lockDir)
  const lock = await acquireLock(join(lockDir, 'kit.lock'))
  try {
    const path = join(dir, CONFIG_FILE)
    const result = writeFile(path, JSON.stringify(config, null, 2) + '\n', {
      skipPreserveCheck: true,
    })
    assertWritten(result, `arbiter config at ${path}`)
  } finally {
    await lock.release()
  }
}

/**
 * Persist `arbiter.json` AND its `.arbiter-generated.json` snapshot.
 *
 * Unlike `saveConfig` this takes no inner lock of its own: its sole caller is
 * `arbiter update`, which holds the command-level `.arbiter/.lock` (reentrant,
 * #1617) across the whole read-modify-write — the same lock kit-install and the
 * other config writers hold, so update and kit-install are mutually excluded and
 * cannot lost-update each other (#1617). Callers MUST hold `.arbiter/.lock`.
 *
 * #2541: see `saveConfig` above for why `arbiter.json` is written with
 * `skipPreserveCheck` and its `WriteResult` asserted. `writeSnapshot` (below) applies
 * the same treatment to `.arbiter-generated.json`.
 */
export function saveConfigAndSnapshot(dir: string, config: ArbiterConfig): void {
  const json = JSON.stringify(config, null, 2) + '\n'
  const path = join(dir, CONFIG_FILE)
  const result = writeFile(path, json, { skipPreserveCheck: true })
  assertWritten(result, `arbiter config at ${path}`)
  writeSnapshot(dir, config)
}

/**
 * Write only the snapshot envelope (`.arbiter-generated.json`) without
 * touching `arbiter.json`. Used by `arbiter doctor --repair-state` so
 * repair never clobbers the source-of-truth config (#619).
 *
 * #2541: `.arbiter-generated.json` is documented (docs/REFERENCE/file-stability.md) as
 * a machine-written state file — "No" user-editable, migrated automatically by
 * `arbiter update`'s schema migration registry, and (like `arbiter.json`) never a
 * generator-emitted target and never recorded in the generated-file manifest. It is
 * generation provenance, the same class as TDD evidence and the task-state document —
 * so it is written with `skipPreserveCheck`, and the `WriteResult` is asserted via
 * `assertWritten` so a withheld write (or any other reason the bytes did not land) is a
 * loud failure rather than a silent no-op that leaves stale provenance on disk.
 */
export function writeSnapshot(dir: string, config: ArbiterConfig): void {
  const snapPath = join(dir, SNAPSHOT_FILE)
  rotateBackup(snapPath)
  const envelope = wrapSnapshot(config)
  const result = writeFile(snapPath, canonicalJson(envelope) + '\n', { skipPreserveCheck: true })
  assertWritten(result, `arbiter config snapshot at ${snapPath}`)
}

/**
 * Read `.arbiter-generated.json` and return the inner config.
 *
 * Behavior:
 *   - Missing file → null (legitimate, never raises).
 *   - Unreadable JSON → null + logger.warn (don't crash arbiter on garbage).
 *   - v0 (pre-envelope) snapshot → auto-migrated through config migrate(),
 *     returned without persisting (callers re-persist on next write).
 *   - v1 envelope with mismatched checksum → THROWS SnapshotChecksumError
 *     (#619 acceptance: hard error, no silent overwrite).
 *   - v1 envelope with valid checksum → unwrapped + run through config
 *     migrate() before return.
 */
export function loadSnapshot(dir: string): ArbiterConfig | null {
  const path = join(dir, SNAPSHOT_FILE)
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().warn(
      'config.snapshot_unreadable',
      { path, file: SNAPSHOT_FILE, err: msg },
      `${SNAPSHOT_FILE} at ${path} is unreadable (${msg}) — delete the file to regenerate on next 'arbiter update'`,
    )
    return null
  }
  let inner: unknown
  try {
    const state = migrateState(raw)
    if (!state.migrated) {
      // v1 envelope on disk — verify checksum (HARD error on mismatch, #619).
      unwrapSnapshot(raw)
    }
    inner = state.envelope.config
  } catch (err) {
    if (err instanceof SnapshotChecksumError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().warn(
      'config.snapshot_envelope_failed',
      { path, file: SNAPSHOT_FILE, err: msg },
      `${SNAPSHOT_FILE} at ${path} failed envelope check (${msg}) — skipping snapshot`,
    )
    return null
  }
  try {
    return migrate(inner)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().warn(
      'config.snapshot_migration_failed',
      { path, file: SNAPSHOT_FILE, err: msg },
      `${SNAPSHOT_FILE} at ${path} failed config migration (${msg}) — skipping snapshot`,
    )
    return null
  }
}

export function loadConfig(dir: string): ArbiterConfig | null {
  const path = join(dir, CONFIG_FILE)
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ConfigError(
      'E_CONFIG_INVALID',
      `arbiter.json at ${path} has invalid JSON: ${msg}. Fix or delete and re-run.`,
      { hint: 'Fix the JSON syntax or delete arbiter.json and run `arbiter init`.' },
    )
  }
  try {
    const migrated = migrate(raw)
    const withEnv = applyEnvOverrides(migrated, process.env)
    let validation = validateConfig(withEnv)
    // Never-brick fallback (T0): a first-pass validation failure is not
    // immediately fatal. A closed set of axis/identity fields (contractType,
    // databaseEngine, tools, …) is safe to coerce to a
    // documented default — see sanitizeCoercibleFields for the exact set and
    // rationale. Only when the config is STILL invalid after that pass — i.e.
    // the failure is in a field this fallback does not know how to repair —
    // do we hard-throw E_CONFIG_INVALID.
    if (!validation.ok) {
      const { draft, report } = sanitizeCoercibleFields(
        withEnv as unknown as Record<string, unknown>,
      )
      if (report.length > 0) {
        validation = validateConfig(draft)
        if (validation.ok) {
          getLogger().warn(
            'config.coerced_fields',
            { path, fields: report.map((r) => r.field).join(',') },
            `arbiter.json at ${path} had ${report.length} field(s) migrated to a safe default ` +
              `(${report.map((r) => `${r.field}: ${JSON.stringify(r.from)} → ${JSON.stringify(r.to)}`).join('; ')}). ` +
              `Run 'arbiter configure' to persist the cleaned-up values.`,
          )
        }
      }
    }
    if (!validation.ok) {
      throw new ConfigError(
        'E_CONFIG_INVALID',
        `arbiter.json at ${path} failed validation: ${validation.errors.join('; ')}. Fix or delete and re-run.`,
        {
          hint: 'Fix the configuration errors listed, or delete arbiter.json and run `arbiter init`.',
        },
      )
    }
    return validation.config
  } catch (err) {
    if (err instanceof ConfigError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new ConfigError(
      'E_CONFIG_INVALID',
      `arbiter.json at ${path} failed migration: ${msg}. Fix or delete and re-run.`,
    )
  }
}
