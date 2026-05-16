// SPDX-License-Identifier: Apache-2.0
/**
 * `arbiter doctor --repair-state` (#619).
 *
 * Re-derives `.arbiter-generated.json` from `arbiter.json` when the
 * snapshot is corrupt, missing the envelope, or fails checksum. This is
 * the documented escape hatch surfaced by `SnapshotChecksumError`.
 *
 * Repair is a write to `.arbiter-generated.json` ONLY — `arbiter.json`
 * is never modified.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { jsonOutput } from '../utils/json-output.js'
import { loadConfig, writeSnapshot } from '../utils/config.js'

export interface DoctorRepairStateOptions {
  dir?: string
  json?: boolean
}

export interface DoctorRepairStateResult {
  exitCode: 0 | 2
  repaired: boolean
  snapshotPath: string
}

export function runDoctorRepairState(opts: DoctorRepairStateOptions = {}): DoctorRepairStateResult {
  const dir = resolve(opts.dir ?? '.')
  const configPath = join(dir, 'arbiter.json')
  const snapshotPath = join(dir, '.arbiter-generated.json')

  if (!existsSync(configPath)) {
    const msg = `arbiter.json not found at ${configPath} — cannot repair snapshot without source-of-truth config. Run \`arbiter init\` first.`
    if (opts.json) {
      jsonOutput('doctor repair-state', 'error', { dir, configPath }, [msg])
    } else {
      process.stderr.write(`Error: ${msg}\n`)
    }
    return { exitCode: 2, repaired: false, snapshotPath }
  }

  const config = loadConfig(dir)
  if (config === null) {
    const msg = `failed to load ${configPath}`
    if (opts.json) {
      jsonOutput('doctor repair-state', 'error', { dir, configPath }, [msg])
    } else {
      process.stderr.write(`Error: ${msg}\n`)
    }
    return { exitCode: 2, repaired: false, snapshotPath }
  }

  writeSnapshot(dir, config)

  if (opts.json) {
    jsonOutput('doctor repair-state', 'ok', { snapshotPath, repaired: true })
  } else {
    process.stdout.write(`doctor: snapshot re-derived from arbiter.json → ${snapshotPath}\n`)
  }
  return { exitCode: 0, repaired: true, snapshotPath }
}
