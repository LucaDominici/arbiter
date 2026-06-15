// SPDX-License-Identifier: Apache-2.0
// arbiter — gh-audit I/O helpers (#1412). The only side-effecting layer for the anti-fake-green
// gh-audit guards; the verdict logic lives in the pure anti-fake-green-core.mjs. Lib (no entry
// point). NO-DATA (gh missing / non-zero / empty / malformed) is reported as {ok:false}, which
// callers map to an advisory SKIP at exit 0 — never a PASS, never exit 2 (see #1412 spec).

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function ghAvailable() {
  try {
    return spawnSync('gh', ['--version'], { encoding: 'utf-8' }).status === 0
  } catch {
    return false
  }
}

/** Run `gh <args>` expecting JSON. Returns {ok, data} or {ok:false, reason}. Never throws. */
export function ghJson(args) {
  let r
  try {
    r = spawnSync('gh', args, { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 })
  } catch (e) {
    return { ok: false, reason: `gh spawn failed: ${e?.message ?? e}` }
  }
  if (r.status !== 0)
    return { ok: false, reason: `gh exit ${r.status}: ${(r.stderr || '').trim()}` }
  const out = (r.stdout || '').trim()
  if (!out) return { ok: false, reason: 'gh returned empty output' }
  try {
    return { ok: true, data: JSON.parse(out) }
  } catch {
    return { ok: false, reason: 'gh output is not valid JSON' }
  }
}

/**
 * Trunk-solo attestation gate (ADR-091). Exempt ONLY when collaborationMode is trunk-solo AND the
 * ADR-091 attestation doc exists — a bare config claim without the attestation does NOT exempt
 * (config-laundering defense).
 */
export function detectSoloExempt(cwd = process.cwd()) {
  try {
    const cfgPath = join(cwd, 'arbiter.json')
    if (!existsSync(cfgPath)) return false
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'))
    if (cfg.collaborationMode !== 'trunk-solo') return false
    const attestations = [
      'docs/ADR/091-single-dev-exception-attestation.md',
      'docs/governance/SOLO_DEV_EXCEPTION.md',
    ]
    return attestations.some((p) => existsSync(join(cwd, p)))
  } catch {
    return false
  }
}

/** Shared CLI parse for gh-audit guards: argv slice, an `opt(name,default)` reader, --enforce. */
export function guardArgs() {
  const args = process.argv.slice(2)
  const opt = (n, d) => {
    const i = args.indexOf(n)
    return i >= 0 && args[i + 1] ? args[i + 1] : d
  }
  return { args, opt, enforce: args.includes('--enforce') }
}

/** Shared --json emitter: write to the path after --json, else stdout. No-op without --json. */
export function emitJson(args, opt, payload) {
  if (!args.includes('--json')) return
  const out = JSON.stringify(payload, null, 2)
  const p = opt('--json', null)
  if (p && !p.startsWith('--')) writeFileSync(p, out + '\n')
  else process.stdout.write(out + '\n')
}
