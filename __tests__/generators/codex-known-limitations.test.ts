// SPDX-License-Identifier: Apache-2.0
// ADR-106 (#1966): the CODEX.md Known Limitations inventory is DERIVED from
// the same plans the Claude generators execute — these tests lock the
// derivation and the fail-closed descriptor contract.
import { describe, it, expect } from 'vitest'
import {
  buildKnownLimitations,
  planClaudeHookInventory,
  CODEX_DERIVED_RULES,
} from '../../src/generators/codex-known-limitations.js'
import { planClaudeHooks } from '../../src/generators/claude.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

function config(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return makeConfig('/tmp/unused-known-limitations', overrides)
}

describe('planClaudeHookInventory', () => {
  it('mirrors planClaudeHooks plus the out-of-generator emitters (security, wiki)', () => {
    const cfg = config()
    const inventory = planClaudeHookInventory(cfg)
    const plan = planClaudeHooks(cfg).map((e) => e.file)
    for (const f of plan) expect(inventory).toContain(f)
    // L2 + enableSecurityScanning=true → security.ts and wiki.ts hooks included
    expect(inventory).toContain('check-no-pii.mjs')
    expect(inventory).toContain('wiki-on-commit.mjs')
  })

  it('drops check-no-pii when security scanning is off and wiki-on-commit at L1', () => {
    const inventory = planClaudeHookInventory(
      config({ governanceLevel: 'L1', enableSecurityScanning: false, enableDebtGates: false }),
    )
    expect(inventory).not.toContain('check-no-pii.mjs')
    expect(inventory).not.toContain('wiki-on-commit.mjs')
    // L2-only hooks absent too
    expect(inventory).not.toContain('guard-task-completion.mjs')
  })
})

describe('buildKnownLimitations', () => {
  it('produces a row for every non-infra hook in the inventory', () => {
    const cfg = config()
    const kl = buildKnownLimitations(cfg)
    const rowNames = kl.hooks.map((h) => h.name)
    const inventory = planClaudeHookInventory(cfg)
    for (const hook of inventory) {
      if (hook === 'hooks.mjs' || hook === 'lib.mjs') {
        expect(rowNames, `infra hook ${hook} must not be a table row`).not.toContain(hook)
      } else {
        expect(rowNames, `emitted hook ${hook} must be disclosed`).toContain(hook)
      }
    }
    expect(new Set(rowNames).size, 'no duplicate rows').toBe(rowNames.length)
  })

  it('marks the config.toml-wired guard hooks as bridged', () => {
    const kl = buildKnownLimitations(config())
    for (const bridged of [
      'stop-dangerous.mjs',
      'enforce-read-only.mjs',
      'pre-edit-ssot-guard.mjs',
      'check-no-orphan-todo.mjs',
      'check-no-placeholders.mjs',
      'check-no-skipped-tests.mjs',
      'check-no-pii.mjs',
    ]) {
      const row = kl.hooks.find((h) => h.name === bridged)
      expect(row, `${bridged} row`).toBeDefined()
      expect(row!.codexEquivalent).toContain('codex-adapter.mjs')
    }
  })

  it('derives the Claude-only rule delta from the plans (never hand-listed)', () => {
    const kl = buildKnownLimitations(config())
    expect(kl.claudeOnlyRules).toEqual([
      '40-context-economy.md',
      '55-brainstorm-terminal-state.md',
      '75-impact-vault-reading.md',
      '95-closer-mode.md',
    ])
    const withMcp = buildKnownLimitations(config({ enableMcpFallback: true }))
    expect(withMcp.claudeOnlyRules).toContain('45-mcp-fallback.md')
  })

  it('lists commands, agents, and skills inventories with content', () => {
    const kl = buildKnownLimitations(config())
    expect(kl.commands).toContain('ship')
    expect(kl.commands).toContain('task')
    expect(kl.agents).toContain('red-team')
    expect(kl.skills.length).toBeGreaterThan(0)
  })

  it('fails closed on a hook without a descriptor (undisclosed gap = error)', () => {
    const cfg = config({
      languageHooks: [{ name: 'check-brand-new-thing.mjs', body: '// hook body\n' }],
    })
    expect(() => buildKnownLimitations(cfg)).toThrow(/no descriptor for Claude hook/)
  })

  it('CODEX_DERIVED_RULES point at canonical claude templates only', () => {
    for (const rule of CODEX_DERIVED_RULES) {
      expect(rule.template.startsWith('claude/rules/')).toBe(true)
    }
    expect(CODEX_DERIVED_RULES.map((r) => r.file)).toContain('90-exec-protocol.md')
  })
})
