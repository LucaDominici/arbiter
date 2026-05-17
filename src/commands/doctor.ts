// SPDX-License-Identifier: Apache-2.0
/**
 * `arbiter doctor` commands (#619, #539, #618).
 *
 * - `repair-state`: Re-derives `.arbiter-generated.json` from `arbiter.json`.
 * - `health`: Checks Node version, git, hooks path, and AGENTS.md presence.
 * - `recover-lock`: Force-releases a stale `.arbiter/.lock` file.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import os from 'node:os'
import { jsonOutput } from '../utils/json-output.js'
import { loadConfig, writeSnapshot } from '../utils/config.js'
import { runCli } from '../utils/run-cli.js'
import { inspectLock, forceReleaseLock } from '../utils/file-lock.js'
import type { LockInfo } from '../utils/file-lock.js'
import { resolveChannel } from '../utils/channel.js'

// ── doctor health (#539) ─────────────────────────────────────────────────────

export type HealthStatus = 'PASS' | 'WARN' | 'FAIL'

export interface HealthCheck {
  id: string
  label: string
  status: HealthStatus
  detail: string
  hint?: string
}

export interface DoctorHealthOptions {
  dir?: string
  json?: boolean
  channelFlag?: string
}

export interface DoctorHealthResult {
  exitCode: 0 | 1
  checks: HealthCheck[]
  pass: number
  warn: number
  fail: number
}

function checkNodeVersion(): HealthCheck {
  const nodeVer = process.versions.node
  const nodeMajor = parseInt(nodeVer.split('.')[0] ?? '0', 10)
  const check: HealthCheck = {
    id: 'node-version',
    label: 'Node.js version >= 22',
    status: nodeMajor >= 22 ? 'PASS' : 'FAIL',
    detail: `found ${nodeVer}`,
  }
  if (nodeMajor < 22) check.hint = 'Upgrade to Node.js >= 22. See https://nodejs.org/en/download.'
  return check
}

function checkGitAvailable(dir: string): [HealthCheck, boolean] {
  let gitOk = false
  try {
    const r = runCli('git', ['--version'], { cwd: dir, timeoutMs: 3000 })
    gitOk = r.exitCode === 0
  } catch {
    /* git not in PATH */
  }
  const check: HealthCheck = {
    id: 'git-available',
    label: 'git installed',
    status: gitOk ? 'PASS' : 'FAIL',
    detail: gitOk ? 'git found in PATH' : 'git not found in PATH',
  }
  if (!gitOk) check.hint = 'Install git from https://git-scm.com.'
  return [check, gitOk]
}

function checkArbiterProject(dir: string, gitOk: boolean): HealthCheck[] {
  const out: HealthCheck[] = []
  if (!existsSync(join(dir, 'arbiter.json'))) return out

  const agentsPresent = existsSync(join(dir, 'AGENTS.md'))
  const agentsCheck: HealthCheck = {
    id: 'agents-md',
    label: 'AGENTS.md present',
    status: agentsPresent ? 'PASS' : 'WARN',
    detail: agentsPresent ? 'found' : 'not found',
  }
  if (!agentsPresent) agentsCheck.hint = 'Run `arbiter init` to generate AGENTS.md.'
  out.push(agentsCheck)

  out.push({
    id: 'integrations',
    label: 'Skill integrations discoverable',
    status: 'PASS',
    detail: 'advisory — run `arbiter integrations list` to see detected + recommended skills',
    hint: 'arbiter integrations list',
  })

  if (gitOk) {
    let hooksPath = ''
    try {
      const r = runCli('git', ['config', 'core.hooksPath'], { cwd: dir, timeoutMs: 3000 })
      hooksPath = r.stdout.trim()
    } catch {
      /* not configured */
    }
    const hooksCheck: HealthCheck = {
      id: 'hooks-path',
      label: 'git hooks path configured',
      status: hooksPath.length > 0 ? 'PASS' : 'WARN',
      detail: hooksPath.length > 0 ? `core.hooksPath = ${hooksPath}` : 'core.hooksPath not set',
    }
    if (hooksPath.length === 0)
      hooksCheck.hint = 'Run `git config core.hooksPath .githooks` to enable hooks.'
    out.push(hooksCheck)
  }

  out.push(checkLockfile(dir))

  return out
}

/**
 * #618 — doctor reports stale `.arbiter/.lock` files.
 * Treats a lock as stale if PID is not alive (same-host only) or age > 6h.
 */
function readLockInfoForHealth(lockPath: string): LockInfo | null {
  try {
    const raw = readFileSync(lockPath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const ok =
      typeof parsed.pid === 'number' &&
      typeof parsed.hostname === 'string' &&
      typeof parsed.bootId === 'string' &&
      typeof parsed.startedAt === 'string' &&
      typeof parsed.cmd === 'string' &&
      typeof parsed.nonce === 'string'
    return ok ? (parsed as unknown as LockInfo) : null
  } catch {
    return null
  }
}

function probePidAlive(pid: number): boolean | null {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return code === 'EPERM' ? null : false
  }
}

const LOCK_CHECK_ID = 'arbiter-lock'

