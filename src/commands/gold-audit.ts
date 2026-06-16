// SPDX-License-Identifier: Apache-2.0
// `arbiter gold-audit` — a THIN wrapper over the SSOT gold-audit engine (#1414).
//
// Existing Code Survey (CANON-16): the gold-audit ENGINE already exists as scripts/gold-audit.mjs
// + scripts/lib/gold-audit-lib.mjs (deterministic registry→Y/P/N verdicts, --check no-regress,
// --strict false-gap, --update-baseline ratchet, and — added in #1414 — the level band + gap
// report). This command does NOT introduce a second engine or a second checkNoRegress (the
// duplication the red-team flagged): it shells `node scripts/gold-audit.mjs --json` through the
// INV-12 runCli helper and presents the result. The engine's `engine.evaluate()` / score.ts
// `computeConformance()` (src/conformance) use INCOMPATIBLE data models and are NOT used here.
// A parity test asserts the command's core verdicts == the engine's JSON for the same inputs.

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'
import { detectBrownfieldClass } from '../kit/brownfield-detect.js'
import type { BrownfieldClass } from '../kit/thresholds.js'

/** Per-check verdict + evidence, as emitted by the engine. */
export interface GoldCheck {
  id: string
  dimension: string
  title: string
  type: string
  verdict: 'Y' | 'P' | 'N' | 'NA' | 'NV'
  weight: number
  risk: string
  anchor: string | null
  evidence: { file?: string; line?: number; detail?: string } | null
}

/** A "what's missing" family group: the N/P checks for one dimension. */
export interface GoldGap {
  dimension: string
  checks: Array<{
    id: string
    title: string
    verdict: 'N' | 'P'
    anchor: string | null
    evidence: { file?: string; line?: number; detail?: string } | null
  }>
}

/** The level band keyed by brownfieldClass. */
export interface GoldLevel {
  level: 'L0' | 'L1' | 'L2' | 'L3'
  nextLevel: 'L1' | 'L2' | 'L3' | null
  toNextLevel: number
  brownfieldClass: BrownfieldClass
  thresholds: number[]
}

/** The enriched engine payload (raw verdicts + #1414 presentation). */
export interface GoldAuditPayload {
  registryVersion: string
  score: number
  yCount: number
  riskyCount: number
  totals: { checks: number; y: number; p: number; n: number; na: number; nv: number }
  dimensions: Record<string, { score: number; y: number }>
  checks: GoldCheck[]
  level: GoldLevel
  gaps: GoldGap[]
}

export interface GoldAuditOptions {
  /** Repo to audit (default: current directory). */
  repo?: string
  /** Per-stack registry selector (engine: standards/gold-registry.<stack>.yml). */
  stack?: string
  /** Override the brownfieldClass for the level band (else auto-detected). */
  class?: BrownfieldClass
  /** Emit machine-readable JSON instead of the human report. */
  json?: boolean
}

export interface GoldAuditResult {
  exitCode: number
  payload: GoldAuditPayload | null
}

/** Resolve the package root (this file lives at src/commands/, two levels down). */
function packageRoot(): string {
  return resolve(fileURLToPath(import.meta.url), '../../..')
}

/** Auto-detect the brownfieldClass when not overridden (uses the multi-stack file count). */
function resolveClass(repo: string, override?: BrownfieldClass): BrownfieldClass {
  if (override) return override
  try {
    return detectBrownfieldClass(repo, 'multi').brownfieldClass
  } catch {
    return 'gold' // fail-safe: strictest band, never over-credits
  }
}

/** Render the human-readable level + "what's missing" report. */
function renderReport(p: GoldAuditPayload): string {
  const lines: string[] = []
  const b = p.level
  const toNext = b.nextLevel === null ? '' : ` · ${b.toNextLevel} to ${b.nextLevel}`
  lines.push(
    `gold-audit: ${b.level} (${b.brownfieldClass}) · score ${p.score}${toNext} · ` +
      `Y ${p.yCount}/${p.totals.checks} · RISKY ${p.riskyCount}`,
  )
  if (p.gaps.length === 0) {
    lines.push("  what's missing: nothing — all applicable checks are Y.")
  } else {
    lines.push(`  what's missing (${p.gaps.length} family/families):`)
    for (const g of p.gaps) {
      lines.push(`    ${g.dimension}:`)
      for (const c of g.checks) {
        const file = c.evidence?.file ?? ''
        const detail = c.evidence?.detail ? `: ${c.evidence.detail}` : ''
        const ev = file || detail ? ` [${file}${detail}]` : ''
        lines.push(`      ${c.verdict} ${c.id} ${c.title}${ev}`)
      }
    }
  }
  return lines.join('\n') + '\n'
}

/**
 * Run the gold-audit engine and present the level band + gap report.
 * Reuses the engine (no second engine); returns the enriched payload for callers/tests.
 */
export async function runGoldAudit(opts: GoldAuditOptions = {}): Promise<GoldAuditResult> {
  const repo = opts.repo ? resolve(opts.repo) : process.cwd()
  const cls = resolveClass(repo, opts.class)
  const script = resolve(packageRoot(), 'scripts/gold-audit.mjs')

  const args = ['--json', '--class', cls]
  if (opts.stack) args.push('--stack', opts.stack)

  let stdout: string
  try {
    stdout = runCli('node', [script, ...args], { cwd: repo }).stdout
  } catch (err) {
    const detail = err instanceof CliError ? err.message : String(err)
    process.stderr.write(`gold-audit: engine failed — ${detail}\n`)
    return { exitCode: 1, payload: null }
  }

  const text = stdout.trim()
  // The engine emits a SKIP line (no registry) that is not JSON — treat as a clean exit-0 skip.
  if (!text.startsWith('{')) {
    if (opts.json) process.stdout.write(stdout)
    else process.stdout.write(text + '\n')
    return { exitCode: 0, payload: null }
  }

  let payload: GoldAuditPayload
  try {
    payload = JSON.parse(text) as GoldAuditPayload
  } catch (err) {
    process.stderr.write(`gold-audit: engine emitted invalid JSON — ${(err as Error).message}\n`)
    return { exitCode: 1, payload: null }
  }

  if (opts.json) process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
  else process.stdout.write(renderReport(payload))
  return { exitCode: 0, payload }
}
