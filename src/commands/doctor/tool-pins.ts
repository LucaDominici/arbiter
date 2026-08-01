// SPDX-License-Identifier: Apache-2.0
//
// #2162 — `arbiter doctor tool-pins`: compares the LOCAL toolchain against the
// version pins recorded in the target's own CI workflows. Motivating field
// evidence: a local trivy/gitleaks older than the CI pin still prints PASSED
// (worse than a missing tool — it lies instead of warning). Read-only: only
// ever reads `.github/workflows/*.yml(.yaml)` and probes `<tool> --version`.
//
// Non-goal, cited per the issue: this is LOCAL-vs-CI parity for an arbitrary
// TARGET repo. `scripts/check-ci-tool-parity.mjs` is a different, self-scoped
// axis — arbiter's OWN ci-tools.json manifest vs arbiter's OWN workflow vs
// arbiter's OWN check-all.mjs. Not reused here; see that script for CI-internal
// manifest parity.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { jsonOutput } from '../../utils/json-output.js'
import { runCli, CliError } from '../../utils/run-cli.js'
import { extractToolPins, compareSemVer, type SemVer, type ToolPin } from './tool-pin-extract.js'

type HealthStatus = 'PASS' | 'WARN' | 'FAIL'

interface ToolPinCheck {
  id: string
  label: string
  status: HealthStatus
  detail: string
}

export interface DoctorToolPinsOptions {
  dir?: string
  json?: boolean
  /**
   * Test-only DI seam (mirrors `DoctorHealthOptions.claudeHome`): fabricate a
   * local tool's `--version` output without touching real PATH binaries.
   * `null` simulates the tool being absent from PATH.
   */
  localVersionOverride?: Record<string, string | null>
}

export interface DoctorToolPinsResult {
  exitCode: 0 | 1
  checks: ToolPinCheck[]
  pass: number
  warn: number
  fail: number
}

function formatVersion(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`
}

function parseSemVerFromVersionOutput(output: string): SemVer | undefined {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(output)
  if (!m) return undefined
  const [, major, minor, patch] = m
  if (!major || !minor) return undefined
  return { major: Number(major), minor: Number(minor), patch: patch ? Number(patch) : 0 }
}

/**
 * Probe the locally installed version of `tool` via `<tool> --version`.
 * Generic across trivy/gitleaks/hadolint/actionlint/shellcheck/etc — no
 * closed per-tool parser table, unlike `src/compatibility/probe.ts`'s
 * language-toolchain `TOOL_SPECS` (a closed set, wrong shape for gate tools).
 * Returns `undefined` when the tool is absent from PATH.
 */
function getLocalToolVersion(
  tool: string,
  override: Record<string, string | null> | undefined,
): SemVer | undefined | 'unparseable' {
  if (override && Object.prototype.hasOwnProperty.call(override, tool)) {
    const raw = override[tool]
    if (!raw) return undefined
    return parseSemVerFromVersionOutput(raw) ?? 'unparseable'
  }
  try {
    const result = runCli(tool, ['--version'], { timeoutMs: 5000 })
    const combined = `${result.stdout}\n${result.stderr}`
    return parseSemVerFromVersionOutput(combined) ?? 'unparseable'
    // FAIL-OPEN-INTENT: never crashes doctor on a probe error — "absent" surfaces as FAIL/WARN below.
  } catch (err) {
    if (err instanceof CliError) {
      if (err.notFound) return undefined
      // Non-zero exit but the tool ran (e.g. --version isn't a recognized flag
      // for it) — still try to read a version out of whatever it printed.
      const combined = `${err.stdout}\n${err.stderr}`
      return parseSemVerFromVersionOutput(combined) ?? 'unparseable'
    }
    return undefined
  }
}

function listWorkflowFiles(dir: string): string[] {
  const wfDir = join(dir, '.github', 'workflows')
  let entries: string[]
  try {
    entries = readdirSync(wfDir)
    // FAIL-OPEN-INTENT: no .github/workflows dir on the target — zero pins to check, not an error.
  } catch {
    return []
  }
  return entries.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).map((f) => join(wfDir, f))
}

/** Dedupe pins by tool: same tool pinned at multiple sites → one row, keep the
 * first file:line, take the max-version pin if sites disagree, and mark
 * blocking if ANY site for that tool is blocking. */
function dedupePins(pins: ToolPin[]): ToolPin[] {
  const byTool = new Map<string, ToolPin>()
  for (const pin of pins) {
    const existing = byTool.get(pin.tool)
    if (!existing) {
      byTool.set(pin.tool, pin)
      continue
    }
    const merged: ToolPin = {
      ...existing,
      version: compareSemVer(pin.version, existing.version) > 0 ? pin.version : existing.version,
      blocking: existing.blocking || pin.blocking,
    }
    byTool.set(pin.tool, merged)
  }
  return [...byTool.values()]
}

function buildCheck(
  pin: ToolPin,
  override: Record<string, string | null> | undefined,
): ToolPinCheck {
  const id = `tool-pin-${pin.tool}`
  const label = `${pin.tool} version matches CI pin`
  const pinDetail = `pin ${formatVersion(pin.version)} (${pin.file}:${pin.line})`
  const local = getLocalToolVersion(pin.tool, override)

  if (local === undefined) {
    return {
      id,
      label,
      status: pin.blocking ? 'FAIL' : 'WARN',
      detail: `${pin.tool} not found locally — ${pinDetail}`,
    }
  }
  if (local === 'unparseable') {
    return {
      id,
      label,
      status: 'WARN',
      detail: `${pin.tool} local version output unparseable — ${pinDetail}`,
    }
  }
  const cmp = compareSemVer(local, pin.version)
  const localDetail = `local ${formatVersion(local)}`
  if (cmp < 0) {
    return { id, label, status: 'FAIL', detail: `${pin.tool} ${localDetail} < ${pinDetail}` }
  }
  return { id, label, status: 'PASS', detail: `${pin.tool} ${localDetail} >= ${pinDetail}` }
}

function emitTextOutput(checks: ToolPinCheck[], pass: number, warn: number, fail: number): void {
  process.stdout.write('\n')
  for (const check of checks) {
    const icon = check.status === 'PASS' ? '[PASS]' : check.status === 'WARN' ? '[WARN]' : '[FAIL]'
    process.stdout.write(`  ${icon}  ${check.label}  — ${check.detail}\n`)
  }
  process.stdout.write(`\n  ${pass} passed, ${warn} warnings, ${fail} failed\n\n`)
}

export function runDoctorToolPins(opts: DoctorToolPinsOptions = {}): DoctorToolPinsResult {
  const dir = resolve(opts.dir ?? '.')
  const allPins = listWorkflowFiles(dir).flatMap((path) => {
    const text = readFileSync(path, 'utf-8')
    const rel = path.slice(dir.length + 1)
    return extractToolPins(text, rel)
  })
  const pins = dedupePins(allPins)
  const checks = pins.map((pin) => buildCheck(pin, opts.localVersionOverride))

  const pass = checks.filter((c) => c.status === 'PASS').length
  const warn = checks.filter((c) => c.status === 'WARN').length
  const fail = checks.filter((c) => c.status === 'FAIL').length
  const exitCode: 0 | 1 = fail > 0 ? 1 : 0

  if (opts.json) {
    jsonOutput('doctor tool-pins', fail > 0 ? 'error' : 'ok', { checks, pass, warn, fail })
  } else {
    emitTextOutput(checks, pass, warn, fail)
  }

  return { exitCode, checks, pass, warn, fail }
}
