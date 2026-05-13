import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  runAgentRulesExport,
  runAgentRulesVerify,
  type AgentRulesExportOptions,
  type AgentRulesExportResult,
  type AgentRulesVerifyResult,
} from '../../src/commands/agent-rules.js'
import { severityFromTier } from '../../src/agent-rules/intermediate.js'
import type { GraphSnapshot } from '../../src/graph/model.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeGraph(dir: string, snapshot: GraphSnapshot): string {
  const out = join(dir, '.arbiter', 'graph.json')
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8')
  return out
}

function makeBasicSnap(): GraphSnapshot {
  return {
    nodes: [
      {
        id: 'INV-04',
        kind: 'INV',
        attrs: { title: 'No any type', tier: 'architectural', alwaysActive: true },
      },
      {
        id: 'INV-11',
        kind: 'INV',
        attrs: { title: 'No secrets in source', tier: 'security', alwaysActive: false },
      },
      {
        id: 'GATE:no-explicit-any',
        kind: 'GATE',
        attrs: { mechanism: 'no-explicit-any', title: 'no-explicit-any' },
      },
    ],
    edges: [{ from: 'INV-04', to: 'GATE:no-explicit-any', kind: 'enforces', attrs: {} }],
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('agent-rules export (#265)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  function tmpRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'agent-rules-test-'))
    created.push(dir)
    return dir
  }

  // ── AC-1: Export claude target ─────────────────────────────────────────
  it('AC-1: exports --target claude with INV table', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    const opts: AgentRulesExportOptions = { dir, target: 'claude' }
    const result: AgentRulesExportResult = runAgentRulesExport(opts)
    expect(result.status).toBe('ok')
    expect(result.content).toContain('INV-04')
    expect(result.content).toContain('MANDATORY')
  })

  // ── AC-2: Export cursor target ─────────────────────────────────────────
  it('AC-2: exports --target cursor', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    const result = runAgentRulesExport({ dir, target: 'cursor' })
    expect(result.status).toBe('ok')
    expect(result.content).toContain('INV-04')
  })

  // ── AC-3: Export copilot target ────────────────────────────────────────
  it('AC-3: exports --target copilot', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    const result = runAgentRulesExport({ dir, target: 'copilot' })
    expect(result.status).toBe('ok')
    expect(result.content).toContain('INV-04')
  })

  // ── AC-4: Export aider target ──────────────────────────────────────────
  it('AC-4: exports --target aider', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    const result = runAgentRulesExport({ dir, target: 'aider' })
    expect(result.status).toBe('ok')
    expect(result.content).toContain('INV-04')
  })

  // ── AC-5: Export windsurf target ───────────────────────────────────────
  it('AC-5: exports --target windsurf', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    const result = runAgentRulesExport({ dir, target: 'windsurf' })
    expect(result.status).toBe('ok')
    expect(result.content).toContain('INV-04')
  })

  // ── AC-6: Severity mapping — hard-stop for architectural tier ──────────
  it('AC-6: hard-stop INVs (architectural tier) appear as MANDATORY in output', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    const result = runAgentRulesExport({ dir, target: 'claude' })
    expect(result.status).toBe('ok')
    expect(result.content).toContain('MANDATORY')
  })

  // ── AC-7: Fallback to INV catalog when no graph exists ─────────────────
  it('AC-7: falls back to INV catalog when no graph.json exists', () => {
    const dir = tmpRepo()
    // No graph written

    const result = runAgentRulesExport({ dir, target: 'claude' })
    expect(result.status).toBe('ok')
    // Should contain catalog INVs
    expect(result.content.length).toBeGreaterThan(100)
    expect(result.fallbackUsed).toBe(true)
  })

  // ── AC-8: --all emits all targets ─────────────────────────────────────
  it('AC-8: --all writes all target files to their standard paths', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    const result = runAgentRulesExport({ dir, all: true })
    expect(result.status).toBe('ok')
    expect(result.filesWritten).toBeDefined()
    const paths = result.filesWritten ?? []
    // Should have written at least claude and cursor targets
    expect(paths.some((p) => p.includes('AGENT_RULES.md'))).toBe(true)
    expect(paths.some((p) => p.includes('.cursorrules'))).toBe(true)
  })

  // ── AC-9: Intermediate JSON has correct structure ─────────────────────
  it('AC-9: intermediate format has schemaVersion and invariants array', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    const result = runAgentRulesExport({ dir, target: 'claude' })
    expect(result.intermediate).toBeDefined()
    expect(result.intermediate?.schemaVersion).toBe('1.0')
    expect(Array.isArray(result.intermediate?.invariants)).toBe(true)
    expect(result.intermediate?.invariants.length).toBeGreaterThan(0)
  })

  // ── AC-10: Invalid target returns error ────────────────────────────────
  it('AC-10: unknown target returns error status', () => {
    const dir = tmpRepo()
    const result = runAgentRulesExport({ dir, target: 'unknown-tool' as never })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/unknown target/)
  })
})

describe('agent-rules verify (#265)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  function tmpRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ar-verify-test-'))
    created.push(dir)
    return dir
  }

  // ── Verify: no drift when file matches export ──────────────────────────
  it('verify: passes when exported file matches current graph', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    // First export to the standard path
    const exportResult = runAgentRulesExport({ dir, target: 'claude' })
    expect(exportResult.status).toBe('ok')
    // Write the content to the expected output path
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, 'AGENT_RULES.md'), exportResult.content, 'utf-8')

    // Now verify
    const verifyResult: AgentRulesVerifyResult = runAgentRulesVerify({ dir, target: 'claude' })
    expect(verifyResult.status).toBe('ok')
    expect(verifyResult.exitCode).toBe(0)
    expect(verifyResult.drift).toBe(false)
  })

  // ── Verify: detects drift when file differs ────────────────────────────
  it('verify: detects drift when file content is stale', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    // Write stale content (different from what export would produce)
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, 'AGENT_RULES.md'), '# Stale content\n', 'utf-8')

    const verifyResult = runAgentRulesVerify({ dir, target: 'claude' })
    expect(verifyResult.status).toBe('error')
    expect(verifyResult.exitCode).toBe(1)
    expect(verifyResult.drift).toBe(true)
  })

  // ── Verify: passes when file is missing (no drift, no file = not exported yet)
  it('verify: passes when no target file exists (not yet exported)', () => {
    const dir = tmpRepo()
    writeGraph(dir, makeBasicSnap())

    // No file at the expected path
    const verifyResult = runAgentRulesVerify({ dir, target: 'claude' })
    // Missing file = not yet exported, status ok with missing note
    expect(verifyResult.exitCode).toBe(0)
    expect(verifyResult.missing).toBe(true)
  })
})

describe('severityFromTier', () => {
  it('maps architectural/security/governance to hard-stop', () => {
    expect(severityFromTier('architectural')).toBe('hard-stop')
    expect(severityFromTier('security')).toBe('hard-stop')
    expect(severityFromTier('governance')).toBe('hard-stop')
  })

  it('maps data/operational/unknown to advisory', () => {
    expect(severityFromTier('data')).toBe('advisory')
    expect(severityFromTier('operational')).toBe('advisory')
    expect(severityFromTier(undefined)).toBe('advisory')
    expect(severityFromTier('other')).toBe('advisory')
  })
})
