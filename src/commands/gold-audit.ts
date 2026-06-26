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
import { paint, colorEnabled, asciiOnly, type Sgr } from '../utils/tty.js'

/** Per-check verdict + evidence, as emitted by the engine. */
interface GoldCheck {
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
interface GoldGap {
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
interface GoldLevel {
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
  /**
   * #1419: no-regress gate mode. Delegates to the engine's `--check` path —
   * bootstraps a missing `.gold-audit-baseline.json` (exit 0, no day-1 redness)
   * and exits 1 only when the score/Y regresses below the committed baseline.
   * This powers the downstream thin runner (`npx arbiter gold-audit --check`).
   */
  check?: boolean
  /**
   * #1419: with `check`, a missing baseline is a HARD FAIL (engine N1 disarm
   * guard). Used by self-gates that ship a committed baseline; NEVER used
   * downstream (a fresh consumer has no baseline → would be day-1 red).
   */
  requireBaseline?: boolean
  /**
   * #1422: suppress this command's own stdout (the human/JSON report) and only
   * RETURN the payload. Used by `arbiter close-gold-gap`, which consumes the
   * audit payload programmatically and emits its OWN output (the recipe).
   */
  quiet?: boolean
  /** #1475: render the rich TTY-gated goldness cockpit instead of the plain report. */
  cockpit?: boolean
  /** #1475: force pure-ASCII cockpit output (also implied by a C/POSIX locale). */
  ascii?: boolean
}

/** Out-of-band freshness signal (never part of the scored payload) — rendered in the cockpit banner. */
export interface FreshnessInfo {
  status: 'FRESH' | 'PARTIAL' | 'STALE'
  counts: { total: number; present: number; fresh: number }
  staleHours: number
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

// ── #1475: the rich goldness cockpit (pure render over the existing payload — never re-scores) ──

// Verdict → glyph. NV MUST render distinctly from NA (anti-fake-green: "can't verify" ≠ "n/a").
// String-indexed so an unknown verdict from a malformed envelope falls back to NA (verdictCell).
const COCKPIT_GLYPH: { unicode: Record<string, string>; ascii: Record<string, string> } = {
  unicode: { Y: '🟢', P: '🟡', N: '🔴', NA: '·', NV: '❔' },
  ascii: { Y: 'Y', P: 'P', N: 'N', NA: '.', NV: '?' },
}

const VERDICT_COLOR: Record<string, Sgr> = {
  Y: 'green',
  P: 'yellow',
  N: 'red',
  NA: 'dim',
  NV: 'cyan',
}

const FRESH_COLOR: Record<string, Sgr> = { FRESH: 'green', PARTIAL: 'yellow', STALE: 'red' }

/**
 * Strip C0 controls, ESC, DEL and newlines from untrusted payload text (dimension/check ids,
 * freshness status). The gold-registry is project-authored — in a consumer repo it is untrusted —
 * so a crafted id must NEVER inject an ANSI escape or forge a line into piped/CI/committed output.
 */
function sanitize(s: unknown, ascii = false): string {
  // A non-string field (a malformed --cockpit-data envelope where a JSON object/array sits where a
  // scalar string belongs) renders BLANK — never `String(s)`, which would either leak the literal
  // `[object Object]` or THROW "Cannot convert object to primitive value" on a primitive-resisting
  // value like `{"toString":null}` (the render call is outside a try/catch).
  const str = typeof s === 'string' ? s : ''
  // eslint-disable-next-line no-control-regex -- strips C0/ESC/DEL + C1 line separators (NEL/LS/PS)
  const noCtrl = str.replace(/[\x00-\x1f\x7f\u0085\u2028\u2029]/g, '')
  // In --ascii mode also drop multi-byte unicode so untrusted registry text cannot leak non-ASCII.
  return ascii ? noCtrl.replace(/[^\x20-\x7e]/g, '') : noCtrl
}

/** Coerce an (untrusted, possibly string/NaN/Infinity) numeric field to a finite number for display. */
function num(n: unknown): number {
  const x = Number(n)
  return Number.isFinite(x) ? x : 0
}

/** A finite score clamped to [0,100] — a corrupt envelope renders visibly, never blank/NaN. */
function clampScore(n: unknown): number {
  const x = Number(n)
  return Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : 0
}

/** Round to one decimal for display (the engine already does; defensive against a corrupt envelope). */
function displayScore(n: number): string {
  return String(Math.round(clampScore(n) * 10) / 10)
}

/** Score → band colour (gold ≥75 green, ≥50 yellow, else red). */
function scoreColor(score: number): Sgr {
  return score >= 75 ? 'green' : score >= 50 ? 'yellow' : 'red'
}

/** A width-`w` progress bar for `score` (0–100, clamped). ASCII `#`/`.` or unicode `█`/`░`. */
function scoreBar(score: number, w: number, ascii: boolean): string {
  const filled = Math.max(0, Math.min(w, Math.round((clampScore(score) / 100) * w)))
  const fill = ascii ? '#' : '█'
  const empty = ascii ? '.' : '░'
  return fill.repeat(filled) + empty.repeat(w - filled)
}

/** Resolve an (untrusted) verdict to its glyph + colour, falling back to NA for an unknown verdict. */
function verdictCell(verdict: unknown, ascii: boolean): { glyph: string; color: Sgr } {
  const glyphs = ascii ? COCKPIT_GLYPH.ascii : COCKPIT_GLYPH.unicode
  // String-guard first (a non-string from a malformed envelope must not be coerced into a key — that
  // throws on `{"toString":null}`), then Object.hasOwn (NOT `in`) so a prototype-chain key
  // (toString/__proto__/…) falls back to NA. `key` is therefore always one of the 5 own glyph keys.
  const v = typeof verdict === 'string' ? verdict : 'NA'
  const key = Object.hasOwn(glyphs, v) ? v : 'NA'
  return { glyph: glyphs[key] ?? glyphs['NA'] ?? '?', color: VERDICT_COLOR[key] ?? 'dim' }
}

/**
 * Render the single-repo goldness cockpit. Three byte-deterministic tiers driven by `color`/`ascii`:
 * TTY (color) → unicode glyphs + ANSI bars; piped (no color) → unicode glyphs, ANSI-free; `--ascii`
 * → pure ASCII. Pure presentation over the engine payload + the out-of-band freshness — never scores.
 * Untrusted payload strings (ids, status) are sanitized so the gate's "ANSI only behind TTY" holds.
 */
export function renderCockpit(
  p: GoldAuditPayload,
  fresh: FreshnessInfo | null,
  opts: { color: boolean; ascii: boolean },
): string {
  const { color, ascii } = opts
  const glyphs = ascii ? COCKPIT_GLYPH.ascii : COCKPIT_GLYPH.unicode
  const sep = ascii ? ' | ' : ' · ' // a `·` middle-dot is non-ASCII — keep --ascii output pure ASCII
  const lines: string[] = []

  // Freshness banner (first line) — only when the registry declares value-check reports.
  if (fresh && num(fresh.counts.total) > 0) {
    const c = fresh.counts
    // sanitize() returns a guaranteed string (folds a non-string/object status to ''), so it is safe
    // both as the displayed text AND as the colour-map key — a raw `FRESH_COLOR[fresh.status]` would
    // coerce an object key and THROW on `{"toString":null}`. paint() then no-ops any non-palette colour.
    const statusText = sanitize(fresh.status, ascii)
    lines.push(
      paint(`DATA ${statusText}`, FRESH_COLOR[statusText] ?? 'dim', color) +
        `${sep}${num(c.fresh)}/${num(c.total)} report(s) within ${num(fresh.staleHours)}h`,
    )
  }

  // Level-band header + a global score bar.
  const b = p.level
  const toNext =
    b.nextLevel === null ? 'max level' : `${num(b.toNextLevel)} to ${sanitize(b.nextLevel, ascii)}`
  lines.push(
    paint(sanitize(b.level, ascii), scoreColor(clampScore(p.score)), color) +
      ` (${sanitize(b.brownfieldClass, ascii)})${sep}score ${displayScore(p.score)}${sep}${toNext}${sep}` +
      `Y ${num(p.yCount)}/${num(p.totals.checks)}`,
  )
  lines.push(
    '  ' +
      paint(scoreBar(p.score, 24, ascii), scoreColor(clampScore(p.score)), color) +
      ` ${displayScore(p.score)}`,
  )

  // Single-repo DIMENSION × check glyph grid. Iterate the UNION of declared dimensions and the
  // dimensions actually present on checks, so no check (esp. an N/NV) can silently vanish.
  lines.push('')
  lines.push('DIMENSIONS')
  const byDim = new Map<string, GoldCheck[]>()
  for (const c of p.checks) {
    // String-guard the dimension before using it as a Map key — a non-string from a malformed
    // envelope would survive into byDim.keys() and throw when the default .sort() coerces it.
    const dimKey = typeof c.dimension === 'string' ? c.dimension : ''
    const arr = byDim.get(dimKey)
    if (arr) arr.push(c)
    else byDim.set(dimKey, [c])
  }
  const dimIds = [...new Set([...Object.keys(p.dimensions), ...byDim.keys()])].sort()
  const rows = dimIds.map((id) => {
    const dim = p.dimensions[id] ?? { score: 0, y: 0 }
    const strip = (byDim.get(id) ?? [])
      .map((c) => {
        const cell = verdictCell(c.verdict, ascii)
        return paint(cell.glyph, cell.color, color)
      })
      .join(' ')
    return { label: sanitize(id, ascii), score: clampScore(dim.score), strip }
  })
  const w = rows.reduce((m, r) => Math.max(m, r.label.length), 0)
  for (const r of rows) {
    lines.push(
      `  ${r.label.padEnd(w)}  ${paint(scoreBar(r.score, 12, ascii), scoreColor(r.score), color)} ` +
        `${displayScore(r.score).padStart(5)}  ${r.strip}`,
    )
  }

  // RISKY row — the false-gap meta-gate.
  if (num(p.riskyCount) > 0) {
    lines.push('')
    const dash = ascii ? '--' : '—' // an em-dash is non-ASCII — keep --ascii output pure ASCII
    lines.push(
      paint(
        `RISKY: ${num(p.riskyCount)} check(s) ${dash} false-gap meta-gate (scoring suppressed under --strict)`,
        'red',
        color,
      ),
    )
  }

  lines.push('')
  lines.push(
    `legend: ${glyphs['Y']} Y  ${glyphs['P']} P  ${glyphs['N']} N  ${glyphs['NA']} NA  ${glyphs['NV']} NV`,
  )
  return lines.join('\n') + '\n'
}

/**
 * #1419: no-regress gate delegation. Runs `gold-audit.mjs --check` in the target
 * repo and surfaces the engine's exit code (0 bootstrap/pass, 1 regress/disarm).
 * The engine streams its own human line to stdout; we forward it. CliError (the
 * engine's non-zero exit) maps to exitCode 1 — never throws to the caller.
 */
function runGoldAuditCheck(
  repo: string,
  script: string,
  cls: BrownfieldClass,
  opts: GoldAuditOptions,
): GoldAuditResult {
  const args = [script, '--check', '--class', cls]
  if (opts.requireBaseline) args.push('--require-baseline')
  if (opts.stack) args.push('--stack', opts.stack)
  try {
    const { stdout, stderr } = runCli('node', args, { cwd: repo })
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    return { exitCode: 0, payload: null }
  } catch (err) {
    if (err instanceof CliError) {
      if (err.stdout) process.stdout.write(err.stdout)
      if (err.stderr) process.stderr.write(err.stderr)
      // exitCode 2 = engine IO error; anything else (incl. regress) = gate fail (1).
      return { exitCode: err.exitCode === 2 ? 2 : 1, payload: null }
    }
    process.stderr.write(`gold-audit: engine failed — ${String(err)}\n`)
    return { exitCode: 1, payload: null }
  }
}

/**
 * #1475: cockpit delegation. Runs `gold-audit.mjs --cockpit-data` (scored payload + out-of-band
 * freshness), then renders the rich console at the right TTY/ascii tier. Never re-scores.
 */
function runGoldAuditCockpit(
  repo: string,
  script: string,
  cls: BrownfieldClass,
  opts: GoldAuditOptions,
): GoldAuditResult {
  const args = [script, '--cockpit-data', '--class', cls]
  if (opts.stack) args.push('--stack', opts.stack)
  let stdout: string
  try {
    stdout = runCli('node', args, { cwd: repo }).stdout
  } catch (err) {
    const detail = err instanceof CliError ? err.message : String(err)
    process.stderr.write(`gold-audit: engine failed — ${detail}\n`)
    return { exitCode: 1, payload: null }
  }
  const text = stdout.trim()
  if (!text.startsWith('{')) {
    // SKIP (no registry) — forward the engine's plain line.
    if (!opts.quiet) process.stdout.write(text + '\n')
    return { exitCode: 0, payload: null }
  }
  let env: { payload: GoldAuditPayload; freshness?: FreshnessInfo }
  try {
    env = JSON.parse(text) as { payload: GoldAuditPayload; freshness?: FreshnessInfo }
  } catch (err) {
    process.stderr.write(`gold-audit: invalid cockpit JSON — ${(err as Error).message}\n`)
    return { exitCode: 1, payload: null }
  }
  if (!opts.quiet) {
    const ascii = asciiOnly(Boolean(opts.ascii))
    const color = colorEnabled() && !ascii
    try {
      process.stdout.write(renderCockpit(env.payload, env.freshness ?? null, { color, ascii }))
    } catch (err) {
      // Defense-in-depth: renderCockpit is pure but consumes an untyped subprocess envelope — a
      // pathologically malformed payload must degrade to an error, never a raw stack trace.
      process.stderr.write(`gold-audit: could not render cockpit — ${(err as Error).message}\n`)
      return { exitCode: 1, payload: env.payload }
    }
  }
  return { exitCode: 0, payload: env.payload }
}

/**
 * Run the gold-audit engine and present the level band + gap report.
 * Reuses the engine (no second engine); returns the enriched payload for callers/tests.
 */
export function runGoldAudit(opts: GoldAuditOptions = {}): GoldAuditResult {
  const repo = opts.repo ? resolve(opts.repo) : process.cwd()
  const cls = resolveClass(repo, opts.class)
  const script = resolve(packageRoot(), 'scripts/gold-audit.mjs')

  // #1419: --check delegates to the engine's no-regress path (bootstrap-or-gate),
  // not the --json scorer. Used by the downstream thin runner.
  if (opts.check) return runGoldAuditCheck(repo, script, cls, opts)

  // #1475: --cockpit renders the rich goldness console over the engine's --cockpit-data envelope
  // (scored payload + out-of-band freshness). Pure presentation; never re-scores. `--ascii` implies
  // the cockpit (it is a cockpit-only modifier — otherwise it would be a silent no-op).
  if (opts.cockpit || opts.ascii) return runGoldAuditCockpit(repo, script, cls, opts)

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
    if (!opts.quiet) {
      if (opts.json) process.stdout.write(stdout)
      else process.stdout.write(text + '\n')
    }
    return { exitCode: 0, payload: null }
  }

  let payload: GoldAuditPayload
  try {
    payload = JSON.parse(text) as GoldAuditPayload
  } catch (err) {
    process.stderr.write(`gold-audit: engine emitted invalid JSON — ${(err as Error).message}\n`)
    return { exitCode: 1, payload: null }
  }

  if (!opts.quiet) {
    if (opts.json) process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    else process.stdout.write(renderReport(payload))
  }
  return { exitCode: 0, payload }
}
