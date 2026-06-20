// SPDX-License-Identifier: Apache-2.0
// `arbiter anti-fake-green` — a THIN wrapper over the SSOT anti-fake-green aggregate (#1428).
//
// Existing Code Survey (CANON-16): the anti-fake-green guard aggregate already exists as
// scripts/check-anti-fake-green.mjs (runs the guard set, computes one disarm-proof verdict — a
// broken guard exit 2 fails the aggregate; file-scan exit 1 is hard, gh-audit exit 1 is advisory
// and fails only under --enforce). This command does NOT introduce a second aggregator: it shells
// `node scripts/check-anti-fake-green.mjs` through the INV-12 runCli helper and surfaces its exit
// code. It mirrors the gold-audit.ts thin wrapper.
//
// The matching thin runner (scripts/check-anti-fake-green.mjs.ejs) is emitted into governed targets
// so a consumer can run the aggregate with NO local arbiter install — the engine runs inside
// arbiter's own env via `npx --no-install arbiter anti-fake-green`. The gh-audit guards fail OPEN
// (advisory) when `gh` is absent, so a fresh consumer has no day-1 redness.

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'

export interface AntiFakeGreenOptions {
  /**
   * Repo to audit. The aggregate engine resolves its sibling guard scripts
   * (scripts/check-*.mjs) relative to its own cwd, so the engine ALWAYS runs from the arbiter
   * package root (where those guards live). `repo` is reserved for future per-repo scan-target
   * wiring; it does not currently change the engine cwd. Defaults to process.cwd().
   */
  repo?: string
  /** Promote advisory (gh-audit) findings to hard failures. Forwarded to the engine. */
  enforce?: boolean
  /** Raw passthrough args forwarded verbatim to the engine. */
  args?: readonly string[]
}

export interface AntiFakeGreenResult {
  exitCode: number
}

/** Resolve the package root (this file lives at src/commands/, two levels down). */
function packageRoot(): string {
  return resolve(fileURLToPath(import.meta.url), '../../..')
}

/**
 * Run the anti-fake-green aggregate by shelling the SSOT engine. Forwards --enforce + passthrough
 * args and surfaces the engine's INV-53 exit code (0=PASS, 1=FAIL, 2=ERROR). Never throws — a
 * CliError (engine non-zero exit) maps to its exit code.
 */
export function runAntiFakeGreen(opts: AntiFakeGreenOptions = {}): AntiFakeGreenResult {
  // The aggregate resolves its sibling guard scripts relative to cwd, so it must run from the
  // arbiter package root (where those guards live) — NOT the consumer repo (which has no engine).
  const root = packageRoot()
  const script = resolve(root, 'scripts/check-anti-fake-green.mjs')
  const args = [script, ...(opts.enforce ? ['--enforce'] : []), ...(opts.args ?? [])]

  try {
    const { stdout, stderr } = runCli('node', args, { cwd: root })
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    return { exitCode: 0 }
  } catch (err) {
    if (err instanceof CliError) {
      if (err.stdout) process.stdout.write(err.stdout)
      if (err.stderr) process.stderr.write(err.stderr)
      return { exitCode: err.exitCode > 0 ? err.exitCode : 1 }
    }
    process.stderr.write(`anti-fake-green: engine failed — ${String(err)}\n`)
    return { exitCode: 1 }
  }
}
