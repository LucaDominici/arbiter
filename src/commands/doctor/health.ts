// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from doctor.ts — the `arbiter doctor health`
// subcommand (#539). Pure extraction, no behavior change.
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import os from 'node:os'
import { jsonOutput } from '../../utils/json-output.js'
import { loadConfig } from '../../utils/config.js'
import type { ArbiterConfig } from '../../utils/config.js'
import { runCli } from '../../utils/run-cli.js'
import type { RunCliResult } from '../../utils/run-cli.js'
import { forceReleaseLock, isLockStale, readLockInfo } from '../../utils/file-lock.js'
import { ArbiterError } from '../../utils/errors.js'
import { resolveChannel } from '../../utils/channel.js'
import { detectLanguage } from '../../detectors/language.js'
import { runProbes } from '../../compatibility/probe.js'
import { isArbiterSelf } from '../ship-profile.js'
import { diagnoseCompanions } from '../../integrations/companions.js'
import { checkScaffoldWiring } from '../../detectors/scaffold-wiring.js'
import { isValidPhase } from '../task-state.js'
import {
  validateCollaborationCoherence,
  validateOverlayCoherence,
  validateAutonomyCoherence,
  validateProfileCoherence,
  validateLanguageArchetypeCoherence,
  validateTrunkSoloParityCoherence,
} from '../wizard/coherence.js'
import { resolveCollaborationMode } from '../../config/collaboration-mode-defaults.js'
import { deriveGateKey, gateLockPath } from '../gate-exec.js'
import { readFileTranslated } from '../../utils/fs.js'

/**
 * #1524: the raw shape the coherence checks read from arbiter.json. Reuses the
 * canonical {@link ArbiterConfig} type (one SSOT, no per-check inline re-declares)
 * plus the legacy top-level `enableSoloDevMode` alias the collaboration resolver
 * still honours. Read RAW (no migrate/validate) so a config that is *missing* a
 * field surfaces as an advisory WARN instead of `loadConfig` throwing.
 */
type RawCoherenceConfig = Partial<ArbiterConfig> & { enableSoloDevMode?: boolean }

/**
 * #1524: single typed read of arbiter.json for the coherence checks, replacing
 * five duplicated `JSON.parse(readFileSync(...))` blocks with divergent inline
 * narrow types. Returns null when the file is absent or unreadable so each check
 * can emit its own WARN detail.
 */
function readRawCoherenceConfig(dir: string): RawCoherenceConfig | null {
  try {
    return JSON.parse(readFileTranslated(join(dir, 'arbiter.json'), 'utf8')) as RawCoherenceConfig
  } catch {
    return null
  }
}

// ── doctor health (#539) ─────────────────────────────────────────────────────

type HealthStatus = 'PASS' | 'WARN' | 'FAIL'

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
  /** When true, auto-release stale `.arbiter/.lock` files instead of only reporting them. */
  repair?: boolean
  /**
   * #1747 — the Claude home scanned for installed companion plugins, mirroring
   * `ResolveShipProfileOptions.claudeHome` (ship-profile.ts). Defaults to `~/.claude`; tests
   * inject an isolated dir for determinism. Never the target repo (spoofing guard, #1730).
   */
  claudeHome?: string
}

