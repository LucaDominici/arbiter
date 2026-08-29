// SPDX-License-Identifier: Apache-2.0
// CODEX.md "Known Limitations" inventory (ADR-106, #1966).
//
// The table in CODEX.md is GENERATED from the same declarative plans the
// Claude-track generators execute (planClaudeHooks / planClaudeRules /
// CLAUDE_COMMANDS / AGENT_NAMES / SKILL_NAMES) — never hand-maintained. A
// hook emitted without a descriptor row below is a generation-time error
// (fail-closed), so a new Claude hook cannot ship without declaring its Codex
// disclosure. The repo gate (scripts/check-codex-parity.mjs) additionally
// compares the generated table against the ACTUAL baked hook inventory
// (hardening 8: non-circular — bake scan, not this registry, is the oracle).

import { planClaudeHooks, planClaudeRules, CLAUDE_COMMANDS } from './claude.js'
import { AGENT_NAMES } from './agents-claude.js'
import { SKILL_NAMES } from './skills.js'
import type { ProjectConfig } from '../wizard/types.js'

/**
 * The shared rules the Codex track DERIVES from the canonical Claude rule
 * templates (ADR-106 derive-from-Claude: single template set, no parallel
 * Codex copies). Consumed by codex.ts (emission) and by the Claude-only rule
 * delta below. The Claude track also emits 40-context-economy,
 * 55-brainstorm-terminal-state, 75-impact-vault-reading, 95-closer-mode
 * (plus conditional 45-mcp-fallback) — those are DELIBERATELY not derived
 * because each is coupled to a Claude-only mechanism the Codex track does not
 * generate (knowledge-map routing, brainstorm hook, /impact skill, CLOSER
 * hook). That delta is disclosed in the generated CODEX.md and locked by
 * __tests__/tools/codex.test.ts + the check-codex-parity gate.
 */
export const CODEX_DERIVED_RULES: readonly { file: string; template: string }[] = [
  { file: '05-agent-lifecycle.md', template: 'claude/rules/05-agent-lifecycle.md' },
  { file: '25-todo-folder-policy.md', template: 'claude/rules/25-todo-folder-policy.md' },
  { file: '50-batch-execution.md', template: 'claude/rules/50-batch-execution.md' },
  { file: '60-incidental-capture.md', template: 'claude/rules/60-incidental-capture.md' },
  { file: '90-exec-protocol.md', template: 'claude/rules/90-exec-protocol.md.ejs' },
]

export interface KnownLimitationRow {
  name: string
  enforces: string
  codexEquivalent: string
}

export interface KnownLimitations {
  hooks: KnownLimitationRow[]
  commands: string[]
  agents: string[]
  skills: string[]
  claudeOnlyRules: string[]
}

const BRIDGED = 'Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs`' as const

/**
 * Disclosure for a hook that is BOTH bridged in real time and backed by a gate.
 * The gate half is not decoration: the bridge is edit-time and best-effort (a
 * Codex session can run with hooks disabled), the gate is the enforced boundary —
 * and the generated table is where a reader looks for the fallback command.
 */
const bridgedPlusGate = (gate: string): string => `${BRIDGED}; gate: ${gate}`

/**
 * Descriptor per hook basename: what it enforces + the honest Codex-side
 * disclosure. `infra` hooks (dispatcher/shared lib) are implementation
 * plumbing, not enforcement surface, and are excluded from the table — the
 * parity gate carries the same infra list in
 * scripts/data/codex-parity-exclusive.json (knownLimitationsInfra).
 */
