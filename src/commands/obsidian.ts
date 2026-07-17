// SPDX-License-Identifier: Apache-2.0
//
// #1979: `arbiter obsidian` — v1 thin generic orchestrator. It shells out to
// the vault scripts a governed repo ALREADY received from arbiter
// (scripts/gen-wiki.mjs, scripts/check-wiki-lint.mjs) rather than
// reimplementing a walker/wikilink engine.
//
// CANON-16 survey: grepped `gen-wiki`, `check-wiki-lint`, `obsidian` across
// src/. Found `src/generators/wiki.ts` — the EMISSION side (arbiter →
// consumer repo, template writes only, never invoked post-emission). No
// existing command runs the emitted scripts against a repo's current state.
// Responsibility here is vault-script ORCHESTRATION (read the already-emitted
// scripts' output, decide an exit code), not template drift — a different
// lifecycle from `src/generators/wiki.ts`, so a new file is justified.
//
// INV-12 note: this module uses `runCli` (src/utils/run-cli.ts), the ONLY
// sanctioned wrapper around child_process in src/ — the design's literal
// wording named `spawnSync` directly, but `check-no-direct-spawn.mjs`
// (PostToolUse hook) hard-blocks any other direct child_process import
// under src/, so `runCli` is the required call path, not a stylistic choice.
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'

export type ObsidianMode = 'sync' | 'validate' | 'dry-run' | 'write'
export type ObsidianStatus = 'ok' | 'warning' | 'error'

export interface ObsidianValidation {
  brokenLinks: number
  orphans: number
  stale: number
  ok: boolean
}

export interface ObsidianResult {
  status: ObsidianStatus
  exitCode: 0 | 1 | 2
  mode: ObsidianMode
  contractVersion: 1
  vaultDir: string
  regenerated?: boolean
  validation?: ObsidianValidation
  reason?: string
}

export interface ObsidianOptions {
  dir?: string
  vaultPath?: string
  sync?: boolean
  validateOnly?: boolean
  write?: boolean
  dryRun?: boolean
  json?: boolean
}

const GEN_WIKI_REL = join('scripts', 'gen-wiki.mjs')
const CHECK_WIKI_LINT_REL = join('scripts', 'check-wiki-lint.mjs')

const UPDATE_HINT = "vault scripts not found — run 'arbiter update' to (re)generate them"

/** Resolve the requested mode from the (possibly conflicting) option flags. */
function resolveMode(opts: ObsidianOptions): ObsidianMode | 'conflict' {
  const flags = [opts.validateOnly, opts.sync, opts.write, opts.dryRun].filter(Boolean).length
  if (flags > 1) return 'conflict'
  // Precedence: validateOnly > sync > write > dry-run (default).
  if (opts.validateOnly) return 'validate'
  if (opts.sync) return 'sync'
  if (opts.write) return 'write'
  return 'dry-run'
}

function errorResult(mode: ObsidianMode, vaultDir: string, reason: string): ObsidianResult {
  return { status: 'error', exitCode: 2, mode, contractVersion: 1, vaultDir, reason }
}

/** Parse check-wiki-lint.mjs's line-oriented output into violation counts. */
function parseLintOutput(output: string): ObsidianValidation {
  const brokenLinks = (output.match(/\[broken-link\]/g) ?? []).length
  const orphans = (output.match(/\[orphan\]/g) ?? []).length
  const stale = (output.match(/\[stale\]/g) ?? []).length
  const citation = (output.match(/\[citation\]/g) ?? []).length
  const total = brokenLinks + orphans + stale + citation
  return { brokenLinks, orphans, stale, ok: total === 0 }
}

