// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import type { AgentRulesIntermediate } from '../../src/agent-rules/intermediate.js'
import { emitCopilot } from '../../src/agent-rules/emitters/copilot.js'
import { emitCursor } from '../../src/agent-rules/emitters/cursor.js'
import { emitAider } from '../../src/agent-rules/emitters/aider.js'
import { emitClaude } from '../../src/agent-rules/emitters/claude.js'

// Fixture carries BOTH a hard-stop and an advisory invariant plus a workflow, so
// every emitter exercises its advisory branch (previously uncovered) as well as
// the hard-stop branch and the workflow loop.
function intermediate(): AgentRulesIntermediate {
  return {
    schemaVersion: '1.0',
    repo: 'demo',
    invariants: [
      {
        id: 'INV-01',
        statement: 'never commit to main',
        severity: 'hard-stop',
        enforcement: [{ type: 'gate', ref: 'pre-push' }],
        applies_to: ['*'],
      },
      {
        id: 'INV-99',
        statement: 'prefer small functions',
        severity: 'advisory',
        enforcement: [{ type: 'gate', ref: 'lint' }],
        applies_to: ['*.ts'],
      },
    ],
    workflows: [{ trigger: 'on PR', action: 'run the gate' }],
  }
}

describe('agent-rules emitters — hard-stop + advisory + workflow branches', () => {
  const emitters: Array<[string, (i: AgentRulesIntermediate) => string]> = [
    ['copilot', emitCopilot],
    ['cursor', emitCursor],
    ['aider', emitAider],
    ['claude', emitClaude],
  ]

  for (const [name, emit] of emitters) {
    it(`${name}: renders both severities and the workflow`, () => {
      const out = emit(intermediate())
      expect(out).toContain('INV-01')
      expect(out).toContain('never commit to main')
      expect(out).toContain('INV-99')
      expect(out).toContain('prefer small functions')
      expect(out).toContain('run the gate')
    })

    it(`${name}: omits empty sections when no invariants or workflows`, () => {
      const out = emit({ schemaVersion: '1.0', repo: 'empty', invariants: [], workflows: [] })
      expect(out).toContain('empty')
      expect(out).not.toContain('INV-')
    })
  }
})