const HOOK_DESCRIPTORS: Record<string, KnownLimitationRow | 'infra'> = {
  'hooks.mjs': 'infra',
  'lib.mjs': 'infra',
  'stop-dangerous.mjs': {
    name: 'stop-dangerous.mjs',
    enforces: 'Blocks dangerous shell commands before execution',
    codexEquivalent: BRIDGED,
  },
  'enforce-read-only.mjs': {
    name: 'enforce-read-only.mjs',
    enforces: 'Blocks edits to read-only / generated paths',
    codexEquivalent: BRIDGED,
  },
  'pre-edit-ssot-guard.mjs': {
    name: 'pre-edit-ssot-guard.mjs',
    enforces: 'Warns on SSOT/governance file edits',
    codexEquivalent: BRIDGED,
  },
  'check-no-orphan-todo.mjs': {
    name: 'check-no-orphan-todo.mjs',
    enforces: 'Blocks bare TODO without task ID (INV-06)',
    codexEquivalent: BRIDGED,
  },
  'check-no-placeholders.mjs': {
    name: 'check-no-placeholders.mjs',
    // Wording note: this DESCRIBES the anti-stub hook without using the exact
    // token the check-no-placeholders gate scans for (meta false positive).
    enforces: 'Blocks stub content and unfinished scaffolding in edited files',
    codexEquivalent: BRIDGED,
  },
  'check-no-skipped-tests.mjs': {
    name: 'check-no-skipped-tests.mjs',
    enforces: 'Blocks skipped/muted tests at edit time (INV-25)',
    codexEquivalent: BRIDGED,
  },
  'check-no-pii.mjs': {
    name: 'check-no-pii.mjs',
    enforces: 'Blocks PII patterns in source (real-time)',
    codexEquivalent: BRIDGED,
  },
  'enforce-gate-before-pr.mjs': {
    name: 'enforce-gate-before-pr.mjs',
    enforces: 'Blocks PR creation before the local gate passed',
    codexEquivalent: bridgedPlusGate('`node scripts/check-all.mjs L2` before push'),
  },
  'post-commit-check.mjs': {
    name: 'post-commit-check.mjs',
    enforces: 'Post-commit checklist verification',
    codexEquivalent: BRIDGED,
  },
  'check-no-unused-exports.mjs': {
    name: 'check-no-unused-exports.mjs',
    enforces: 'Blocks unused TypeScript exports (dead code)',
    codexEquivalent: bridgedPlusGate('dead-code check (`knip`) in `check-all.mjs`'),
  },
  'check-no-any.mjs': {
    name: 'check-no-any.mjs',
    enforces: 'Blocks TypeScript `any` types (INV-04)',
    codexEquivalent: bridgedPlusGate('`tsc --strict`'),
  },
  'check-no-unwrap.mjs': {
    name: 'check-no-unwrap.mjs',
    enforces: 'Blocks `.unwrap()` outside tests (Rust)',
    codexEquivalent: 'Gate: clippy lint step in `check-all.mjs`',
  },
  'check-no-unchecked-err.mjs': {
    name: 'check-no-unchecked-err.mjs',
    enforces: 'Blocks unchecked `err` returns (Go)',
    codexEquivalent: 'Gate: errcheck/vet step in `check-all.mjs`',
  },
  'check-no-bare-except.mjs': {
    name: 'check-no-bare-except.mjs',
    enforces: 'Blocks bare `except:` clauses (Python)',
    codexEquivalent: 'Gate: ruff lint step in `check-all.mjs`',
  },
  'check-no-raw-types.mjs': {
    name: 'check-no-raw-types.mjs',
    enforces: 'Blocks raw generic types (Java)',
    codexEquivalent: 'Gate: compiler lint step in `check-all.mjs`',
  },
  'check-no-mockmvc.mjs': {
    name: 'check-no-mockmvc.mjs',
    enforces: 'Blocks MockMvc in favour of real-server tests (Java)',
    codexEquivalent: 'Gate: test-realism checks in `check-all.mjs`',
  },
  'pre-edit-plan-anchor.mjs': {
    name: 'pre-edit-plan-anchor.mjs',
    enforces: 'Requires plan file in implementation phase',
    codexEquivalent: '`.agents/plan/PLAN.json` protocol',
  },
  'pre-compact.mjs': {
    name: 'pre-compact.mjs',
    enforces: 'Snapshots task state before context compaction',
    codexEquivalent: BRIDGED,
  },
  'post-edit-dispatch.mjs': {
    name: 'post-edit-dispatch.mjs',
    enforces: 'Runs post-edit agents for quality checks',
    codexEquivalent: 'None — manual code review',
  },
  'debug-state-on-failure.mjs': {
    name: 'debug-state-on-failure.mjs',
    enforces: 'Persists debug state on gate failure',
    codexEquivalent: 'None — manual logging',
  },
  'skill-forced-eval.mjs': {
    name: 'skill-forced-eval.mjs',
    enforces: 'Forces skill invocation before task start',
    codexEquivalent: BRIDGED,
  },
  'guard-task-completion.mjs': {
    name: 'guard-task-completion.mjs',
    enforces: 'Blocks premature done claims',
    codexEquivalent: BRIDGED,
  },
  'stop-evidence-guard.mjs': {
    name: 'stop-evidence-guard.mjs',
    enforces: 'Fail-closed completion backstop (INV-114)',
    codexEquivalent: 'None — manual discipline',
  },
  'closer-mode-guard.mjs': {
    name: 'closer-mode-guard.mjs',
    enforces: 'CLOSER-mode enforcement in the close phase',
    codexEquivalent: BRIDGED,
  },
  'exitplanmode-banner.mjs': {
    name: 'exitplanmode-banner.mjs',
    enforces: 'Plan-exit banner in the task lifecycle',
    codexEquivalent: 'None — informational only',
  },
  'guard-done-evidence.mjs': {
    name: 'guard-done-evidence.mjs',
    enforces: 'Requires recorded evidence before done claims',
    codexEquivalent: bridgedPlusGate('`arbiter verify tdd` / evidence checks'),
  },
  'post-brainstorm-stop.mjs': {
    name: 'post-brainstorm-stop.mjs',
    enforces: 'Brainstorm terminal-state guardrail (#1265)',
    codexEquivalent: BRIDGED,
  },
  'check-circular-deps.mjs': {
    name: 'check-circular-deps.mjs',
    enforces: 'Detects circular deps per-edit (INV-01)',
    codexEquivalent: bridgedPlusGate('`madge --circular src` in `check-all.mjs`'),
  },
  'wiki-on-commit.mjs': {
    name: 'wiki-on-commit.mjs',
    enforces: 'Regenerates the LLM wiki on commit (INV-116)',
    codexEquivalent: 'Gate: wiki-lint check in `check-all.mjs`',
  },
  'pre-spawn-worktree-guard.mjs': {
    name: 'pre-spawn-worktree-guard.mjs',
    enforces: 'Refuses a second write-intent sub-agent spawn onto the main tree (E5 #1947)',
    codexEquivalent: 'None — manual worktree discipline',
  },
  'stop-finding-loss.mjs': {
    name: 'stop-finding-loss.mjs',
    enforces: 'Detects research dispatches with zero persisted findings (E6b #1948)',
    codexEquivalent: 'None — manual discipline',
  },
}

