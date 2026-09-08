// SPDX-License-Identifier: Apache-2.0
// `arbiter doc-set` — a THIN wrapper over the SSOT gold doc-set engine (H1, gold-doc-capability).
//
// Existing Code Survey: the presence-audit ENGINE already exists as scripts/check-doc-set.mjs
// (overlays, accept_any, glob, ADR dual-recognition, write-safe --generate, --strict). No second
// engine is introduced here: this command shells `node scripts/check-doc-set.mjs` through the
// INV-12 runCli helper and forwards its verdict. It mirrors src/commands/gold-audit.ts (thin
// wrapper over gold-audit.mjs).
//
// Why this command had to exist (H1): the generated governed-repo thin-runner
// (scripts/check-doc-set.mjs.ejs) has always shelled `npx arbiter doc-set` — but until this file,
// no such CLI command was registered, so every governed repo's doc-set presence gate failed with
// `error: unknown command 'doc-set'`. This file is what makes that runner resolve.

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'
import { jsonOutput } from '../utils/json-output.js'

/** The engine's `--json` audit payload (scripts/check-doc-set.mjs). */
export interface DocSetPayload {
  manifest: string
  profile: { overlays: string[] }
  /** H3/T1b (gold-doc-capability Tranche 1 / self-tier addendum §1): the EFFECTIVE tiers{} column. */
  tierColumn: 'solo' | 'small' | 'enterprise'
  /** T1b: what collaborationMode alone resolves to, before any `tier_floor` is applied. */
  tierDerived?: 'solo' | 'small' | 'enterprise'
  /** T1b: the profile's `tier_floor`, or null when the repo sets none (governed default). */
  tierFloor?: 'solo' | 'small' | 'enterprise' | null
  totals: {
    applicable: number
    present: number
    missingMandatory: number
    missingRecommended: number
    na: number
  }
  missingMandatory: string[]
  missingRecommended: string[]
  /**
   * T3 (gold-doc-tranches-t3-t5.md §1.2a): structured per-gap entries, additive alongside the
   * legacy string arrays above (never removed — the doc-set.test.ts payload-parity test pins the
   * whole-payload equality between this wrapper and the raw engine invocation). `template` is the
   * manifest's dormant `template:` catalog id (undefined when the row has none bound — reported
   * as "unbound" by the generator, never guessed). Consumed by src/generators/doc-set.ts.
   */
  missing?: Array<{
    path: string
    requirement: 'mandatory' | 'recommended'
    template?: string
    freshness_class?: string
    purpose?: string
  }>
  /**
   * T3: the mirror of `missing[]` for checks the engine found PRESENT — presence is content-
   * blind (a file merely existing satisfies it), so an untouched `--generate` banner stub is
   * "present" too and would otherwise be invisible to a `missing[]`-only consumer. Lets the
   * generator detect + upgrade a stub without a second resolution pass.
   */
  present?: Array<{
    path: string
    template?: string
    freshness_class?: string
    purpose?: string
  }>
  generated: string[]
  refreshed: string[]
}

export interface DocSetOptions {
  /** Repo to audit (default: current directory). */
  repo?: string
  /** exit 1 if any mandatory doc is missing (delegates verbatim to the engine's own --strict exit code). */
  strict?: boolean
  /** Emit machine-readable JSON instead of the human report. */
  json?: boolean
  /** Scaffold stubs for missing mandatory+recommended .md docs (write-safe: never overwrites). */
  generate?: boolean
  /** With --generate: re-render a doc in place only if it is byte-equal to the stub template. */
  refreshStubs?: boolean
  /** Manifest path override (default standards/gold-doc-set.yml, resolved inside the target repo). */
  manifest?: string
  /** Overlay-profile path override (default standards/doc-profile, resolved inside the target repo). */
  profile?: string
  /** Suppress this command's own stdout/stderr passthrough — return only the parsed result. */
  quiet?: boolean
  /**
   * T4 (gold-doc-tranches-t3-t5.md §2.3): route to the freshness engine
   * (scripts/check-doc-freshness.mjs) instead of the presence engine. No new top-level CLI
   * command — a flag on this already-ledgered one. Mutually exclusive in effect with
   * strict/generate/refreshStubs (the freshness engine doesn't have those concepts); they are
   * simply never forwarded when this is set.
   */
  freshness?: boolean
  /**
   * INV-144: route to the arc42 slot-completeness engine (scripts/check-arc42-slots.mjs) instead
   * of the presence engine. Same rationale as `freshness` — a flag on this already-ledgered
   * command rather than a second top-level verb (CANON-16). The engine reads its arc42 skeletons
   * from arbiter's own tree and the audited document from `repo`, so a governed project is held to
   * the skeleton it was generated from without carrying a copy of it.
   */
  arc42?: boolean
  /** INV-144 (with `arc42`): re-record the ratchet counters. Refused when a counter rose. */
  updateBaseline?: boolean
}