/** Run check-wiki-lint.mjs against vaultAbsDir; classify launch failures as exit 2. */
function runLint(
  repoDir: string,
  vaultAbsDir: string,
  mode: ObsidianMode,
  vaultDir: string,
): ObsidianValidation | ObsidianResult {
  try {
    const r = runCli('node', [CHECK_WIKI_LINT_REL, '--wiki-dir', vaultAbsDir], { cwd: repoDir })
    return parseLintOutput(r.stdout + r.stderr)
  } catch (err: unknown) {
    if (err instanceof CliError && !err.notFound) {
      // Non-zero exit from a launched process is an expected "violations found"
      // outcome — parse it, don't treat it as a launch failure.
      return parseLintOutput(err.stdout + err.stderr)
    }
    return errorResult(
      mode,
      vaultDir,
      `check-wiki-lint.mjs failed to launch: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** Run gen-wiki.mjs (write mode) against vaultAbsDir; spawn/launch errors → exit 2. */
function runGenRegen(
  repoDir: string,
  vaultAbsDir: string,
  mode: ObsidianMode,
  vaultDir: string,
): { ok: true } | ObsidianResult {
  try {
    runCli('node', [GEN_WIKI_REL, '--wiki-dir', vaultAbsDir], { cwd: repoDir })
    return { ok: true }
  } catch (err: unknown) {
    const detail = err instanceof CliError ? err.stdout + err.stderr : String(err)
    return errorResult(mode, vaultDir, `gen-wiki.mjs regen failed: ${detail || String(err)}`)
  }
}

function isObsidianResult(
  v: ObsidianValidation | ObsidianResult | { ok: true },
): v is ObsidianResult {
  return 'status' in v
}

/**
 * v1 thin generic orchestrator for the Obsidian vault (#1979). Shells out to
 * the consumer repo's OWN gen-wiki.mjs / check-wiki-lint.mjs — no bespoke
 * walker/wikilink engine. Mode precedence: validateOnly > sync > write >
 * dry-run (default, ADR-001 read-only-by-default — writes NOTHING).
 */
export function runObsidian(opts: ObsidianOptions = {}): ObsidianResult {
  const repoDir = resolve(opts.dir ?? process.cwd())
  const vaultDir = opts.vaultPath ?? 'wiki'
  const vaultAbsDir = resolve(repoDir, vaultDir)

  const mode = resolveMode(opts)
  if (mode === 'conflict') {
    return errorResult(
      'dry-run',
      vaultDir,
      'conflicting mode flags — pass only one of --sync, --validate-only, --write, --dry-run',
    )
  }

  // Preflight: both scripts must exist in the target repo.
  const genWikiPath = join(repoDir, GEN_WIKI_REL)
  const lintPath = join(repoDir, CHECK_WIKI_LINT_REL)
  if (!existsSync(genWikiPath) || !existsSync(lintPath)) {
    return errorResult(mode, vaultDir, UPDATE_HINT)
  }

  if (mode === 'dry-run' || mode === 'write') {
    // ADR-001 read-only-by-default: v1 has no writer of its own beyond the
    // reused gen-wiki.mjs, and `write` without `--sync` has nothing distinct
    // to do (there is no bespoke content this orchestrator generates) — both
    // report the vault dir without touching it.
    return { status: 'ok', exitCode: 0, mode, contractVersion: 1, vaultDir }
  }

  if (mode === 'validate') {
    const validation = runLint(repoDir, vaultAbsDir, mode, vaultDir)
    if (isObsidianResult(validation)) return validation
    if (!validation.ok) {
      return {
        status: 'error',
        exitCode: 1,
        mode,
        contractVersion: 1,
        vaultDir,
        validation,
        reason: 'vault validation found violations',
      }
    }
    return { status: 'ok', exitCode: 0, mode, contractVersion: 1, vaultDir, validation }
  }

  // mode === 'sync': regenerate, then re-validate — fail-closed.
  const regen = runGenRegen(repoDir, vaultAbsDir, mode, vaultDir)
  if (isObsidianResult(regen)) return regen

  const validation = runLint(repoDir, vaultAbsDir, mode, vaultDir)
  if (isObsidianResult(validation)) return validation
  if (!validation.ok) {
    return {
      status: 'error',
      exitCode: 1,
      mode,
      contractVersion: 1,
      vaultDir,
      regenerated: true,
      validation,
      reason: 'vault validation found violations after regeneration',
    }
  }
  return {
    status: 'ok',
    exitCode: 0,
    mode,
    contractVersion: 1,
    vaultDir,
    regenerated: true,
    validation,
  }
}
