// SPDX-License-Identifier: Apache-2.0
/**
 * `arbiter doctor` commands (#619, #539).
 *
 * - `repair-state`: Re-derives `.arbiter-generated.json` from `arbiter.json`.
 * - `health`: Checks Node version, git, hooks path, and AGENTS.md presence.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { jsonOutput } from '../utils/json-output.js'
import { loadConfig, writeSnapshot } from '../utils/config.js'
import { runCli } from '../utils/run-cli.js'

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

  return out
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
  const checks: HealthCheck[] = [checkNodeVersion(), gitCheck, ...checkArbiterProject(dir, gitOk)]

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
