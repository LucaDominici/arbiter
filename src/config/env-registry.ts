// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical registry of every `ARBITER_*` environment flag (#1538).
 *
 * Problem this solves: arbiter reads ~40 distinct `ARBITER_*` environment
 * variables — several of which DISABLE enforcement gates — via raw
 * `process.env['ARBITER_…']` scattered across `src/` and `scripts/`. There was
 * no single place declaring the flag set, so a mistyped flag silently no-ops
 * (the read falls back to its default with no warning) and the highest-stakes
 * surface (gate bypass) was the least governed.
 *
 * This module is that single source of truth. It:
 *   - Declares every flag with `name`, `type`, `purpose`, `default`, and
 *     `isGateBypass` so the set is self-documenting and machine-checkable.
 *   - Exposes `KNOWN_ARBITER_FLAGS` so the inventory guard
 *     (`__tests__/config/env-flag-inventory.test.ts`) can FAIL when a raw
 *     `process.env['ARBITER_…']` read targets a name that is not registered
 *     (typo / undocumented-flag drift guard).
 *   - Provides `getBoolFlag`, a typed getter built on `parseBooleanEnv`, so
 *     boolean reads go through one validated, consistently-parsed path.
 *
 * The two prefix dispatchers (`ARBITER_THRESHOLD__*`, `ARBITER_FEATURE__*`) are
 * declared here for documentation but are matched dynamically in
 * `src/config/env-overrides.ts` — they have no fixed flag name.
 *
 * Migration is incremental: the bypass-class flags and the curated TS reads
 * route through this registry first; the remaining config/log/path flags are
 * declared here (so the inventory guard covers them) and migrated over time.
 */

import { parseBooleanEnv } from '../utils/env.js'

type Env = Record<string, string | undefined>

/** Value shape of an `ARBITER_*` flag. `prefix` marks a dynamic dispatcher. */
export type EnvFlagType = 'boolean' | 'number' | 'string' | 'enum' | 'prefix'

export interface EnvFlag {
  /** Full env-var name, e.g. `ARBITER_SKIP_TDD`. */
  readonly name: string
  /** Parsed shape of the value. */
  readonly type: EnvFlagType
  /** One-line description of what the flag does. */
  readonly purpose: string
  /** Default applied when the var is absent (for documentation). */
  readonly default?: string | number | boolean
  /** True when the flag disables or weakens an enforcement gate. */
  readonly isGateBypass: boolean
  /** Allowed values for an `enum` flag. */
  readonly enumValues?: readonly string[]
}

/**
 * The complete flag set. Adding a new `ARBITER_*` read to `src/` or `scripts/`
 * without adding its entry here is a gate violation (the inventory guard fails).
 */
