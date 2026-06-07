// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-workflow-parallelism.mjs')

type RunResult = { status: number; stdout: string; stderr: string }

function run(dir: string, extraEnv?: Record<string, string>): RunResult {
  const r = spawnSync('node', [SCRIPT, '--dir', dir], {
    encoding: 'utf-8',
    env: { ...process.env, ...extraEnv },
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'parallelism-check-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeWorkflow(workflowDir: string, filename: string, content: string): void {
  mkdirSync(workflowDir, { recursive: true })
  writeFileSync(join(workflowDir, filename), content)
}

// Simple linear chain: A → B → C → D (3 edges)
const CHAIN_3 = `
name: Chain3
jobs:
  job-a:
    runs-on: ubuntu-latest
    steps: [{ run: echo a }]
  job-b:
    runs-on: ubuntu-latest
    needs: [job-a]
    steps: [{ run: echo b }]
  job-c:
    runs-on: ubuntu-latest
    needs: [job-b]
    steps: [{ run: echo c }]
  job-d:
    runs-on: ubuntu-latest
    needs: [job-c]
    steps: [{ run: echo d }]
`.trim()

// Linear chain: A → B → C → D → E (4 edges — violates default ≤3)
const CHAIN_4 = `
name: Chain4
jobs:
  job-a:
    runs-on: ubuntu-latest
    steps: [{ run: echo a }]
  job-b:
    runs-on: ubuntu-latest
    needs: [job-a]
    steps: [{ run: echo b }]
  job-c:
    runs-on: ubuntu-latest
    needs: [job-b]
    steps: [{ run: echo c }]
  job-d:
    runs-on: ubuntu-latest
    needs: [job-c]
    steps: [{ run: echo d }]
  job-e:
    runs-on: ubuntu-latest
    needs: [job-d]
    steps: [{ run: echo e }]
`.trim()

// Parallel structure — multiple root → one gate → many parallel = chain 1
const PARALLEL_GOOD = `
name: ParallelGood
jobs:
  gate:
    runs-on: ubuntu-latest
    steps: [{ run: echo gate }]
  unit-tests:
    runs-on: ubuntu-latest
    needs: [gate]
    steps: [{ run: echo unit }]
  integration-tests:
    runs-on: ubuntu-latest
    needs: [gate]
    steps: [{ run: echo integration }]
  contract-tests:
    runs-on: ubuntu-latest
    needs: [gate]
    steps: [{ run: echo contract }]
`.trim()

// Aggregator sink pattern: if: always() with many needs → excluded from chain
const WITH_AGGREGATOR_SINK = `
name: WithSink
jobs:
  job-a:
    runs-on: ubuntu-latest
    steps: [{ run: echo a }]
  job-b:
    runs-on: ubuntu-latest
    needs: [job-a]
    steps: [{ run: echo b }]
  job-c:
    runs-on: ubuntu-latest
    needs: [job-b]
    steps: [{ run: echo c }]
  job-d:
    runs-on: ubuntu-latest
    needs: [job-c]
    steps: [{ run: echo d }]
  ci-required:
    runs-on: ubuntu-latest
    needs: [job-a, job-b, job-c, job-d]
    if: always()
    steps: [{ run: echo done }]
`.trim()

describe('check-workflow-parallelism.mjs (INV-120 needs-chain regression gate)', () => {
  it('exits 0 when workflows directory does not exist', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 0 for empty workflows directory', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      mkdirSync(workflowDir, { recursive: true })
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 0 for parallel fan-out from single gate (chain=1)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      writeWorkflow(workflowDir, 'parallel.yml', PARALLEL_GOOD)
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 0 for chain of 3 edges (at default limit)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      writeWorkflow(workflowDir, 'chain3.yml', CHAIN_3)
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 1 for chain of 4 edges (exceeds default limit of 3)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      writeWorkflow(workflowDir, 'chain4.yml', CHAIN_4)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('FAIL')
      expect(result.stdout).toContain('chain4.yml')
    } finally {
      cleanup()
    }
  })

  it('reports the violation chain in job1 → job2 → ... format', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      writeWorkflow(workflowDir, 'chain4.yml', CHAIN_4)
      const result = run(dir)
      expect(result.status).toBe(1)
      // Should contain arrow-separated chain representation
      expect(result.stdout).toMatch(/job-[a-e] → job-[a-e]/)
    } finally {
      cleanup()
    }
  })

  it('excludes if:always() aggregator sinks from chain calculation', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      // 3-edge chain + ci-required if:always() sink — should pass (chain=3, not 4)
      writeWorkflow(workflowDir, 'with-sink.yml', WITH_AGGREGATOR_SINK)
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('respects ARBITER_MAX_NEEDS_CHAIN env override — allows chain=4 when limit=4', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      writeWorkflow(workflowDir, 'chain4.yml', CHAIN_4)
      const result = run(dir, { ARBITER_MAX_NEEDS_CHAIN: '4' })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('respects ARBITER_MAX_NEEDS_CHAIN=2 — rejects chain=3', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      writeWorkflow(workflowDir, 'chain3.yml', CHAIN_3)
      const result = run(dir, { ARBITER_MAX_NEEDS_CHAIN: '2' })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('applies per-workflow override: 01-pr-fast allows chain≤3', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      // chain3 in 01-pr-fast.yml should pass with the default override of ≤3
      writeWorkflow(workflowDir, '01-pr-fast.yml', CHAIN_3)
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('applies per-workflow override: nightly allows chain≤5', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      // Build a chain of 5 edges in nightly file — should pass
      const chain5Nightly = `
name: Nightly
jobs:
  a: { runs-on: ubuntu-latest, steps: [{ run: echo a }] }
  b: { runs-on: ubuntu-latest, needs: [a], steps: [{ run: echo b }] }
  c: { runs-on: ubuntu-latest, needs: [b], steps: [{ run: echo c }] }
  d: { runs-on: ubuntu-latest, needs: [c], steps: [{ run: echo d }] }
  e: { runs-on: ubuntu-latest, needs: [d], steps: [{ run: echo e }] }
  f: { runs-on: ubuntu-latest, needs: [e], steps: [{ run: echo f }] }
`.trim()
      writeWorkflow(workflowDir, '06-nightly.yml', chain5Nightly)
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('applies per-workflow override: nightly chain>5 fails', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      // Chain of 6 edges in nightly — violates nightly override of ≤5
      const chain6Nightly = `
name: Nightly
jobs:
  a: { runs-on: ubuntu-latest, steps: [{ run: echo a }] }
  b: { runs-on: ubuntu-latest, needs: [a], steps: [{ run: echo b }] }
  c: { runs-on: ubuntu-latest, needs: [b], steps: [{ run: echo c }] }
  d: { runs-on: ubuntu-latest, needs: [c], steps: [{ run: echo d }] }
  e: { runs-on: ubuntu-latest, needs: [d], steps: [{ run: echo e }] }
  f: { runs-on: ubuntu-latest, needs: [e], steps: [{ run: echo f }] }
  g: { runs-on: ubuntu-latest, needs: [f], steps: [{ run: echo g }] }
`.trim()
      writeWorkflow(workflowDir, '06-nightly.yml', chain6Nightly)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('scans multiple workflow files and reports all violations', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      writeWorkflow(workflowDir, 'good.yml', PARALLEL_GOOD)
      writeWorkflow(workflowDir, 'bad.yml', CHAIN_4)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('bad.yml')
      expect(result.stdout).not.toContain('good.yml')
    } finally {
      cleanup()
    }
  })

  it('shows --help without error', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage')
    expect(r.stdout).toContain('ARBITER_MAX_NEEDS_CHAIN')
  })

  it('integration: real templates pass (01-pr-fast chain≤3, templates dir)', () => {
    // Run against the actual repo templates directory
    const r = spawnSync('node', [SCRIPT, '--dir', resolve('.')], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('OK')
  })
})
