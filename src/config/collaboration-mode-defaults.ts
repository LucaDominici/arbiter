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
