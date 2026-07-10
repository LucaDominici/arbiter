// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from doctor.ts — the `arbiter doctor
// repair-state` subcommand (#619). Pure extraction, no behavior change.
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { acquireLock } from '../../utils/file-lock.js'
import { jsonOutput } from '../../utils/json-output.js'
import { loadConfig, writeSnapshot } from '../../utils/config.js'

// ── doctor repair-state (#619) ───────────────────────────────────────────────

export interface DoctorRepairStateOptions {
  dir?: string
  json?: boolean
}

export interface DoctorRepairStateResult {
  exitCode: 0 | 2
  repaired: boolean
  snapshotPath: string
}

const REPAIR_STATE_CMD = 'doctor repair-state'

export async function runDoctorRepairState(
  opts: DoctorRepairStateOptions = {},
): Promise<DoctorRepairStateResult> {
  const dir = resolve(opts.dir ?? '.')
  const configPath = join(dir, 'arbiter.json')
  const snapshotPath = join(dir, '.arbiter-generated.json')

  if (!existsSync(configPath)) {
    const msg = `arbiter.json not found at ${configPath} — cannot repair snapshot without source-of-truth config. Run \`arbiter init\` first.`
    if (opts.json) {
      jsonOutput(REPAIR_STATE_CMD, 'error', { dir, configPath }, [msg])
    } else {
      process.stderr.write(`Error: ${msg}\n`)
    }
    return { exitCode: 2, repaired: false, snapshotPath }
  }

  const config = loadConfig(dir)
  if (config === null) {
    const msg = `failed to load ${configPath}`
    if (opts.json) {
      jsonOutput(REPAIR_STATE_CMD, 'error', { dir, configPath }, [msg])
    } else {
      process.stderr.write(`Error: ${msg}\n`)
    }
    return { exitCode: 2, repaired: false, snapshotPath }
  }

  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  const lock = await acquireLock(join(dir, '.arbiter', '.lock'))
  try {
    writeSnapshot(dir, config)
  } finally {
    await lock.release()
  }

  // A9 (#1328): repair-state re-derives the snapshot from arbiter.json but CANNOT
  // re-derive the per-file content-hash manifest (.arbiter-generated-manifest.json),
  // whose hashes are not a function of config. Warn so the operator knows the
  // manifest may be stale relative to the freshly-repaired snapshot.
  const manifestWarning =
    'generated-manifest (.arbiter-generated-manifest.json) is NOT re-derivable from config; ' +
    'if you suspect template-fix drift, re-run `arbiter update` to refresh it.'
  if (opts.json) {
    jsonOutput(REPAIR_STATE_CMD, 'ok', { snapshotPath, repaired: true }, undefined, {
      warnings: [manifestWarning],
    })
  } else {
    process.stdout.write(`doctor: snapshot re-derived from arbiter.json → ${snapshotPath}\n`)
    process.stderr.write(`doctor: warning — ${manifestWarning}\n`)
  }
  return { exitCode: 0, repaired: true, snapshotPath }
}
