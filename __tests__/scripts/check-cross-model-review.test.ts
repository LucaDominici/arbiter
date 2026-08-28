// SPDX-License-Identifier: Apache-2.0
// #2358 — dispatch artifact schema and advisory gate.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = process.cwd()
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-cross-model-review.mjs')
const SCHEMA = join(REPO_ROOT, 'schemas', 'cross-model-dispatch.schema.json')
const AGENT_SCHEMA = join(REPO_ROOT, 'schemas', 'agent-return.schema.json')

const CROSS_MODEL_SCHEMA = {
  type: 'object',
  required: [
    'schema',
    'taskId',
    'branch',
    'sha',
    'ts',
    'phase',
    'requested',
    'fulfilled',
    'degraded',
  ],
  properties: {
    schema: { const: 'arbiter-cross-model-dispatch-v1' },
    taskId: { type: 'string', minLength: 1 },
    branch: { type: 'string', minLength: 1 },
    sha: { type: 'string', minLength: 1 },
    ts: { type: 'string', format: 'date-time' },
    phase: { enum: ['preflight', 'plan', 'red', 'green', 'refactor', 'verification', 'complete'] },
    requested: {
      type: 'array',
      items: {
        type: 'object',
        required: ['provider', 'vertical'],
        properties: {
          provider: { const: 'codex' },
          vertical: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    fulfilled: {
      type: 'array',
      items: {
        type: 'object',
        required: ['provider', 'cliVersion', 'envelope'],
        properties: {
          provider: { const: 'codex' },
          cliVersion: { type: 'string', minLength: 1 },
          envelope: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    degraded: {
      type: 'array',
      items: {
        type: 'object',
        required: ['provider', 'vertical', 'substitute', 'reason', 'detail'],
        properties: {
          provider: { const: 'codex' },
          vertical: { type: 'string', minLength: 1 },
          substitute: { const: 'anthropic' },
          reason: {
            enum: [
              'cli-not-found',
              'not-authenticated',
              'consent-absent',
              'disabled-by-env',
              'timeout',
              'nonzero-exit',
              'coercion-failed',
              'envelope-rejected',
              'diff-truncated',
            ],
          },
          detail: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
}

let root: string

function json(path: string, value: unknown): void {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`)
}

function dispatch(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'arbiter-cross-model-dispatch-v1',
    taskId: '#2358',
    branch: 'task/#2358-cross-model-degradation-evidence',
    sha: 'deadbeef',
    ts: '2026-08-28T12:00:00.000Z',
    phase: 'refactor',
    requested: [{ provider: 'codex', vertical: 'security' }],
    fulfilled: [],
    degraded: [],
    ...overrides,
  }
}

function run(env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  })
}

function writeArtifact(value: unknown): void {
  json('.arbiter/evidence/cross-model/_2358/dispatch.json', value)
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'arbiter-agent-return-v1',
    agent: 'codex-reviewer',
    role: 'reviewer',
    taskId: '#2358',
    branch: 'task/#2358-cross-model-degradation-evidence',
    sha: 'deadbeef',
    ts: '2026-08-28T12:00:00.000Z',
    verdict: 'PASS',
    confidence: 1,
    findings: [],
    refutations: [],
    provenance: {
      vendor: 'openai',
      dispatch: 'external-cli',
      cli: 'codex',
      cliVersion: '0.5.1',
    },
    ...overrides,
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cross-model-review-gate-'))
  mkdirSync(join(root, 'schemas'), { recursive: true })
  writeFileSync(
    join(root, 'schemas', 'cross-model-dispatch.schema.json'),
    `${JSON.stringify(CROSS_MODEL_SCHEMA, null, 2)}\n`,
  )
  writeFileSync(AGENT_SCHEMA.replace(REPO_ROOT, root), readFileSync(AGENT_SCHEMA))
  json('arbiter.json', { crossModelReview: { enabled: false, onUnavailable: 'degrade' } })
  json('.claude/.task/status.json', { taskId: '#2358' })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-cross-model-review (#2358)', () => {
  it('ships the dispatch schema in the repository', () => {
    expect(readFileSync(SCHEMA, 'utf-8')).toContain('arbiter-cross-model-dispatch-v1')
  })

  it('explicitly skips when cross-model review is disabled', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/skipped: crossModelReview not enabled/i)
  })

  it('parses the environment disable override like the runtime config layer', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    const result = run({ ARBITER_CROSS_MODEL_REVIEW: ' no ' })
    expect(result.status).toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/disabled-by-env/i)
  })

  it('validates evidence when the environment enables the feature', () => {
    json('arbiter.json', {})
    const result = run({ ARBITER_CROSS_MODEL_REVIEW: ' YES ' })
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/dispatch\.json|missing/i)
  })

  it('fails when enabled evidence is missing', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/dispatch\.json|missing/i)
  })

  it('fails an enabled degraded run under onUnavailable=fail', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'fail' } })
    writeArtifact(
      dispatch({
        degraded: [
          {
            provider: 'codex',
            vertical: 'security',
            substitute: 'anthropic',
            reason: 'cli-not-found',
            detail: 'Command not found: codex',
          },
        ],
      }),
    )
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/onUnavailable|degraded/i)
  })

  it('rejects a fulfilled external slot whose envelope is Anthropic provenance', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    json(
      '.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json',
      envelope({ provenance: { vendor: 'anthropic', dispatch: 'external-cli', cli: 'codex' } }),
    )
    writeArtifact(
      dispatch({
        fulfilled: [
          {
            provider: 'codex',
            cliVersion: '0.5.1',
            envelope: '.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json',
          },
        ],
      }),
    )
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/anthropic|vendor/i)
  })

  it('rejects an out-of-enum degradation reason', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    writeArtifact(
      dispatch({
        degraded: [
          {
            provider: 'codex',
            vertical: 'security',
            substitute: 'anthropic',
            reason: 'unknown-reason',
            detail: 'not allowed',
          },
        ],
      }),
    )
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/reason|enum|schema/i)
  })

  it('passes a fulfilled non-Anthropic dispatch with a closed reason when present', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    json('.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json', envelope())
    writeArtifact(
      dispatch({
        fulfilled: [
          {
            provider: 'codex',
            cliVersion: '0.5.1',
            envelope: '.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json',
          },
        ],
        degraded: [
          {
            provider: 'codex',
            vertical: 'bugs',
            substitute: 'anthropic',
            reason: 'diff-truncated',
            detail: 'diff exceeded 512 KiB',
          },
        ],
      }),
    )
    const result = run()
    expect(result.status).toBe(0)
  })

  it('rejects a fulfilled slot whose provenance is not the Codex provider', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    json(
      '.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json',
      envelope({ provenance: { vendor: 'google', dispatch: 'external-cli', cli: 'codex' } }),
    )
    writeArtifact(
      dispatch({
        fulfilled: [
          {
            provider: 'codex',
            cliVersion: '0.5.1',
            envelope: '.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json',
          },
        ],
      }),
    )
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/openai|codex|provenance/i)
  })

  it('rejects a fulfilled envelope outside the agent-return evidence directory', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    json('.arbiter/evidence/arbitrary.json', envelope())
    writeArtifact(
      dispatch({
        fulfilled: [
          {
            provider: 'codex',
            cliVersion: '0.5.1',
            envelope: '.arbiter/evidence/arbitrary.json',
          },
        ],
      }),
    )
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/agent-returns|path|directory/i)
  })

  it('rejects a fulfilled file that is not a valid agent-return envelope', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    json('.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json', {
      provenance: { vendor: 'openai', dispatch: 'external-cli', cli: 'codex' },
    })
    writeArtifact(
      dispatch({
        fulfilled: [
          {
            provider: 'codex',
            cliVersion: '0.5.1',
            envelope: '.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json',
          },
        ],
      }),
    )
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/envelope|schema|required/i)
  })

  it('rejects a requested external slot with no fulfilled or degraded outcome', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    writeArtifact(dispatch())
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/requested|fulfilled|degraded|outcome/i)
  })
})
