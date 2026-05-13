import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_PERSONAS,
  buildAgentPrompts,
  dispatchAgents,
  aggregateFindings,
  type AgentResult,
  type DispatchFn,
  type Finding,
} from '../../src/review/multi-agent.js'

function withTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-multi-agent-'))
  writeFileSync(join(dir, 'AGENTS.md'), '# Test AGENTS.md\n')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const DIFF_SAMPLE = `diff --git a/src/foo.ts b/src/foo.ts
@@ -1 +1 @@
-export const x = 1;
+export const x = 2;
`

describe('buildAgentPrompts (#236)', () => {
  let env: ReturnType<typeof withTempDir>
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  it('returns 3 prompts for XS tier', () => {
    const prompts = buildAgentPrompts({
      diff: DIFF_SAMPLE,
      dir: env.dir,
      tier: 'XS',
    })
    expect(prompts).toHaveLength(3)
  })

  it('returns 3 prompts for S tier', () => {
    const prompts = buildAgentPrompts({
      diff: DIFF_SAMPLE,
      dir: env.dir,
      tier: 'S',
    })
    expect(prompts).toHaveLength(3)
  })

  it('returns 5 prompts for Standard tier including test-analyzer and type-safety', () => {
    const prompts = buildAgentPrompts({
      diff: DIFF_SAMPLE,
      dir: env.dir,
      tier: 'Standard',
    })
    expect(prompts).toHaveLength(5)
    const names = prompts.map((p) => p.name)
    expect(names).toContain('test-analyzer')
    expect(names).toContain('type-safety')
  })

  it('XS/S tiers exclude test-analyzer', () => {
    const xs = buildAgentPrompts({
      diff: DIFF_SAMPLE,
      dir: env.dir,
      tier: 'XS',
    })
    const s = buildAgentPrompts({ diff: DIFF_SAMPLE, dir: env.dir, tier: 'S' })
    expect(xs.map((p) => p.name)).not.toContain('test-analyzer')
    expect(s.map((p) => p.name)).not.toContain('test-analyzer')
  })

  it('each prompt embeds tier, diff, and SSOT digest', () => {
    const prompts = buildAgentPrompts({
      diff: DIFF_SAMPLE,
      dir: env.dir,
      tier: 'Standard',
    })
    for (const p of prompts) {
      expect(p.prompt).toContain('<reviewAgent')
      expect(p.prompt).toContain('Standard')
      expect(p.prompt).toMatch(/<ssotDigest>[0-9a-f]{64}<\/ssotDigest>/)
      expect(p.prompt).toContain('export const x = 2')
    }
  })

  it('Standard tier is a superset of S — includes every S persona plus domain-consistency and test-analyzer', () => {
    const prompts = buildAgentPrompts({
      diff: DIFF_SAMPLE,
      dir: env.dir,
      tier: 'Standard',
    })
    const names = prompts.map((p) => p.name).sort()
    expect(names).toEqual(
      [
        'bugs',
        'domain-consistency',
        'silent-failure-hunter',
        'test-analyzer',
        'type-safety',
      ].sort(),
    )
  })

  it('Standard tier strictly contains the S-tier persona set (superset invariant)', () => {
    const s = new Set(
      buildAgentPrompts({ diff: DIFF_SAMPLE, dir: env.dir, tier: 'S' }).map((p) => p.name),
    )
    const standard = new Set(
      buildAgentPrompts({
        diff: DIFF_SAMPLE,
        dir: env.dir,
        tier: 'Standard',
      }).map((p) => p.name),
    )
    for (const name of s) expect(standard.has(name)).toBe(true)
  })

  it('registry exposes all five personas', () => {
    const names = AGENT_PERSONAS.map((p) => p.name)
    expect(names).toContain('bugs')
    expect(names).toContain('type-safety')
    expect(names).toContain('domain-consistency')
    expect(names).toContain('silent-failure-hunter')
    expect(names).toContain('test-analyzer')
  })
})