export interface DocSetResult {
  /** The engine's own exit code, forwarded verbatim: 0=pass/advisory, 1=fail(--strict gap), 2=error. */
  exitCode: number
  /** Parsed `--json` payload, or null when --json was not requested or the engine emitted a non-JSON SKIP line. */
  payload: DocSetPayload | null
}

/** Resolve the package root (this file lives at src/commands/, two levels down). */
function packageRoot(): string {
  return resolve(fileURLToPath(import.meta.url), '../../..')
}

/** Build the engine CLI args from options — one flag per option, no branching beyond presence. */
function buildEngineArgs(opts: DocSetOptions): string[] {
  const args: string[] = []
  if (opts.json) args.push('--json')
  // --manifest/--profile are pushed AFTER the arc42 early return, not before it: the arc42 engine
  // knows only --dir/--skeleton-root/--update-baseline/--json, so forwarding them there meant
  // `--arc42 --manifest custom.yml` silently audited the DEFAULT manifest and reported PASS
  // against a file the operator had named and never got.
  if (opts.arc42) return opts.updateBaseline ? [...args, '--update-baseline'] : args
  if (opts.manifest) args.push('--manifest', opts.manifest)
  if (opts.profile) args.push('--profile', opts.profile)
  // The freshness engine has no --strict/--generate/--refresh-stubs concept (binary verdict, no
  // scaffolding) — never forward them even if a caller set both `freshness` and one of these.
  if (opts.freshness) return args
  if (opts.strict) args.push('--strict')
  if (opts.generate) args.push('--generate')
  if (opts.refreshStubs) args.push('--refresh-stubs')
  return args
}

/**
 * Which engine answers this invocation. One row per route rather than nested ternaries, so adding
 * a fourth route later is a line, not a re-read of the whole expression.
 */
function engineFor(opts: DocSetOptions): string {
  if (opts.arc42) return 'scripts/check-arc42-slots.mjs'
  if (opts.freshness) return 'scripts/check-doc-freshness.mjs'
  return 'scripts/check-doc-set.mjs'
}

/** Result of the raw engine invocation, before JSON parsing. */
interface EngineRun {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Run the engine and normalize its outcome to {stdout, stderr, exitCode} — never throws. The
 * engine's own exit code (0 pass/advisory, 1 --strict mandatory gap) is forwarded verbatim; only
 * a genuine infra failure (ENOENT/ENOBUFS/timeout, or a non-CliError crash) maps to 2 (ERROR).
 */
function runEngine(script: string, args: string[], repo: string): EngineRun {
  try {
    const r = runCli('node', [script, ...args], { cwd: repo })
    return { stdout: r.stdout, stderr: r.stderr, exitCode: 0 }
  } catch (err) {
    if (err instanceof CliError) {
      // runCli only throws on a non-zero exit or an infra failure (ENOENT/ENOBUFS/timeout — all
      // surfaced as exitCode -1 by classifyAttempt). A genuine engine exit (0 or 1) is never -1,
      // so any negative code here IS an infra failure, not the strict-mode "mandatory gap" exit —
      // map it to the engine's own ERROR band (2) rather than misreporting it as a doc gap (1).
      return {
        stdout: err.stdout,
        stderr: err.stderr,
        exitCode: err.exitCode >= 0 ? err.exitCode : 2,
      }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { stdout: '', stderr: `doc-set: engine failed — ${msg}\n`, exitCode: 2 }
  }
}

/**
 * Parse the engine's stdout as the JSON payload, when JSON was requested. The engine emits a
 * plain SKIP line (no manifest found) instead of JSON even under --json — that (and any parse
 * failure) degrades to `null`, never a thrown JSON.parse error.
 */
function parsePayload(stdout: string, jsonRequested: boolean): DocSetPayload | null {
  if (!jsonRequested) return null
  const text = stdout.trim()
  if (!text.startsWith('{')) return null
  try {
    return JSON.parse(text) as DocSetPayload
    // FAIL-OPEN-INTENT: a parse failure is the engine's documented plain-text SKIP path, not an error.
  } catch {
    return null
  }
}

/**
 * Run the gold doc-set presence-audit engine and forward its verdict.
 * Reuses the engine (no second engine, no re-scoring) — the exit code IS the engine's exit code.
 */
export function runDocSet(opts: DocSetOptions = {}): DocSetResult {
  const repo = opts.repo ? resolve(opts.repo) : process.cwd()
  const script = resolve(packageRoot(), engineFor(opts))

  const { stdout, stderr, exitCode } = runEngine(script, buildEngineArgs(opts), repo)

  const payload = parsePayload(stdout, Boolean(opts.json))
  if (!opts.quiet) {
    if (opts.json) {
      jsonOutput(
        'doc-set',
        exitCode === 0 ? 'ok' : exitCode === 1 ? 'warning' : 'error',
        payload === null ? {} : { ...payload },
      )
    } else if (stdout) {
      process.stdout.write(stdout)
    }
    if (stderr) process.stderr.write(stderr)
  }

  return { exitCode, payload }
}