function checkLockfile(dir: string): HealthCheck {
  const lockPath = join(dir, '.arbiter', '.lock')
  if (!existsSync(lockPath)) {
    return {
      id: LOCK_CHECK_ID,
      label: '.arbiter/.lock not present',
      status: 'PASS',
      detail: 'no leftover lock file',
    }
  }
  const info = readLockInfoForHealth(lockPath)
  if (info === null) {
    return {
      id: LOCK_CHECK_ID,
      label: '.arbiter/.lock unreadable',
      status: 'WARN',
      detail: 'lock file exists but contents are not valid JSON',
      hint: `Run \`arbiter doctor recover-lock\` to remove it.`,
    }
  }
  const sameHost = info.hostname === os.hostname()
  const ageMs = Date.now() - new Date(info.startedAt).getTime()
  const ageH = Math.round(ageMs / 36e5)
  const pidAlive = sameHost ? probePidAlive(info.pid) : null
  const stale = sameHost && (pidAlive === false || ageMs > 6 * 3600_000)
  if (stale) {
    const aliveLabel = pidAlive === false ? 'not alive' : `age ${ageH}h`
    return {
      id: LOCK_CHECK_ID,
      label: '.arbiter/.lock stale',
      status: 'WARN',
      detail: `pid ${info.pid} (${aliveLabel}), cmd: ${info.cmd}`,
      hint: 'Run `arbiter doctor recover-lock` to clean up.',
    }
  }
  return {
    id: LOCK_CHECK_ID,
    label: '.arbiter/.lock active',
    status: 'PASS',
    detail: `pid ${info.pid}, age ${ageH}h${sameHost ? '' : ' (other host)'}`,
  }
}

function checkChannelSetting(dir: string, channelFlag: string | undefined): HealthCheck {
  try {
    const config = loadConfig(dir)
    const resolved = resolveChannel({
      ...(channelFlag !== undefined && { flag: channelFlag }),
      ...(config?.channel !== undefined && { config: config.channel }),
    })
    return {
      id: 'release-channel',
      label: 'release channel',
      status: 'PASS',
      detail: `${resolved.value} (${resolved.source})`,
    }
  } catch (err) {
    return {
      id: 'release-channel',
      label: 'release channel',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
      hint: 'Fix or delete arbiter.json and re-run `arbiter init`.',
    }
  }
}

function emitHealthOutput(checks: HealthCheck[], pass: number, warn: number, fail: number): void {
  process.stdout.write('\n')
  for (const check of checks) {
    const icon = check.status === 'PASS' ? '[PASS]' : check.status === 'WARN' ? '[WARN]' : '[FAIL]'
    process.stdout.write(`  ${icon}  ${check.label}  — ${check.detail}\n`)
    if (check.hint) process.stdout.write(`         hint: ${check.hint}\n`)
  }
  process.stdout.write(`\n  ${pass} passed, ${warn} warnings, ${fail} failed\n\n`)
}

export function runDoctorHealth(opts: DoctorHealthOptions = {}): DoctorHealthResult {
  const dir = resolve(opts.dir ?? '.')
  const [gitCheck, gitOk] = checkGitAvailable(dir)
  const checks: HealthCheck[] = [
    checkNodeVersion(),
    gitCheck,
    ...checkArbiterProject(dir, gitOk),
    checkChannelSetting(dir, opts.channelFlag),
  ]

  const pass = checks.filter((c) => c.status === 'PASS').length
  const warn = checks.filter((c) => c.status === 'WARN').length
  const fail = checks.filter((c) => c.status === 'FAIL').length

  if (opts.json) {
    jsonOutput('doctor health', fail > 0 ? 'error' : 'ok', { checks, pass, warn, fail })
  } else {
    emitHealthOutput(checks, pass, warn, fail)
  }

  return { exitCode: fail > 0 ? 1 : 0, checks, pass, warn, fail }
}

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

export function runDoctorRepairState(opts: DoctorRepairStateOptions = {}): DoctorRepairStateResult {
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

  writeSnapshot(dir, config)

  if (opts.json) {
    jsonOutput(REPAIR_STATE_CMD, 'ok', { snapshotPath, repaired: true })
  } else {
    process.stdout.write(`doctor: snapshot re-derived from arbiter.json → ${snapshotPath}\n`)
  }
  return { exitCode: 0, repaired: true, snapshotPath }
}

// ── doctor recover-lock (#618) ────────────────────────────────────────────────

export interface DoctorRecoverLockOptions {
  dir?: string
  json?: boolean
}

export interface DoctorRecoverLockResult {
  found: boolean
  released: boolean
  info?: LockInfo
}

export async function runDoctorRecoverLock(
  opts: DoctorRecoverLockOptions = {},
): Promise<DoctorRecoverLockResult> {
  const targetDir = resolve(opts.dir ?? '.')
  const lockPath = join(targetDir, '.arbiter', '.lock')

  const info = await inspectLock(lockPath)
  if (!info) {
    if (opts.json) {
      jsonOutput('doctor recover-lock', 'ok', { found: false, released: false })
    } else {
      process.stdout.write(`  No lock file found at ${lockPath}\n`)
    }
    return { found: false, released: false }
  }

  if (!opts.json) {
    const age = Math.round((Date.now() - new Date(info.startedAt).getTime()) / 1000)
    const onThisHost = info.hostname === os.hostname() ? 'yes' : 'no'
    process.stdout.write(`  Lock found:\n`)
    process.stdout.write(`    pid:       ${info.pid}\n`)
    process.stdout.write(`    hostname:  ${info.hostname}\n`)
    process.stdout.write(`    cmd:       ${info.cmd}\n`)
    process.stdout.write(`    age:       ${age}s\n`)
    process.stdout.write(`    this host: ${onThisHost}\n`)
  }

  await forceReleaseLock(lockPath, info.pid, targetDir)

  if (opts.json) {
    jsonOutput('doctor recover-lock', 'ok', { found: true, released: true, info })
  } else {
    process.stdout.write(`  Lock released.\n`)
  }
  return { found: true, released: true, info }
}