describe('dispatchAgents (#236)', () => {
  let env: ReturnType<typeof withTempDir>
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  it('invokes dispatcher once per prompt in parallel', async () => {
    const calls: string[] = []
    const fakeDispatch: DispatchFn = async (prompt: string, agentName: string) => {
      calls.push(agentName)
      return {
        agent: agentName,
        findings: [],
        passed: true,
        rawStdout: `{"findings":[],"passed":true}`,
        prompt,
      }
    }
    const prompts = buildAgentPrompts({
      diff: DIFF_SAMPLE,
      dir: env.dir,
      tier: 'Standard',
    })
    const results = await dispatchAgents(prompts, { dispatch: fakeDispatch })
    expect(results).toHaveLength(5)
    expect(calls.sort()).toEqual(
      [
        'bugs',
        'domain-consistency',
        'silent-failure-hunter',
        'test-analyzer',
        'type-safety',
      ].sort(),
    )
  })

  it('dispatches in parallel (all started before first resolves)', async () => {
    let started = 0
    let maxConcurrent = 0
    const fakeDispatch: DispatchFn = async (prompt, agentName) => {
      started++
      maxConcurrent = Math.max(maxConcurrent, started)
      await new Promise((r) => setTimeout(r, 10))
      started--
      return {
        agent: agentName,
        findings: [],
        passed: true,
        rawStdout: '{}',
        prompt,
      }
    }
    const prompts = buildAgentPrompts({
      diff: DIFF_SAMPLE,
      dir: env.dir,
      tier: 'Standard',
    })
    await dispatchAgents(prompts, { dispatch: fakeDispatch })
    expect(maxConcurrent).toBe(5)
  })

  it('dispatcher errors surface as blocker findings (no silent failure)', async () => {
    const fakeDispatch: DispatchFn = async (_prompt, agentName) => {
      if (agentName === 'bugs') {
        throw new Error('dispatch boom')
      }
      return {
        agent: agentName,
        findings: [],
        passed: true,
        rawStdout: '{}',
        prompt: _prompt,
      }
    }
    const prompts = buildAgentPrompts({
      diff: DIFF_SAMPLE,
      dir: env.dir,
      tier: 'S',
    })
    const results = await dispatchAgents(prompts, { dispatch: fakeDispatch })
    const bugs = results.find((r) => r.agent === 'bugs')
    expect(bugs).toBeDefined()
    if (!bugs) throw new Error('unreachable')
    expect(bugs.findings.some((f) => f.severity === 'blocker')).toBe(true)
    expect(bugs.passed).toBe(false)
  })
})

describe('aggregateFindings (#236)', () => {
  function mkResult(agent: string, findings: Finding[]): AgentResult {
    return {
      agent,
      findings,
      passed: findings.length === 0,
      rawStdout: '{}',
      prompt: '',
    }
  }

  it('buckets by severity', () => {
    const results: AgentResult[] = [
      mkResult('bugs', [{ severity: 'blocker', agent: 'bugs', message: 'null deref' }]),
      mkResult('type-safety', [{ severity: 'warning', agent: 'type-safety', message: 'any leak' }]),
      mkResult('domain-consistency', [
        { severity: 'note', agent: 'domain-consistency', message: 'rename' },
      ]),
    ]
    const agg = aggregateFindings(results)
    expect(agg.blockers).toHaveLength(1)
    expect(agg.warnings).toHaveLength(1)
    expect(agg.notes).toHaveLength(1)
    expect(agg.totalAgents).toBe(3)
    expect(agg.passCount).toBe(0)
  })

  it('counts pass-through agents (no findings) toward passCount', () => {
    const results: AgentResult[] = [
      mkResult('bugs', []),
      mkResult('type-safety', []),
      mkResult('domain-consistency', [
        { severity: 'note', agent: 'domain-consistency', message: 'rename' },
      ]),
    ]
    const agg = aggregateFindings(results)
    expect(agg.passCount).toBe(2)
    expect(agg.totalAgents).toBe(3)
  })

  it('returns empty arrays for empty input', () => {
    const agg = aggregateFindings([])
    expect(agg.blockers).toEqual([])
    expect(agg.warnings).toEqual([])
    expect(agg.notes).toEqual([])
    expect(agg.totalAgents).toBe(0)
    expect(agg.passCount).toBe(0)
  })

  it('preserves agent provenance on findings', () => {
    const results: AgentResult[] = [
      mkResult('bugs', [
        {
          severity: 'blocker',
          agent: 'bugs',
          message: 'x',
          location: 'src/a.ts:10',
        },
      ]),
    ]
    const agg = aggregateFindings(results)
    expect(agg.blockers[0]?.agent).toBe('bugs')
    expect(agg.blockers[0]?.location).toBe('src/a.ts:10')
  })
})