/**
 * Full hook inventory for the Claude track of `config`: the claude.ts plan
 * plus the two out-of-generator emitters that also write .claude/hooks/
 * (security.ts → check-no-pii.mjs, wiki.ts → wiki-on-commit.mjs). Their
 * gating conditions are mirrored here; the parity gate's bake-scan comparison
 * (check-codex-parity.mjs) fails if this mirror ever drifts from the real
 * emissions.
 */
export function planClaudeHookInventory(config: ProjectConfig): string[] {
  const names = planClaudeHooks(config).map((e) => e.file)
  if (!config.existing.aiRulez) {
    if (config.enableSecurityScanning) names.push('check-no-pii.mjs')
    // #2257: wiki.ts now also guards the write on config.tools.includes('claude')
    // (codex-only projects get no Claude dispatcher, so no wiki-on-commit.mjs hook
    // to route) — mirrored here per the #1966 contract this function documents:
    // an inventory row for a hook that is never emitted is stale documentation.
    if (config.governanceLevel !== 'L1' && config.tools.includes('claude'))
      names.push('wiki-on-commit.mjs')
  }
  return names
}

/** Build the generated Known Limitations data for the CODEX.md template. */
export function buildKnownLimitations(config: ProjectConfig): KnownLimitations {
  const hooks: KnownLimitationRow[] = []
  for (const name of planClaudeHookInventory(config)) {
    const descriptor = HOOK_DESCRIPTORS[name]
    if (descriptor === undefined) {
      throw new Error(
        `codex-known-limitations: no descriptor for Claude hook "${name}" — ` +
          `add a row to HOOK_DESCRIPTORS (ADR-106: every emitted hook must be ` +
          `disclosed in the CODEX.md Known Limitations table)`,
      )
    }
    if (descriptor !== 'infra') hooks.push(descriptor)
  }

  const codexRuleFiles = new Set(CODEX_DERIVED_RULES.map((r) => r.file))
  const claudeOnlyRules = planClaudeRules(config)
    .map((r) => r.file)
    .filter((f) => !codexRuleFiles.has(f))

  return {
    hooks,
    commands: CLAUDE_COMMANDS.map((c) => c.replace(/\.md$/, '')),
    agents: [...AGENT_NAMES],
    skills: [...SKILL_NAMES],
    claudeOnlyRules,
  }
}
