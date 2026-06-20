// SPDX-License-Identifier: Apache-2.0
// `arbiter doc-set` — a THIN wrapper over the SSOT doc-set engine (#1428).
//
// Existing Code Survey (CANON-16): the doc-set presence auditor already exists as
// scripts/check-doc-set.mjs (deterministic manifest→present/missing audit with overlay +
// accept_any matching, --strict hard-fail, --generate stub scaffolding, --json). This command
// does NOT introduce a second auditor: it shells `node scripts/check-doc-set.mjs` through the
// INV-12 runCli helper and surfaces its exit code. It mirrors the gold-audit.ts thin wrapper.
//
// The matching thin runner (scripts/check-doc-set.mjs.ejs) is emitted into governed targets so a
// consumer can run `node scripts/check-doc-set.mjs` with NO local `yaml` dep — the engine (and its
// `yaml` parse) run inside arbiter's own env via `npx --no-install arbiter doc-set`.

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'

export interface DocSetOptions {
  /** Repo to audit (default: current directory). */
  repo?: string
  /**
   * Advisory marker used by the downstream thin runner (`arbiter doc-set --check`). The engine is
   * advisory by default (exit 0 unless `--strict`), so `--check` runs it in that default mode — a
   * fresh consumer bootstraps with no day-1 redness. Mirrors gold-audit's `--check` (#1419).
   */
  check?: boolean
  /** Raw passthrough args forwarded verbatim to the engine (e.g. --strict, --json, --generate). */
  args?: readonly string[]
}

export interface DocSetResult {
  exitCode: number
}

/** Resolve the package root (this file lives at src/commands/, two levels down). */
function packageRoot(): string {
  return resolve(fileURLToPath(import.meta.url), '../../..')
}

/**
 * Run the doc-set presence audit by shelling the SSOT engine. Forwards passthrough args and
 * surfaces the engine's INV-53 exit code (0=pass/advisory, 1=missing-mandatory-under-strict/error).
 * Never throws to the caller — a CliError (engine non-zero exit) maps to its exit code.
 */
export function runDocSet(opts: DocSetOptions = {}): DocSetResult {
  const repo = opts.repo ? resolve(opts.repo) : process.cwd()
  const script = resolve(packageRoot(), 'scripts/check-doc-set.mjs')
  const args = [script, ...(opts.args ?? [])]

  try {
    const { stdout, stderr } = runCli('node', args, { cwd: repo })
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    return { exitCode: 0 }
  } catch (err) {
    if (err instanceof CliError) {
      if (err.stdout) process.stdout.write(err.stdout)
      if (err.stderr) process.stderr.write(err.stderr)
      return { exitCode: err.exitCode > 0 ? err.exitCode : 1 }
    }
    process.stderr.write(`doc-set: engine failed — ${String(err)}\n`)
    return { exitCode: 1 }
  }
}
