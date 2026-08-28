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

function run() {
  return spawnSync(process.execPath, [SCRIPT, '--root', root], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  })
}

function writeArtifact(value: unknown): void {
  json('.arbiter/evidence/cross-model/_2358/dispatch.json', value)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cross-model-review-gate-'))
  mkdirSync(join(root, 'schemas'), { recursive: true })
  writeFileSync(
    join(root, 'schemas', 'cross-model-dispatch.schema.json'),
    `${JSON.stringify(CROSS_MODEL_SCHEMA, null, 2)}\n`,
  )
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
    json('.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json', {
      provenance: { vendor: 'anthropic' },
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
    json('.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json', {
      provenance: { vendor: 'openai' },
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
})
