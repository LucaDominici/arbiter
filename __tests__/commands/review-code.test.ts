import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReviewCode } from '../../src/commands/review.js'
import type { DispatchFn, Finding } from '../../src/review/multi-agent.js'

function withProjectDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-review-code-'))
  writeFileSync(join(dir, 'AGENTS.md'), '# project agents\n')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function noopDispatcher(findingsByAgent: Record<string, Finding[]> = {}): DispatchFn {
  return async (prompt, agentName) => {
    const findings = findingsByAgent[agentName] ?? []
    return {
      agent: agentName,
      findings,
      passed: findings.length === 0,
      rawStdout: JSON.stringify({ findings, passed: findings.length === 0 }),
      prompt,
    }
  }
}

const FIXED_DIFF = 'diff --git a/x b/x\n+a\n'

describe('runReviewCode (#236)', () => {
  let env: ReturnType<typeof withProjectDir>
  beforeEach(() => {
    env = withProjectDir()
  })
  afterEach(() => env.cleanup())

  it('exits 0 when no findings', async () => {
    const result = await runReviewCode({
      dir: env.dir,
      tier: 'S',
      diffOverride: FIXED_DIFF,
      dispatcher: noopDispatcher(),
    })
    expect(result.exitCode).toBe(0)
    expect(result.aggregated.blockers).toHaveLength(0)
    expect(result.aggregated.warnings).toHaveLength(0)
  })

  it('exits 1 when only warnings', async () => {
    const result = await runReviewCode({
      dir: env.dir,
      tier: 'S',
      diffOverride: FIXED_DIFF,
      dispatcher: noopDispatcher({
        bugs: [{ severity: 'warning', agent: 'bugs', message: 'soft issue' }],
      }),
    })
    expect(result.exitCode).toBe(1)
    expect(result.aggregated.warnings).toHaveLength(1)
    expect(result.aggregated.blockers).toHaveLength(0)
  })

  it('exits 2 when any blocker present', async () => {
    const result = await runReviewCode({
      dir: env.dir,
      tier: 'S',
      diffOverride: FIXED_DIFF,
      dispatcher: noopDispatcher({
        bugs: [{ severity: 'blocker', agent: 'bugs', message: 'hard issue' }],
        'domain-consistency': [
          { severity: 'warning', agent: 'domain-consistency', message: 'soft' },
        ],
      }),
    })
    expect(result.exitCode).toBe(2)
    expect(result.aggregated.blockers).toHaveLength(1)
  })

  it('--json emits a well-formed envelope', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      await runReviewCode({
        dir: env.dir,
        tier: 'S',
        diffOverride: FIXED_DIFF,
        json: true,
        dispatcher: noopDispatcher({
          bugs: [{ severity: 'blocker', agent: 'bugs', message: 'x' }],
        }),
      })
      // Find the JSON envelope write call
      const jsonCall = write.mock.calls.find((c) => {
        const v = c[0]
        return typeof v === 'string' && v.includes('"command"')
      })
      expect(jsonCall).toBeDefined()
      const raw = jsonCall?.[0] as string
      const envelope = JSON.parse(raw)
      expect(envelope.command).toBe('review code')
      expect(envelope.version).toBe('1')
      expect(envelope.status).toBe('error')
      expect(envelope.data).toBeDefined()
      expect(envelope.data.exitCode).toBe(2)
      expect(envelope.data.blockers).toHaveLength(1)
    } finally {
      write.mockRestore()
    }
  })

  it('honors custom --evidence-dir and writes agent JSON responses', async () => {
    const evidenceDir = join(env.dir, 'custom-evidence')
    await runReviewCode({
      dir: env.dir,
      tier: 'S',
      diffOverride: FIXED_DIFF,
      evidenceDir,
      dispatcher: noopDispatcher(),
    })
    expect(existsSync(evidenceDir)).toBe(true)
    const files = readdirSync(evidenceDir)
    const agentFiles = files.filter((f) => f.startsWith('agent-') && f.endsWith('.json'))
    expect(agentFiles.length).toBeGreaterThanOrEqual(3)
    // Each file should be valid JSON
    for (const f of agentFiles) {
      const body = readFileSync(join(evidenceDir, f), 'utf-8')
      expect(() => JSON.parse(body)).not.toThrow()
    }
  })

  it('wraps infra failure (resolveDiff) as blocker finding with exit 2 (W-2)', async () => {
    // No diffOverride and no dispatcher → resolveDiff will spawn `git diff`,
    // which fails in our empty tmp env (no git repo). The error must NOT
    // escape as a generic exit 1 — it must surface as a blocker.
    const result = await runReviewCode({
      dir: env.dir,
      tier: 'S',
    })
    expect(result.exitCode).toBe(2)
    expect(result.aggregated.blockers.length).toBeGreaterThan(0)
    expect(result.aggregated.blockers[0]?.agent).toBe('infrastructure')
    expect(result.aggregated.blockers[0]?.message).toMatch(/infra failure/)
  })

  it('Standard tier dispatches 5 agents', async () => {
    const calls: string[] = []
    const result = await runReviewCode({
      dir: env.dir,
      tier: 'Standard',
      diffOverride: FIXED_DIFF,
      dispatcher: async (prompt, agentName) => {
        calls.push(agentName)
        return {
          agent: agentName,
          findings: [],
          passed: true,
          rawStdout: '{}',
          prompt,
        }
      },
    })
    expect(result.aggregated.totalAgents).toBe(5)
    expect(calls).toHaveLength(5)
  })
})