export interface DoctorHealthResult {
  exitCode: 0 | 1
  checks: HealthCheck[]
  pass: number
  warn: number
  fail: number
  /** Set when --repair fired and a stale lock was released. */
  repaired?: { lockPath: string; pid: number }
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

function checkArbiterProject(dir: string, gitOk: boolean, claudeHome?: string): HealthCheck[] {
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
    detail:
      'advisory — review the detected and recommended skills in your configured integrations.',
    hint: 'Review your configured integrations and installed skills.',
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

  out.push(checkGateScript(dir))
  out.push(checkGateToolchain(dir))
  out.push(checkGateMutex(dir))
  out.push(checkScaffoldWiringHealth(dir))
  out.push(...checkLockfiles(dir))
  out.push(checkCollaborationCoherence(dir))
  out.push(checkLanguageArchetypeCoherence(dir))
  out.push(checkOverlayCoherence(dir))
  out.push(checkAutonomyCoherence(dir))
  out.push(checkProfileCoherence(dir))
  out.push(checkTrunkSoloParityWiring(dir))
  out.push(checkCompanionHealth(dir, claudeHome))
  out.push(checkBypassCeremony(dir))

  return out
}

/**
 * #1747: surface companion-plugin state in `doctor` so "the companion silently vanished
 * after a machine rebuild" is diagnosable without reading `/ship` output first. Delegates
 * every precedence decision to {@link diagnoseCompanions} (the same resolver `/ship` itself
 * uses, via `resolveModeWithSource`), so this can never drift from ship's own resolution
 * (CANON-22 — one source of truth for the mode chain).
 *
 * On arbiter-self, no companion ever activates (arbiter's own complexity is load-bearing —
 * see companions.ts), so this reports a single self-guard note instead of a per-entry row.
 * A malformed `arbiter.json` degrades to the registry-default precedence (no overrides)
 * rather than throwing — doctor's job is to report state, never to crash over a config typo.
 */
function checkCompanionHealth(dir: string, claudeHome?: string): HealthCheck {
  const base = { id: 'companions', label: 'Companions', status: 'PASS' as HealthStatus }
  if (isArbiterSelf(dir)) {
    return {
      ...base,
      detail: 'companions never activate on arbiter-self (its own complexity is load-bearing)',
    }
  }
  const cfg = readRawCoherenceConfig(dir)
  const rows = diagnoseCompanions({
    claudeHome: claudeHome ?? join(os.homedir(), '.claude'),
    language: detectLanguage(dir),
    ...(cfg?.companions ? { overrides: cfg.companions } : {}),
  })
  if (rows.length === 0) {
    return { ...base, detail: 'no known companions in the registry' }
  }
  const detail = rows
    .map((r) => {
      if (!r.installed) return `${r.label}: not installed`
      if (r.disabledByConfig) return `${r.label}: detected, disabled by config`
      return `${r.label}: detected, mode=${r.mode} (${r.modeSource})`
    })
    .join('; ')
  return { ...base, detail }
}

/**
 * M4/#1491: the gate is the very first thing the CLI tells a new user to run
 * (`node scripts/check-all.mjs L1`). doctor reported "0 failed" while that gate
 * was red, so a newcomer trusted a green doctor and was blindsided. This check
 * verifies the generated gate SCRIPT is present; the companion checkGateToolchain
 * verifies the tools the gate invokes are actually installed.
 */
function checkGateScript(dir: string): HealthCheck {
  const present = existsSync(join(dir, 'scripts', 'check-all.mjs'))
  const check: HealthCheck = {
    id: 'gate-script',
    label: 'gate script (scripts/check-all.mjs) present',
    status: present ? 'PASS' : 'WARN',
    detail: present ? 'found' : 'scripts/check-all.mjs not found',
  }
  if (!present) check.hint = 'Run `arbiter init` (or `arbiter update`) to (re)generate the gate.'
  return check
}

/**
 * M4/#1491: probe that the toolchain the generated gate invokes is actually
 * installed, so doctor's "healthy" is truthful instead of green-while-the-gate-
 * is-red. Reuses the compatibility probe (the same one `init --verify` runs): a
 * `toolchain-missing` probe means a tool the gate calls (tsc/prettier/eslint/
 * vitest/ruff/…) is absent → the gate will error on first run. A `failed` probe
 * (wrong version / broken binary) is the harder signal and FAILs. Missing-only →
 * WARN with the install hint. No matrix coverage for the stack → PASS (advisory).
 */
function checkGateToolchain(dir: string): HealthCheck {
  const check: HealthCheck = {
    id: 'gate-toolchain',
    label: 'gate toolchain installed (tools check-all.mjs invokes)',
    status: 'PASS',
    detail: 'all required gate tools resolve',
  }
  let report: ReturnType<typeof runProbes>
  try {
    report = runProbes(dir)
  } catch (err) {
    check.status = 'WARN'
    check.detail = `could not probe gate toolchain: ${err instanceof Error ? err.message : String(err)}`
    return check
  }
  const failed = report.probes.filter((p) => p.status === 'failed').map((p) => p.tool)
  const missing = report.probes
    .filter((p) => p.status === 'skipped' && p.reason === 'toolchain-missing')
    .map((p) => p.tool)
  if (failed.length === 0 && missing.length === 0) {
    check.detail = `all gate tools resolve for ${report.stack}`
    return check
  }
  // A broken/wrong-version tool is a hard signal (gate cannot pass); a merely
  // uninstalled one is fixable with an install, so it WARNs.
  check.status = failed.length > 0 ? 'FAIL' : 'WARN'
  const parts: string[] = []
  if (missing.length > 0) parts.push(`not installed: ${missing.join(', ')}`)
  if (failed.length > 0) parts.push(`broken/incompatible: ${failed.join(', ')}`)
  check.detail = `gate would error on first run — ${parts.join('; ')}`
  check.hint =
    'Install the gate toolchain (e.g. `npm install` for the declared devDependencies) ' +
    'before running `node scripts/check-all.mjs L1`.'
  return check
}

/**
 * #2196: report the live per-repo gate mutex, without attempting to modify it.
 * The count comes from the same target-project `waiter-count.mjs` helper used
 * by gate-exec's queue advisory; doctor remains advisory when either flock or
 * that helper cannot be inspected.
 */
function checkGateMutex(dir: string): HealthCheck {
  const id = 'gate-mutex'
  const label = 'gate-exec mutex'
  let lockPath: string
  try {
    lockPath = gateLockPath(deriveGateKey(dir))
  } catch (err) {
    return {
      id,
      label,
      status: 'WARN',
      detail: `could not derive gate mutex path: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  try {
    runCli('flock', ['--version'], { cwd: dir, timeoutMs: 3_000 })
  } catch {
    return {
      id,
      label,
      status: 'WARN',
      detail: `mutex ${lockPath}; flock(1) is unavailable, so holder/waiter count cannot be inspected`,
      hint: 'Install util-linux flock to inspect the gate mutex.',
    }
  }

  const helperPath = resolve(dir, 'scripts', 'lib', 'waiter-count.mjs')
  if (!existsSync(helperPath)) {
    return {
      id,
      label,
      status: 'WARN',
      detail: `mutex ${lockPath}; waiter-count helper is missing at ${helperPath}`,
      hint: 'Run `arbiter update` to restore scripts/lib/waiter-count.mjs.',
    }
  }

  try {
    const { stdout } = runCli('node', [helperPath, lockPath], { cwd: dir, timeoutMs: 5_000 })
    const count = Number(stdout.trim())
    if (!Number.isInteger(count) || count < 0) {
      return {
        id,
        label,
        status: 'WARN',
        detail: `mutex ${lockPath}; waiter-count helper returned invalid output: ${JSON.stringify(stdout.trim())}`,
        hint: 'Run `arbiter update` to restore scripts/lib/waiter-count.mjs.',
      }
    }
    if (count >= 2) {
      return {
        id,
        label,
        status: 'WARN',
        detail: `mutex ${lockPath}; ${count} holder/waiter process(es) currently have the lock open`,
        hint: 'A backgrounded daemon from a previous gate can be the holder; inspect it before starting another gate.',
      }
    }
    return {
      id,
      label,
      status: 'PASS',
      detail: `mutex ${lockPath}; ${count} holder/waiter process(es) currently have the lock open`,
    }
  } catch {
    return {
      id,
      label,
      status: 'WARN',
      detail: `mutex ${lockPath}; waiter-count helper could not be run`,
      hint: 'Run `arbiter update` to restore scripts/lib/waiter-count.mjs.',
    }
  }
}

/**
 * #1835: surface "scaffolded ceremony" — a scripts/check-*.mjs gate script present
 * on disk but never referenced by check-all.mjs, run.sh, or the Makefile. Field
 * evidence: 11 such orphaned scripts (~1133 LOC) in a real arbiter-generated
 * project, several predating a since-landed wiring fix upstream. Runs the
 * permanent, ships-in-the-CLI counterpart to arbiter's self-only
 * check-emission-coherence.mjs (INV-123) against WHATEVER project `doctor` is
 * pointed at — including ones generated long ago by an older arbiter version.
 * Advisory (WARN, never FAIL): a script's absence from these three surfaces does
 * not prove it is dead (a workflow or githook may reference it instead) — it is
 * a prompt to verify, not a hard gate.
 */
function checkScaffoldWiringHealth(dir: string): HealthCheck {
  const { unwired } = checkScaffoldWiring(dir)
  if (unwired.length === 0) {
    return {
      id: 'scaffold-wiring',
      label: 'gate scripts referenced by check-all.mjs/run.sh/Makefile',
      status: 'PASS',
      detail: 'every scripts/check-*.mjs is referenced by at least one of the three',
    }
  }
  const names = unwired.map((u) => u.path).join(', ')
  return {
    id: 'scaffold-wiring',
    label: 'gate scripts referenced by check-all.mjs/run.sh/Makefile',
    status: 'WARN',
    detail: `${unwired.length} script(s) not referenced by check-all.mjs, run.sh, or Makefile: ${names}`,
    hint: 'Wire each into check-all.mjs (or run.sh/Makefile) if it should run, or remove it if dead.',
  }
}

/**
 * #1306 (ADR-094 §Decision.5): surface incoherent Project-Profile orchestration
 * prefs. maxParallelWorktrees > 1 under trunk-solo is CRITICAL (worktree: never);
 * defaultGateLevel L1 under L3/L4 governance is WARN (gate too lenient). Crash-safe:
 * an unreadable arbiter.json WARNs rather than throwing (RT-1306-08). collaborationMode
 * is read via the canonical resolver so the trunk-solo rule fires for soloDevMode
 * aliases too.
 */
function checkProfileCoherence(dir: string): HealthCheck {
  const check: HealthCheck = {
    id: 'profile-coherence',
    label: 'automation profile (worktrees / gate-level) coherence',
    status: 'PASS',
    detail: 'coherent',
  }
  const cfg = readRawCoherenceConfig(dir)
  if (cfg === null) {
    check.status = 'WARN'
    check.detail = 'could not read arbiter.json for profile-coherence check'
    return check
  }
  if (cfg.governanceLevel === undefined) {
    check.status = 'WARN'
    check.detail = 'governanceLevel missing from arbiter.json — cannot check profile coherence'
    check.hint = 'Run `arbiter update` to repair the governanceLevel field.'
    return check
  }
  const mode = resolveCollaborationMode(cfg)
  const r = validateProfileCoherence(
    cfg.automation?.maxParallelWorktrees,
    cfg.automation?.defaultGateLevel,
    mode,
    cfg.governanceLevel,
  )
  if (r.severity === 'OK') {
    check.detail = `${mode} @ ${cfg.governanceLevel} — profile prefs coherent`
    return check
  }
  check.status = r.severity === 'CRITICAL' ? 'FAIL' : 'WARN'
  check.detail = r.message
  if (r.remediation !== undefined) check.hint = r.remediation
  return check
}

/**
 * ADR-051 (#1093): surface incoherent (collaborationMode × governanceLevel) cells.
 * WARN cells (e.g. trunk-solo @ L3) become advisory health warnings; CRITICAL
 * cells (e.g. trunk-solo @ L4) — which the wizard rejects at init — fail the check.
 */
function checkCollaborationCoherence(dir: string): HealthCheck {
  const check: HealthCheck = {
    id: 'collab-coherence',
    label: 'collaborationMode × governanceLevel coherence',
    status: 'PASS',
    detail: 'coherent',
  }
  const cfg = readRawCoherenceConfig(dir)
  if (cfg === null) {
    check.status = 'WARN'
    check.detail = 'could not read arbiter.json for coherence check'
    return check
  }
  if (cfg.collaborationMode === undefined || cfg.governanceLevel === undefined) {
    check.status = 'WARN'
    check.detail = 'collaborationMode or governanceLevel missing from arbiter.json'
    check.hint = 'Run `arbiter update` to migrate the collaborationMode axis.'
    return check
  }
  const r = validateCollaborationCoherence(cfg.collaborationMode, cfg.governanceLevel)
  if (r.severity === 'OK') {
    check.detail = `${cfg.collaborationMode} @ ${cfg.governanceLevel} — coherent`
    return check
  }
  check.status = r.severity === 'CRITICAL' ? 'FAIL' : 'WARN'
  check.detail = r.message
  if (r.remediation !== undefined) check.hint = r.remediation
  return check
}

/**
 * #1977: does `scripts/check-local-ci-parity.mjs` exist? The presence check the
 * trunk-solo coherence rule needs; kept as a tiny named predicate (rather than an
 * inline existsSync) so its one call site reads as intent, matching the sibling
 * `hasWorkflowFiles` predicate below.
 */
function hasLocalCiParityCheck(dir: string): boolean {
  return existsSync(join(dir, 'scripts', 'check-local-ci-parity.mjs'))
}

/**
 * #1977: is the full gate wired to run on push? `.githooks/pre-push` is the
 * mechanism every governed project emits (githooks.ts); its presence is the
 * push-gating signal. A project using a different mechanism (e.g. a CI-only
 * required-status-check) would need a different signal, but for trunk-solo —
 * which by definition has no PR/required-check surface — the local hook IS the
 * only gate there is.
 */
function hasPushGatingWired(dir: string): boolean {
  return existsSync(join(dir, '.githooks', 'pre-push'))
}

/**
 * #1977: trunk-solo's whole premise is 'no PR ceremony' — but that is only sound
 * under the HARD constraint that the local full gate is CI-equivalent (INV-59).
 * Without a PR there is no independent CI net before trunk, so a trunk-solo
 * config missing the local-ci-parity check and/or push-gating is CRITICAL (FAIL),
 * not a warning — this is the one coherence axis above that blocks. Also surfaces
 * (as an additional WARN-level detail, never escalated to FAIL) when a CI workflow
 * set exists alongside a wired parity check but hasn't been statically verified —
 * i.e. it names the presence of `.github/workflows/` so a human can cross-check
 * `node scripts/check-local-ci-parity.mjs` ran clean, since doctor itself does not
 * shell out to run the (potentially slow, network-touching) static parity script.
 */
function checkTrunkSoloParityWiring(dir: string): HealthCheck {
  const check: HealthCheck = {
    id: 'trunk-solo-parity-wiring',
    label: 'trunk-solo local-ci-parity + push-gating',
    status: 'PASS',
    detail: 'not applicable (collaborationMode is not trunk-solo)',
  }
  const cfg = readRawCoherenceConfig(dir)
  if (cfg === null) {
    check.detail = 'could not read arbiter.json for trunk-solo-parity-wiring check'
    return check
  }
  const mode = resolveCollaborationMode(cfg)
  const hasParityCheck = hasLocalCiParityCheck(dir)
  const hasPushGating = hasPushGatingWired(dir)
  const r = validateTrunkSoloParityCoherence(mode, { hasParityCheck, hasPushGating })
  if (r.severity === 'OK') {
    if (mode !== 'trunk-solo') return check
    check.detail = 'local-ci-parity check + push-gating both wired — coherent'
    if (hasWorkflowFiles(dir)) {
      check.detail +=
        '. CI workflow files present — verify `node scripts/check-local-ci-parity.mjs` is green.'
    }
    return check
  }
  check.status = 'FAIL'
  check.detail = r.message
  if (r.remediation !== undefined) check.hint = r.remediation
  return check
}

/**
 * #1347: surface incoherent (language × archetype) cells. Reuses the same
 * coherence SSOT the pre-init gate uses, so init and doctor read one policy.
 * WARN only — this axis never FAILs (advisory, never trips the gate exit code).
 * Absent language/archetype → PASS (nothing asserted to contradict).
 */
function checkLanguageArchetypeCoherence(dir: string): HealthCheck {
  const check: HealthCheck = {
    id: 'language-archetype-coherence',
    label: 'language × archetype coherence',
    status: 'PASS',
    detail: 'coherent',
  }
  const cfg = readRawCoherenceConfig(dir)
  if (cfg === null) {
    check.status = 'WARN'
    check.detail = 'could not read arbiter.json for language-archetype check'
    return check
  }
  if (cfg.language === undefined || cfg.archetype === undefined) {
    check.detail = 'language or archetype absent — nothing to check'
    return check
  }
  const r = validateLanguageArchetypeCoherence(cfg.language, cfg.archetype)
  if (r.severity === 'OK') {
    check.detail = `${cfg.language} × ${cfg.archetype} — coherent`
    return check
  }
  check.status = 'WARN'
  check.detail = r.message
  check.hint = 'Pick an archetype that matches the language, or switch language.'
  return check
}

/**
 * #1254: surface incoherent (industryOverlay × governanceLevel) cells. A heavy
 * compliance overlay (pharma, iso27001) under lenient governance (L1) — or a
 * medium overlay under L1 — becomes an advisory WARN. Never FAILs: an overlay
 * never structurally breaks generation, so it cannot trip the gate's exit code.
 * Absent or 'none' overlay is genuinely optional → PASS (no standing warning).
 */
function checkOverlayCoherence(dir: string): HealthCheck {
  const check: HealthCheck = {
    id: 'overlay-coherence',
    label: 'industryOverlay × governanceLevel coherence',
    status: 'PASS',
    detail: 'coherent',
  }
  const cfg = readRawCoherenceConfig(dir)
  if (cfg === null) {
    check.status = 'WARN'
    check.detail = 'could not read arbiter.json for overlay-coherence check'
    return check
  }
  const overlay = cfg.industryOverlay ?? 'none'
  if (overlay === 'none') {
    check.detail = 'no industry overlay configured — nothing to check'
    return check
  }
  if (cfg.governanceLevel === undefined) {
    check.status = 'WARN'
    check.detail = `industryOverlay='${overlay}' set but governanceLevel missing from arbiter.json`
    check.hint = 'Run `arbiter update` to repair the governanceLevel field.'
    return check
  }
  const r = validateOverlayCoherence(overlay, cfg.governanceLevel)
  if (r.severity === 'OK') {
    check.detail = `${overlay} @ ${cfg.governanceLevel} — coherent`
    return check
  }
  check.status = 'WARN'
  check.detail = r.message
  check.hint = `Raise governanceLevel or change industryOverlay so the overlay's controls are gate-backed.`
  return check
}

/**
 * #1292 (ADR-093 §4): CI presence signal for the autonomy-coherence check.
 * Fail-closed: the ONLY OK-signal is ≥1 workflow file on disk under
 * `.github/workflows/` — a missing or empty dir (ENOENT included) means no CI.
 * Config flags never substitute for the filesystem evidence.
 */
function hasWorkflowFiles(dir: string): boolean {
  try {
    return readdirSync(join(dir, '.github', 'workflows')).some(
      (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
    )
  } catch {
    return false
  }
}

/**
 * #1292 (ADR-093 §4): surface incoherent (automation.autonomy × governanceLevel
 * × CI) cells. CRITICAL cells (L3 without CI; governance L4 + autonomy L3) FAIL
 * the doctor exit code; advisory cells WARN. `useGitHub: true` with an empty
 * workflows dir is itself drift: WARN at autonomy ≤ L2, already FAIL at L3
 * (the flag never rescues — fs is the only CI signal).
 */
function checkAutonomyCoherence(dir: string): HealthCheck {
  const check: HealthCheck = {
    id: 'autonomy-coherence',
    label: 'automation.autonomy × governanceLevel × CI coherence',
    status: 'PASS',
    detail: 'coherent',
  }
  const cfg = readRawCoherenceConfig(dir)
  if (cfg === null) {
    check.status = 'WARN'
    check.detail = 'could not read arbiter.json for autonomy-coherence check'
    return check
  }
  const autonomy = cfg.automation?.autonomy
  if (autonomy === undefined) {
    check.detail = 'no automation block configured — autonomy defaults to L0 (ask-each-step)'
    return check
  }
  const hasCi = hasWorkflowFiles(dir)
  if (cfg.governanceLevel === undefined) {
    check.status = 'WARN'
    check.detail =
      'automation.autonomy set but governanceLevel missing from arbiter.json — ' +
      'cannot check autonomy coherence'
    check.hint = 'Run `arbiter update` to repair the governanceLevel field.'
    return check
  }
  const r = validateAutonomyCoherence(autonomy, cfg.governanceLevel, hasCi)
  if (r.severity !== 'OK') {
    check.status = r.severity === 'CRITICAL' ? 'FAIL' : 'WARN'
    check.detail = r.message
    if (r.remediation !== undefined) check.hint = r.remediation
    return check
  }
  if (!hasCi && cfg.useGitHub === true) {
    check.status = 'WARN'
    check.detail =
      'useGitHub is true but .github/workflows/ contains no workflow files — ' +
      'CI config drift (the autonomy check trusts the filesystem, not the flag)'
    check.hint = 'Add a workflow under .github/workflows/ or set useGitHub to false.'
    return check
  }
  check.detail = `autonomy ${autonomy} @ ${cfg.governanceLevel} (CI: ${hasCi ? 'yes' : 'no'}) — coherent`
  return check
}

const LOCK_CHECK_ID = 'arbiter-lock'
const DOCTOR_LOCK_STALE_AGE_MS = 6 * 3600_000

/**
 * The advisory locks arbiter manages under `.arbiter/`. `.lock` guards the
 * command-level robust lock; `kit.lock` guards `saveConfig` (config persistence
 * for init/configure/kit-install/upgrade-level/plugin). Both are crash-safe
 * (file-lock.ts `acquireLock`) and BOTH must be inspected/repaired by doctor —
 * a stale `kit.lock` would otherwise brick every future config write with no
 * built-in recovery path (#1517).
 */
export const MANAGED_LOCKS: { rel: string; id: string }[] = [
  { rel: join('.arbiter', '.lock'), id: LOCK_CHECK_ID },
  { rel: join('.arbiter', 'kit.lock'), id: 'arbiter-kit-lock' },
]

function checkLockHealth(dir: string, rel: string, id: string): HealthCheck {
  const lockPath = join(dir, rel)
  if (!existsSync(lockPath)) {
    return {
      id,
      label: `${rel} not present`,
      status: 'PASS',
      detail: 'no leftover lock file',
    }
  }
  const info = readLockInfo(lockPath)
  if (info === null) {
    return {
      id,
      label: `${rel} unreadable`,
      status: 'WARN',
      detail: 'lock file exists but contents are not valid JSON',
      hint: `Run \`arbiter doctor recover-lock\` to remove it.`,
    }
  }
  const ageMs = Date.now() - new Date(info.startedAt).getTime()
  const ageH = Math.round(ageMs / 36e5)
  const sameHost = info.hostname === os.hostname()
  const stale = isLockStale(info, DOCTOR_LOCK_STALE_AGE_MS)
  if (stale) {
    return {
      id,
      label: `${rel} stale`,
      status: 'WARN',
      detail: `pid ${info.pid}, age ${ageH}h, cmd: ${info.cmd}`,
      hint: 'Run `arbiter doctor recover-lock` to clean up.',
    }
  }
  return {
    id,
    label: `${rel} active`,
    status: 'PASS',
    detail: `pid ${info.pid}, age ${ageH}h${sameHost ? '' : ' (other host)'}`,
  }
}

function checkLockfiles(dir: string): HealthCheck[] {
  return MANAGED_LOCKS.map(({ rel, id }) => checkLockHealth(dir, rel, id))
}

function checkGatePassLog(dir: string): HealthCheck {
  const logPath = join(dir, '.arbiter', 'gate-pass.jsonl')
  if (!existsSync(logPath)) {
    return {
      id: 'gate-pass-log',
      label: 'gate-pass log',
      status: 'WARN',
      detail: '.arbiter/gate-pass.jsonl not found — run the gate to start logging',
      hint: 'Run `node scripts/check-all.mjs gate` to create the log.',
    }
  }
  const lines = readFileTranslated(logPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
  const parsed: string[] = []
  const parseErrors: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    try {
      const entry = JSON.parse(line) as { sha?: string; signedAt?: string; level?: string }
      parsed.push(
        `${(entry.sha ?? 'unknown').slice(0, 7)} @ ${entry.signedAt ?? '?'} [${entry.level ?? '?'}]`,
      )
    } catch (err) {
      parseErrors.push(`line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (parseErrors.length > 0) {
    return {
      id: 'gate-pass-log',
      label: 'gate-pass log',
      status: 'WARN',
      detail: `${lines.length} entries, ${parseErrors.length} unparseable: ${parseErrors.slice(0, 3).join('; ')}`,
      hint: 'Inspect .arbiter/gate-pass.jsonl for corrupt lines.',
    }
  }
  const recent = parsed.slice(-5)
  return {
    id: 'gate-pass-log',
    label: 'gate-pass log',
    status: 'PASS',
    detail: `${lines.length} entries; last ${recent.length}: ${recent.join(', ')}`,
  }
}

/**
 * #1949 (E4, M15b): doctor row for the bypass-ceremony detector — the anti-deviance loop
 * that flags (a) a gate bypassed more than its ceiling within a trailing 30-day window and
 * (b) a runWarnCheck advisory site with no dated promoteBy / permanent:true entry in
 * scripts/data/advisory-ledger.json. Shells scripts/check-bypass-ceremony.mjs --json — the
 * script is the SSOT for both detectors' logic; doctor only renders its JSON, it never
 * re-implements the ceiling math or ledger parsing (one source of truth, CANON-22).
 * Absent script (e.g. a non-arbiter project, or a stripped-down fixture) WARNs rather than
 * FAILs — doctor reports state, it does not require every gate script to exist.
 */
type BypassCeremonyReport = {
  channels?: { env: string; count: number; ceiling: number }[]
  ledgerViolations?: string[]
  rateViolations?: string[]
}

function bypassCeremonyWarn(detail: string): HealthCheck {
  return { id: 'bypass-ceremony', label: 'bypass ceremony budget', status: 'WARN', detail }
}

/** Shell scripts/check-bypass-ceremony.mjs --json and parse its report; WARN on any launch/parse failure. */
function runBypassCeremonyScript(
  dir: string,
  scriptPath: string,
): { result: RunCliResult; parsed: BypassCeremonyReport } | HealthCheck {
  let result: RunCliResult
  try {
    result = runCli('node', [scriptPath, '--json', '--root', dir], { cwd: dir, timeoutMs: 15000 })
  } catch (err) {
    return bypassCeremonyWarn(
      `could not run bypass-ceremony check: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  try {
    return { result, parsed: JSON.parse(result.stdout) as BypassCeremonyReport }
  } catch {
    return bypassCeremonyWarn('bypass-ceremony check produced unparseable output')
  }
}

/** Shape the parsed bypass-ceremony report into the doctor HealthCheck row. */
function toBypassCeremonyCheck(result: RunCliResult, parsed: BypassCeremonyReport): HealthCheck {
  const channels = parsed.channels ?? []
  const ledgerViolations = parsed.ledgerViolations ?? []
  const rateViolations = parsed.rateViolations ?? []
  const channelSummary =
    channels.length > 0
      ? channels.map((c) => `${c.env}: ${c.count}/${c.ceiling}`).join(', ')
      : 'no bypass-log channels in the trailing 30 days'
  if (result.exitCode !== 0 || ledgerViolations.length > 0 || rateViolations.length > 0) {
    const detail = [...rateViolations, ...ledgerViolations].slice(0, 3).join('; ')
    return {
      id: 'bypass-ceremony',
      label: 'bypass ceremony budget',
      status: 'FAIL',
      detail: detail || `channels: ${channelSummary}`,
      hint: 'Run `node scripts/check-bypass-ceremony.mjs` for the full report.',
    }
  }
  return {
    id: 'bypass-ceremony',
    label: 'bypass ceremony budget',
    status: 'PASS',
    detail: `channels: ${channelSummary}`,
  }
}

function checkBypassCeremony(dir: string): HealthCheck {
  const scriptPath = join(dir, 'scripts', 'check-bypass-ceremony.mjs')
  if (!existsSync(scriptPath)) {
    return bypassCeremonyWarn('scripts/check-bypass-ceremony.mjs not found')
  }
  const outcome = runBypassCeremonyScript(dir, scriptPath)
  if ('id' in outcome) return outcome
  return toBypassCeremonyCheck(outcome.result, outcome.parsed)
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

/** Validate the unified task document (#1206, INV-113) when an active task is present. */
function checkTaskDocument(dir: string): HealthCheck {
  const statusPath = join(dir, '.claude', '.task', 'status.json')
  const id = 'task-document'
  const label = 'unified task document'
  if (!existsSync(statusPath)) {
    return { id, label, status: 'PASS', detail: 'no active task (.claude/.task/ absent)' }
  }
  try {
    const state = JSON.parse(readFileTranslated(statusPath, 'utf-8')) as {
      phase?: string
      taskId?: string
    }
    if (typeof state.phase !== 'string' || !isValidPhase(state.phase)) {
      return {
        id,
        label,
        status: 'WARN',
        detail: `.claude/.task/status.json has an invalid phase: ${JSON.stringify(state.phase)}`,
        hint: 'Re-run `arbiter task init` / `arbiter task advance` to repair task state.',
      }
    }
    return {
      id,
      label,
      status: 'PASS',
      detail: `active task ${state.taskId || '(unset)'} at phase=${state.phase}`,
    }
  } catch (err) {
    return {
      id,
      label,
      status: 'WARN',
      detail: `.claude/.task/status.json is not valid JSON — ${err instanceof Error ? err.message : String(err)}`,
      hint: 'Delete .claude/.task/ and re-initialise with `arbiter task init`.',
    }
  }
}

export async function runDoctorHealth(opts: DoctorHealthOptions = {}): Promise<DoctorHealthResult> {
  const dir = resolve(opts.dir ?? '.')
  const [gitCheck, gitOk] = checkGitAvailable(dir)
  const checks: HealthCheck[] = [
    checkNodeVersion(),
    gitCheck,
    ...checkArbiterProject(dir, gitOk, opts.claudeHome),
    checkChannelSetting(dir, opts.channelFlag),
    checkTaskDocument(dir),
    checkGatePassLog(dir),
  ]

  let repaired: DoctorHealthResult['repaired']
  if (opts.repair) {
    repaired = await repairStaleLockInChecks(dir, checks)
  }

  const pass = checks.filter((c) => c.status === 'PASS').length
  const warn = checks.filter((c) => c.status === 'WARN').length
  const fail = checks.filter((c) => c.status === 'FAIL').length

  if (opts.json) {
    jsonOutput('doctor health', fail > 0 ? 'error' : 'ok', {
      checks,
      pass,
      warn,
      fail,
      ...(repaired ? { repaired } : {}),
    })
  } else {
    emitHealthOutput(checks, pass, warn, fail)
    if (repaired) {
      process.stdout.write(`  repaired: released stale lock pid ${repaired.pid}\n\n`)
    }
  }

  return {
    exitCode: fail > 0 ? 1 : 0,
    checks,
    pass,
    warn,
    fail,
    ...(repaired ? { repaired } : {}),
  }
}

/**
 * When `--repair` is set, look for a stale `.arbiter/.lock` finding and
 * force-release it. Mutates the matching check in-place: WARN → PASS with
 * `(auto-repaired)` suffix.
 *
 * Returns the repair record only if a release actually happened.
 */
async function repairStaleLockInChecks(
  dir: string,
  checks: HealthCheck[],
): Promise<DoctorHealthResult['repaired']> {
  let firstRepaired: DoctorHealthResult['repaired']

  for (const { rel, id } of MANAGED_LOCKS) {
    const lockCheck = checks.find((c) => c.id === id)
    if (!lockCheck || lockCheck.status !== 'WARN') continue

    const lockPath = join(dir, rel)
    const info = readLockInfo(lockPath)
    if (!info) continue

    try {
      await forceReleaseLock(lockPath, info.pid, dir)
    } catch (err) {
      lockCheck.hint =
        err instanceof ArbiterError
          ? `auto-repair failed: ${err.message}`
          : `auto-repair failed: ${err instanceof Error ? err.message : String(err)}`
      continue
    }

    lockCheck.status = 'PASS'
    lockCheck.label = `${rel} released (auto-repaired)`
    lockCheck.detail = `released stale lock pid ${info.pid}`
    delete lockCheck.hint
    firstRepaired ??= { lockPath, pid: info.pid }
  }

  return firstRepaired
}
