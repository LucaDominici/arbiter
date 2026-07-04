// SPDX-License-Identifier: Apache-2.0
// scripts/lib/loud-bypass.mjs
//
// Workstream C Port #10 — loud-bypass contract library.
//
// Provides a single deterministic, defensive contract for new arbiter env-var
// bypass gates (e.g. ARBITER_PREPUSH_BYPASS, ARBITER_GATE_BYPASS).
//
// Contract (RED-TEAM B2 + N6 amendments):
//   - value === 'true' (exact string)  → returns { bypassed: true, ... }
//   - any other non-empty value       → returns { bypassed: false } + LOUD
//                                       stderr warning + JSONL append.
//                                       **Never throws, never exits non-zero.**
//   - undefined / ''                  → returns { bypassed: false }, silent,
//                                       no JSONL append.
//
// IMPORTANT: this library is for NEW env vars only. The existing legacy
// contracts (ARBITER_SKIP_TDD=1, ARBITER_*_BYPASS=1 in template hooks) are
// intentionally NOT migrated — they remain on their numeric-truthy semantics
// to preserve the user-facing contract documented in those scripts.
//
// Stderr log format (N6 — arbiter-specific, distinct from a prior internal convention):
//   arbiter-bypass env=<NAME> branch=<BRANCH> at=<ISO_TS> reason="<REASON>"
//
// JSONL append shape:
//   { env, branch, ts, value, bypassed, reason }

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const DEFAULT_LOG_PATH = '.arbiter/evidence/bypass-log.jsonl'

/**
 * Detect the current git branch. Best-effort; returns 'unknown' on any failure.
 *
 * INV-12 exception: direct child_process use is the documented carve-out for
 * .mjs gate-utility libraries that must run pre-build and cannot pull from src/
 * (same pattern as scripts/lib/run-helpers.mjs). Every failure path returns the
 * literal 'unknown' string — the function never throws and never exits.
 *
 * @param {string} [cwd]
 * @returns {string}
 */
function detectBranch(cwd) {
  try {
    const out = execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf-8',
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const branch = String(out || '').trim()
    return branch.length > 0 ? branch : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Emit one JSONL record to the bypass log. Best-effort: any IO failure is
 * surfaced as a quiet stderr note but never thrown.
 * @param {string} logPath
 * @param {Record<string, unknown>} record
 */
function appendJsonl(logPath, record) {
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf-8')
  } catch (err) {
    // Defensive — never let logging failure propagate.
    try {
      process.stderr.write(
        `arbiter-bypass log-append-failed path=${logPath} err=${String(err?.message ?? err)}\n`,
      )
    } catch {
      /* swallow */
    }
  }
}

/**
 * Format the loud stderr line. Deliberately key=value with `arbiter-bypass`
 * token — must NOT match a prior internal convention's `[BYPASS]` bracketed pattern.
 * @param {{ env: string; branch: string; ts: string; reason: string }} fields
 */
function formatLine({ env, branch, ts, reason }) {
  return `arbiter-bypass env=${env} branch=${branch} at=${ts} reason="${reason}"\n`
}

/**
 * @typedef {Object} CheckBypassOpts
 * @property {string} [reason]   - Caller-supplied reason; used only on exact bypass.
 * @property {NodeJS.ProcessEnv} [env]   - Defaults to process.env (for tests).
 * @property {string} [branch]   - Override branch detection (for tests).
 * @property {() => Date} [now]  - Clock override (for tests).
 * @property {string} [logPath]  - JSONL log path (default .arbiter/evidence/bypass-log.jsonl).
 * @property {string} [cwd]      - CWD for branch detection + relative log resolution.
 * @property {NodeJS.WritableStream} [stderr] - Stderr override (for tests).
 */

/**
 * @typedef {Object} CheckBypassResult
 * @property {boolean} bypassed
 * @property {string} [reason]
 * @property {string} [branch]
 * @property {string} [ts]
 */

/**
 * Inspect an env var and decide whether to honor a bypass.
 *
 * @param {string} envName
 * @param {CheckBypassOpts} [opts]
 * @returns {CheckBypassResult}
 */
export function checkBypass(envName, opts = {}) {
  try {
    const env = opts.env ?? process.env
    const value = env[envName]

    // Silent path: env var absent or empty string
    if (value === undefined || value === '') {
      return { bypassed: false }
    }

    const stderr = opts.stderr ?? process.stderr
    const cwd = opts.cwd ?? process.cwd()
    const logPath = resolve(cwd, opts.logPath ?? DEFAULT_LOG_PATH)
    const branch = opts.branch ?? detectBranch(cwd)
    const now = opts.now ?? (() => new Date())
    const ts = now().toISOString()

    if (value === 'true') {
      // Exact bypass — caller-supplied reason
      const reason = opts.reason ?? 'bypass requested'
      try {
        stderr.write(formatLine({ env: envName, branch, ts, reason }))
      } catch {
        /* defensive */
      }
      appendJsonl(logPath, {
        env: envName,
        branch,
        ts,
        value,
        bypassed: true,
        reason,
      })
      return { bypassed: true, reason, branch, ts }
    }

    // Ambiguous value — warn loudly, return bypassed:false, NEVER exit non-zero (B2)
    const reason = `ambiguous value '${value}' rejected — only the exact string 'true' triggers bypass`
    try {
      stderr.write(formatLine({ env: envName, branch, ts, reason }))
    } catch {
      /* defensive */
    }
    appendJsonl(logPath, {
      env: envName,
      branch,
      ts,
      value,
      bypassed: false,
      reason,
    })
    return { bypassed: false }
  } catch (err) {
    // Last-resort defensive catch. The contract is "never throw, never exit".
    try {
      process.stderr.write(
        `arbiter-bypass internal-error env=${envName} err=${String(err?.message ?? err)}\n`,
      )
    } catch {
      /* swallow */
    }
    return { bypassed: false }
  }
}