export const ARBITER_ENV_FLAGS: readonly EnvFlag[] = [
  // ── Runtime / trace ──────────────────────────────────────────────────────
  {
    name: 'ARBITER_RUN_ID',
    type: 'string',
    purpose:
      'Trace ID for the current process; minted once and exported so subprocesses inherit it.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_LOG_LEVEL',
    type: 'enum',
    enumValues: ['error', 'warn', 'info', 'debug', 'trace'],
    default: 'info',
    purpose:
      'Minimum log level. CLI --log-level takes precedence; invalid values fall back to info.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_LOG_FORMAT',
    type: 'enum',
    enumValues: ['text', 'json'],
    default: 'text',
    purpose: 'Log output format. CLI --log-format takes precedence.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_LOCALE',
    type: 'string',
    purpose: 'Override the UI locale. Falls back to LC_ALL, LC_MESSAGES, LANG, then "en".',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_EXPERIMENTAL',
    type: 'string',
    purpose:
      'JSON map of enabled experimental flags; set by the CLI for downstream command access.',
    isGateBypass: false,
  },
  // ── Config overrides (top-level + prefix dispatchers) ────────────────────
  {
    name: 'ARBITER_LEVEL',
    type: 'enum',
    enumValues: ['L1', 'L2', 'L3', 'L4'],
    purpose: 'Governance level override for local gate runs.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_THRESHOLD__',
    type: 'prefix',
    purpose:
      'Prefix: override a thresholds.<field> value (e.g. ARBITER_THRESHOLD__LINE_COVERAGE=80).',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_FEATURE__',
    type: 'prefix',
    purpose: 'Prefix: override a features.<flag> value (e.g. ARBITER_FEATURE__MUTATION_TESTING=1).',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_CONSUMER_',
    type: 'prefix',
    purpose:
      'Credential namespace used only by the trusted consumer-reliability preparation process; stripped before verification.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_EVIDENCE_HARNESS',
    type: 'boolean',
    default: false,
    purpose:
      'Override the guard-done-evidence hook activation flag (#1872). "1"/"true" enforces, "0"/"false" disarms; unset falls through to features.evidenceHarness in arbiter.json.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_CROSS_MODEL_REVIEW',
    type: 'boolean',
    default: false,
    purpose:
      'Per-run override for crossModelReview.enabled; disabling it weakens the optional adversarial review axis.',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_ACCEPTANCE_ANCHOR',
    type: 'boolean',
    default: false,
    purpose:
      'Override the acceptance-criteria anchor gate activation (INV-138, scripts/check-acceptance.mjs). "1"/"true" enforces, "0"/"false" disarms; unset falls through to features.acceptanceAnchor in arbiter.json. Bespoke var (not ARBITER_FEATURE__*): the gate script cannot run TS config resolution.',
    isGateBypass: false,
  },
  // ── Paths / integration ──────────────────────────────────────────────────
  {
    name: 'ARBITER_EVIDENCE_DIR',
    type: 'string',
    purpose: 'Path to the evidence artifact directory.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_WORKTREES_DIR',
    type: 'string',
    purpose: 'Override the base directory where `arbiter worktree open` creates worktrees.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_GITHUB',
    type: 'string',
    purpose: 'Set to "1" to activate live GitHub API calls (opt-in).',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_DIFF_BASE',
    type: 'string',
    purpose: 'Base git ref for diff-scoped checks (plugin API stability).',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_MATRIX_LEVEL',
    type: 'string',
    purpose: 'Governance level filter for the feature-matrix check.',
    isGateBypass: false,
  },
  // ── Hooks ────────────────────────────────────────────────────────────────
  {
    name: 'ARBITER_HOOK_GIT_CWD',
    type: 'string',
    purpose: 'Working directory hooks resolve git operations against.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_HOOK_BASENAMES',
    type: 'string',
    purpose: 'Override the set of hook basenames considered by hook dispatch.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_HOOK_DEBOUNCE_MS',
    type: 'number',
    default: 20000,
    purpose: 'Debounce window (ms) for expensive post-edit hooks.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_FINDING_LOSS_HARD',
    type: 'boolean',
    default: false,
    purpose:
      'Escalates stop-finding-loss.mjs (E6b #1948) from advisory (exit 0) to hard block ' +
      '(exit 2) when 2+ research dispatches persisted zero findings since session start.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_SPAWN_GUARD_HARD',
    type: 'boolean',
    default: false,
    purpose:
      'Escalates pre-spawn-worktree-guard.mjs (E5 #1947) from advisory (exit 0) to hard ' +
      'block (exit 2) on a second write-intent spawn onto the main tree or a multi-task dispatch.',
    isGateBypass: false,
  },
  // ── Compatibility probing ────────────────────────────────────────────────
  {
    name: 'ARBITER_PROBE_TIMEOUT_MS',
    type: 'number',
    default: 10000,
    purpose: 'Per-tool compatibility probe timeout (ms).',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_BUILD_PROBE_TIMEOUT_MS',
    type: 'number',
    default: 60000,
    purpose: 'Build-step probe timeout (ms).',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_EXTERNAL_PROBE_TIMEOUT_MS',
    type: 'number',
    default: 5000,
    purpose:
      'External-model availability probe timeout (ms) — the `<provider> --version` spawn in ' +
      'src/detectors/external-model.ts. Five seconds is ample on an idle machine, but this is a ' +
      'wall-clock probe against a spawned process: on a loaded box the spawn alone can exceed it ' +
      'and the provider is then reported unavailable for a reason unrelated to the provider, so ' +
      'the cross-model seat degrades and the caller cannot tell that from "codex is not ' +
      'installed" (#2501).',
    isGateBypass: false,
  },
  // ── Workflow / parallelism ───────────────────────────────────────────────
  {
    name: 'ARBITER_MAX_NEEDS_CHAIN',
    type: 'number',
    default: 3,
    purpose: 'Maximum allowed length of a workflow `needs:` dependency chain.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_SELECTIVE_GATE',
    type: 'boolean',
    default: false,
    purpose:
      'Opt-in local-only speed mode (#2094): skip gate checks whose affects-registry entry ' +
      'proves untouched by the current diff vs origin/main. Never gates CI or a real push — ' +
      'the full unfiltered gate is the only merge authority.',
    isGateBypass: false,
  },
  // ── Loud-bypass audit metadata (ADR-072) ─────────────────────────────────
  {
    name: 'ARBITER_BYPASS_LOG_PATH',
    type: 'string',
    purpose: 'Override the JSONL path the loud-bypass audit contract appends to.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_BYPASS_BRANCH',
    type: 'string',
    purpose: 'Branch name recorded in the loud-bypass audit line.',
    isGateBypass: false,
  },
  // ── Pre-push gate ────────────────────────────────────────────────────────
  {
    name: 'ARBITER_EVIDENCE_MAX_AGE_MIN',
    type: 'number',
    default: 240,
    purpose:
      'Maximum age (minutes) of a gate-pass marker before every consumer refuses it (#2328).',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_PREPUSH_MAX_AGE_MIN',
    type: 'number',
    default: 240,
    purpose: 'Maximum age (minutes) of the freshest evidence file before a push is blocked.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_PREPUSH_EVIDENCE_DIR',
    type: 'string',
    default: '.arbiter/evidence',
    purpose: 'Override the evidence directory the pre-push freshness gate inspects.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_PREPUSH_BYPASS_REASON',
    type: 'string',
    purpose: 'Free-form justification recorded in the loud-bypass JSONL line.',
    isGateBypass: false,
  },
  // ── Gate-bypass switches (highest-stakes surface) ────────────────────────
  {
    name: 'ARBITER_NO_EVIDENCE',
    type: 'boolean',
    default: false,
    purpose: 'Suppress evidence-file writing for the current run (mirrors --no-evidence).',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_AUDIT_MODE',
    type: 'boolean',
    default: true,
    purpose:
      "Read by a generated consumer's check-all.mjs (#9003 gate-registry `audit: true` field) as " +
      'on/off (parseBooleanEnv shape) — off ("ARBITER_AUDIT_MODE=off") skips audit-only gates, ' +
      'a level-orthogonal axis (the #9003 design brief). Not read ' +
      "by arbiter's own CLI — the flag lives in the emitted script, not this process.",
    isGateBypass: true,
  },
  {
    name: 'ARBITER_SKIP_PLAN_REVIEW',
    type: 'boolean',
    default: false,
    purpose: 'Bypass the plan-review gate and write an audit bypass record. Refused under CI.',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_PLAN_BYPASS',
    type: 'boolean',
    default: false,
    purpose: 'Bypass the pre-edit plan-anchor hook (CANON-14). Emergency use only; logged.',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_POST_CLEAR',
    type: 'boolean',
    default: false,
    purpose: 'Signal a post-/clear re-entry (mirrors --post-clear); controls handoff strategy.',
    isGateBypass: false,
  },
  {
    name: 'ARBITER_SKIP_DOCS',
    type: 'boolean',
    default: false,
    purpose: 'Skip the docs-freshness gate. Routed through the loud-bypass audit contract.',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_SKIP_TDD',
    type: 'boolean',
    default: false,
    purpose: 'Skip the TDD-evidence gate. For non-#NNN hygiene/chore commits only.',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_SKIP_GATE_MARKER',
    type: 'boolean',
    default: false,
    purpose:
      'Bypass the gate-pass marker requirement in the pre-PR hook and task phase gate. Refused under CI.',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_SSOT_BYPASS',
    type: 'boolean',
    default: false,
    purpose: 'Bypass the pre-edit SSOT guard hook.',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_GATE_BYPASS',
    type: 'boolean',
    default: false,
    purpose: 'Generic gate bypass switch (loud-bypass audited).',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_PREPUSH_BYPASS',
    type: 'boolean',
    default: false,
    purpose: 'Bypass the pre-push freshness gate (exact "true"); loud-bypass audited.',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_PREPUSH_SKIP',
    type: 'boolean',
    default: false,
    purpose:
      'Skip the pre-push freshness gate silently. Reserved for hook recursion / test harness.',
    isGateBypass: true,
  },
  {
    name: 'ARBITER_ALLOW_CHANNEL_DOWNGRADE',
    type: 'boolean',
    default: false,
    purpose: 'Allow a release-channel downgrade without an interactive TTY prompt.',
    isGateBypass: true,
  },
]

