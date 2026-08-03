#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/capacity-probe.mjs (#2098) — combined local+remote saturation advisory.
//
// Root cause fixed: self-hosted CI runners share the exact same host as
// local gate execution — a load spike was once misdiagnosed as "5 concurrent
// local gates" when GH Actions runner contention was an equal contributor.
// No single signal combines local-queue-depth + remote-runner-busy; this does.
//
// Usage: capacity-probe <owner/repo>
// Prints one line, exit 0 (OK) or 1 (SATURATED).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpus, loadavg, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { countLockWaiters } from './lib/waiter-count.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

// ── local load — Node stdlib covers this, no /proc parsing or `nproc` shell-out needed ──

export function localLoad() {
  return { load1: loadavg()[0], nproc: cpus().length }
}

// ── gate-queue depth ──
//
// Mirrors src/commands/gate-exec.ts's deriveGateKey()/gateLockPath() exactly
// (sha256 of the resolved git-common-dir, first 16 hex chars). Tolerated
// duplication (#2098 scope: only the fd-count logic is a shared helper, not
// the key derivation) — pinned safe by a parity test
// (__tests__/scripts/capacity-probe.test.ts) that asserts this function
// produces the byte-identical path to the real gateLockPath().
export function gateLockPathFor(dir, env = process.env) {
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: dir,
    encoding: 'utf-8',
  }).trim()
  const absolute = resolve(dir, commonDir)
  const key = createHash('sha256').update(absolute).digest('hex').slice(0, 16)
  const base = env.XDG_RUNTIME_DIR || tmpdir()
  return join(base, 'arbiter', `${key}-gate.lock`)
}

export function gateQueueDepth(dir = process.cwd()) {
  try {
    return countLockWaiters(gateLockPathFor(dir))
    // FAIL-OPEN-INTENT: advisory signal — no repo/lock here just means zero queue depth.
  } catch {
    return 0
  }
}

// ── remote (gh) — advisory only, never throws: unreachable/unauthenticated
// `gh` degrades to a zero signal rather than crashing the probe ──

function ghNumber(args) {
  try {
    const out = execFileSync('gh', args, { encoding: 'utf-8', timeout: 10_000 })
    const n = Number(out.trim())
    return Number.isFinite(n) ? n : 0
    // FAIL-OPEN-INTENT: advisory signal — unreachable/unauthenticated gh degrades to zero.
  } catch {
    return 0
  }
}

export function remoteSignal(ownerRepo) {
  const runnersBusy = ghNumber([
    'api',
    `repos/${ownerRepo}/actions/runners`,
    '--jq',
    '[.runners[]|select(.busy)]|length',
  ])
  const runnersTotal = ghNumber([
    'api',
    `repos/${ownerRepo}/actions/runners`,
    '--jq',
    '.runners|length',
  ])
  const queuedRuns = ghNumber([
    'run',
    'list',
    '-R',
    ownerRepo,
    '--status',
    'queued',
    '--json',
    'databaseId',
    '--jq',
    'length',
  ])
  return { runnersBusy, runnersTotal, queuedRuns }
}

// ── verdict — pure, unit-testable without touching gh/os/fs ──

/**
 * SATURATED iff (all runners busy AND a run is queued) OR (load > 1.5x nproc)
 * OR (gate-queue depth >= 3).
 * ponytail: thresholds are a first cut (no data behind 1.5x / 3 yet) — tune
 * via flags if they misfire in practice, not preemptively configurable.
 * @param {{load1:number, nproc:number, gateQueueDepth:number, runnersBusy:number, runnersTotal:number, queuedRuns:number}} signals
 */
export function computeVerdict(signals) {
  const {
    load1,
    nproc,
    gateQueueDepth: queueDepth,
    runnersBusy,
    runnersTotal,
    queuedRuns,
  } = signals
  const remoteSaturated = runnersTotal > 0 && runnersBusy >= runnersTotal && queuedRuns > 0
  const loadSaturated = load1 > 1.5 * nproc
  const queueSaturated = queueDepth >= 3
  return {
    saturated: remoteSaturated || loadSaturated || queueSaturated,
    remoteSaturated,
    loadSaturated,
    queueSaturated,
  }
}

async function main() {
  const [ownerRepo] = process.argv.slice(2)
  if (!ownerRepo) {
    process.stderr.write('usage: capacity-probe <owner/repo>\n')
    process.exit(2)
  }

  const { load1, nproc } = localLoad()
  const queueDepth = gateQueueDepth()
  const { runnersBusy, runnersTotal, queuedRuns } = remoteSignal(ownerRepo)
  const verdict = computeVerdict({
    load1,
    nproc,
    gateQueueDepth: queueDepth,
    runnersBusy,
    runnersTotal,
    queuedRuns,
  })

  process.stdout.write(
    `capacity-probe: ${verdict.saturated ? 'SATURATED' : 'OK'} ` +
      `load=${load1.toFixed(2)}/${nproc} queue=${queueDepth} runners=${runnersBusy}/${runnersTotal} busy queued=${queuedRuns}\n`,
  )
  process.exit(verdict.saturated ? 1 : 0)
}

const isMain = isMainModule(import.meta.url)
if (isMain) {
  try {
    await main()
  } catch (e) {
    process.stderr.write(`capacity-probe: unexpected error: ${e.stack ?? e}\n`)
    process.exit(1)
  }
}
