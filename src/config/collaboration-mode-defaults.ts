// SPDX-License-Identifier: Apache-2.0
/**
 * ADR-051: collaboration-mode defaults table.
 * Maps (CollaborationMode × GovernanceLevel) → pipelineStyle, branchingStrategy,
 * worktree auto-mode, and merge mode.
 *
 * Design principles:
 * - Lookup table over if/else chains — easy to audit and extend
 * - Pure functions with no side effects — safe to import anywhere
 * - Exported resolver functions are the public API; the raw table is internal
 */
import type {
  CollaborationMode,
  BranchingStrategy,
  SoloMergeMode,
  WorktreeAutoMode,
  GovernanceLevel,
  WizardAnswers,
  ProjectConfig,
} from '../wizard/types.js'

// ── Pipeline style table: (collaborationMode × governanceLevel) ──────────────
// Encodes the design from ADR-051 §collaboration-mode-axis plan table.

type PipelineStyle = 'starter' | 'standard' | 'industrial'

const PIPELINE_STYLE_TABLE: Record<CollaborationMode, Record<GovernanceLevel, PipelineStyle>> = {
  'trunk-solo': {
    L1: 'starter',
    L2: 'starter',
    L3: 'standard',
    L4: 'standard',
  },
  'peer-review': {
    L1: 'starter',
    L2: 'standard',
    L3: 'standard',
    L4: 'standard',
  },
  'gated-review': {
    L1: 'standard',
    L2: 'standard',
    L3: 'industrial',
    L4: 'industrial',
  },
}

// ── Branching strategy defaults ───────────────────────────────────────────────

const BRANCHING_STRATEGY_DEFAULTS: Record<CollaborationMode, BranchingStrategy> = {
  'trunk-solo': 'trunk-direct',
  'peer-review': 'github-flow',
  'gated-review': 'github-flow',
}

// ── Worktree auto-mode defaults ───────────────────────────────────────────────

const WORKTREE_MODE_DEFAULTS: Record<CollaborationMode, WorktreeAutoMode> = {
  'trunk-solo': 'optional',
  'peer-review': 'always',
  'gated-review': 'always',
}

// ── Merge mode defaults ───────────────────────────────────────────────────────

const MERGE_MODE_DEFAULTS: Record<CollaborationMode, SoloMergeMode> = {
  'trunk-solo': 'direct',
  'peer-review': 'pr-ff',
  'gated-review': 'pr-ff',
}

// ── Ship-autonomy derived default ─────────────────────────────────────────────
// ADR-094 §Decision.3 names this module the single derived-default site for the
// unified override resolver. A repo with no `automation` block (and no override)
// lands here. ADR-093 §4 / #1261 pin the safe default at L0 (ask each ship step);
// keeping it a named constant prevents a second `'L0'` literal leaking into the
// resolver. AutonomyLevel is unimported here to avoid a config→config cycle; the
// literal is the canonical value and is type-checked at the resolver boundary.
export const DEFAULT_AUTONOMY = 'L0'

// ── Public resolver API ───────────────────────────────────────────────────────

/** Resolves pipelineStyle from the collaboration mode + governance level table. */
export function resolvePipelineStyle(
  mode: CollaborationMode,
  level: GovernanceLevel,
): PipelineStyle {
  return PIPELINE_STYLE_TABLE[mode][level]
}

/** Returns the default branchingStrategy for a collaboration mode. */
export function resolveDefaultBranchingStrategy(mode: CollaborationMode): BranchingStrategy {
  return BRANCHING_STRATEGY_DEFAULTS[mode]
}

/** Returns the default worktree auto-mode for a collaboration mode. */
export function resolveDefaultWorktreeMode(mode: CollaborationMode): WorktreeAutoMode {
  return WORKTREE_MODE_DEFAULTS[mode]
}

/** Returns the default merge mode for a collaboration mode. */
export function resolveDefaultMergeMode(mode: CollaborationMode): SoloMergeMode {
  return MERGE_MODE_DEFAULTS[mode]
}

/**
 * Resolves the effective CollaborationMode from WizardAnswers.
 * Precedence: explicit collaborationMode > soloDevMode alias > default 'peer-review'.
 * ADR-051: soloDevMode=true is a backward-compat alias for collaborationMode='trunk-solo'.
 */
export function collaborationModeFromAnswers(answers: Partial<WizardAnswers>): CollaborationMode {
  if (answers.collaborationMode) return answers.collaborationMode
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (answers.soloDevMode === true) return 'trunk-solo'
  return 'peer-review'
}

/**
 * Canonical resolver for collaborationMode from a ProjectConfig.
 * Precedence: explicit collaborationMode > soloDevMode alias > default 'peer-review'.
 * ADR-051 (#1119): SINGLE derivation site — all callers (init, update/diff, branch-
 * protection, generators) delegate here. Eliminates the ≥3 duplicated fallback chains.
 */
export function resolveCollaborationMode(config: {
  collaborationMode?: CollaborationMode
  enableSoloDevMode?: boolean
}): CollaborationMode {
  if (config.collaborationMode !== undefined) return config.collaborationMode
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- back-compat alias
  return config.enableSoloDevMode === true ? 'trunk-solo' : 'peer-review'
}

/** The full derived axis bundle resolved from a ProjectConfig. */
export interface CollaborationAxes {
  collaborationMode: CollaborationMode
  mergeMode: SoloMergeMode
  worktreeMode: WorktreeAutoMode
  branchingStrategy: BranchingStrategy
  pipelineStyle: PipelineStyle
}

/**
 * Resolve the full collaboration-mode axis bundle from a ProjectConfig.
 * Explicit overrides take precedence; absent fields are derived from the resolver tables.
 *
 * Design invariant (ADR-051 §#1119): only collaborationMode + user overrides
 * (solo.mergeMode, branchingStrategy) are persisted in arbiter.json; the rest is
 * always re-derived here at render time so init and update produce identical output.
 */
export function resolveCollaborationAxes(config: ProjectConfig): CollaborationAxes {
  const collaborationMode = resolveCollaborationMode(config)
  return {
    collaborationMode,
    mergeMode: config.solo?.mergeMode ?? resolveDefaultMergeMode(collaborationMode),
    worktreeMode: config.tasks?.worktree ?? resolveDefaultWorktreeMode(collaborationMode),
    branchingStrategy:
      config.branchingStrategy ?? resolveDefaultBranchingStrategy(collaborationMode),
    pipelineStyle:
      config.pipelineStyle ?? resolvePipelineStyle(collaborationMode, config.governanceLevel),
  }
}