const FLAG_BY_NAME: ReadonlyMap<string, EnvFlag> = new Map(
  ARBITER_ENV_FLAGS.map((f) => [f.name, f]),
)

/** Every registered flag name (includes the two prefix dispatchers). */
export const KNOWN_ARBITER_FLAGS: ReadonlySet<string> = new Set(FLAG_BY_NAME.keys())

/**
 * Typed boolean getter for a registered `ARBITER_*` flag.
 *
 * Built on `parseBooleanEnv`, so "1", "true", "yes", "on" (and their falsy
 * counterparts) are all accepted consistently. An unset or unrecognised value
 * falls back to the flag's declared default (or `false`).
 *
 * Throws when `name` is not a registered boolean flag — a programmer error
 * caught at dev/test time, which is exactly the typo guard this registry adds.
 */
export function getBoolFlag(name: string, env: Env = process.env): boolean {
  const spec = FLAG_BY_NAME.get(name)
  if (spec === undefined || spec.type !== 'boolean') {
    throw new Error(`getBoolFlag: "${name}" is not a registered boolean ARBITER_* flag (#1538)`)
  }
  const parsed = parseBooleanEnv(env[name])
  if (parsed !== undefined) return parsed
  return spec.default === true
}

/**
 * Reads a registered numeric ARBITER_* flag, falling back to its declared
 * default when unset, unparseable or non-positive. Same typo guard as
 * {@link getBoolFlag}: an unregistered name throws.
 */
export function getNumberFlag(name: string, env: Env = process.env): number {
  const spec = FLAG_BY_NAME.get(name)
  if (spec === undefined || spec.type !== 'number') {
    throw new Error(`getNumberFlag: "${name}" is not a registered numeric ARBITER_* flag (#1538)`)
  }
  const fallback = typeof spec.default === 'number' ? spec.default : 0
  const parsed = Number(env[name])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
