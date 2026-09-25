// SPDX-License-Identifier: Apache-2.0
// #2905 — the reviewer model/effort come from crossModelReview, are always passed to codex,
// and are stamped into the envelope provenance.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CROSS_MODEL_REVIEW,
  DEFAULT_THRESHOLDS,
  validateConfig,
} from '../../src/config/schema.js'
import { invokeExternalReview } from '../../src/integrations/external-review.js'
import { runCli } from '../../src/utils/run-cli.js'

vi.mock('../../src/utils/run-cli.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/utils/run-cli.js')>()
  return { ...actual, runCli: vi.fn() }
})
vi.mock('../../src/evidence/git-checks.js', () => ({
  currentBranch: vi.fn(() => 'current-branch'),
  headSha: vi.fn(() => 'current-sha'),
}))

const mockedRunCli = vi.mocked(runCli)
const RECORD_SCRIPT = new URL('../../scripts/record-agent-return.mjs', import.meta.url).pathname
const SCHEMA = new URL('../../schemas/agent-return.schema.json', import.meta.url).pathname
const payload = {
  verdict: 'PASS',
  confidence: 0.9,
  findings: [],
  refutations: [],
  acceptanceFit: {
    schema: 'arbiter-ac-fit-v1',
    taskId: '#2905',
    criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'src/a.ts', line: 1 }] }],
  },
}
const BASE_CONFIG = {
  version: '0.2',
  tools: ['claude'],
  governanceLevel: 'L1',
  useGitHub: false,
  features: {
    contractTesting: false,
    mutationTesting: false,
    securityScanning: false,
    evidenceHarness: false,
    debtGates: false,
    suppressions: true,
  },
  thresholds: DEFAULT_THRESHOLDS.L1,
}

function review(extra: Record<string, unknown> = {}): void {
  mockedRunCli.mockImplementation((cmd) =>
    cmd === 'codex'
      ? { stdout: JSON.stringify(payload), stderr: '', exitCode: 0, durationMs: 1 }
      : {
          stdout: '[record-agent-return] OK — wrote x.json',
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        },
  )
  invokeExternalReview({
    repoRoot: process.cwd(),
    taskId: '#2905',
    prompt: 'Review.',
    diff: 'diff --git a/f b/f',
    cfg: {
      ...DEFAULT_CROSS_MODEL_REVIEW,
      enabled: true,
      diffEgressConsent: true,
      ...extra,
    } as never,
    access: {
      provider: 'codex',
      vendor: 'openai',
      available: true,
      authenticated: true,
      version: '1.2.3',
      error: null,
    },
  })
}
/** The value that immediately follows `flag` in the argv of the named command. */
function after(cmd: string, flag: string, value?: string): string | undefined {
  const args = (mockedRunCli.mock.calls.find((c) => c[0] === cmd)?.[1] ?? []) as string[]
  const i = args.findIndex(
    (a, n) => a === flag && (value === undefined || args[n + 1]?.startsWith(value)),
  )
  return i < 0 ? undefined : args[i + 1]
}
const crossModel = (extra: Record<string, unknown>) =>
  validateConfig({ ...BASE_CONFIG, crossModelReview: { ...DEFAULT_CROSS_MODEL_REVIEW, ...extra } })

describe('#2905 external reviewer model and effort', () => {
  beforeEach(() => mockedRunCli.mockReset())

  it('AC-1: defaults to gpt-6-luna at max, passed explicitly', () => {
    review()
    expect(after('codex', '-m')).toBe('gpt-6-luna')
    expect(after('codex', '-c', 'model_reasoning_effort=')).toBe('model_reasoning_effort="max"')
  })

  it('AC-1: honours the configured model and effort', () => {
    review({ model: 'gpt-6-sol', effort: 'high' })
    expect(after('codex', '-m')).toBe('gpt-6-sol')
    expect(after('codex', '-c', 'model_reasoning_effort=')).toBe('model_reasoning_effort="high"')
  })

  it('AC-1: config rejects an effort outside the fixed set', () => {
    const result = crossModel({ effort: 'max"; x=1' })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toContain('crossModelReview.effort')
  })

  it('AC-1: config rejects an empty or spaced model', () => {
    for (const model of ['', ' ', 'gpt 6']) {
      const result = crossModel({ model })
      expect(result.ok, model).toBe(false)
      expect(JSON.stringify(result)).toContain('crossModelReview.model')
    }
  })

  it('AC-2: the recorder receives the requested model and effort', () => {
    review({ model: 'gpt-6-sol', effort: 'xhigh' })
    expect(after('node', '--provenance-model')).toBe('gpt-6-sol')
    expect(after('node', '--provenance-effort')).toBe('xhigh')
  })

  it('AC-2: the recorder stamps model and effort into a schema-valid provenance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-2905-'))
    try {
      spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
      spawnSync(
        'git',
        ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'x'],
        { cwd: dir },
      )
      const evidenceDir = join(dir, '.arbiter', 'evidence', 'agent-returns')
      const env = {
        schema: 'arbiter-agent-return-v1',
        agent: 'codex',
        role: 'skeptic',
        taskId: '#2905',
        verdict: 'PASS',
        confidence: 0.8,
        findings: [],
      }
      const run = spawnSync(
        'node',
        [
          RECORD_SCRIPT,
          '--task',
          '#2905',
          '--evidence-dir',
          evidenceDir,
          '--repo-root',
          dir,
          '--provenance-vendor',
          'openai',
          '--provenance-cli',
          'codex',
          '--provenance-dispatch',
          'external-cli',
          '--provenance-model',
          'gpt-6-luna',
          '--provenance-effort',
          'max',
        ],
        { input: JSON.stringify(env), encoding: 'utf-8' },
      )
      expect(run.status, run.stderr).toBe(0)
      const taskDir = join(evidenceDir, '_2905')
      const written = JSON.parse(readFileSync(join(taskDir, readdirSync(taskDir)[0]!), 'utf-8'))
      expect(written.provenance).toMatchObject({ model: 'gpt-6-luna', effort: 'max' })
      const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8'))
      expect(schema.properties.provenance.properties.effort).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
