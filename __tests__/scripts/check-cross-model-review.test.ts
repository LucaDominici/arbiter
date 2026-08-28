// SPDX-License-Identifier: Apache-2.0
// #2358 — dispatch artifact schema and advisory gate.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

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
      maxItems: 1,
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
      maxItems: 1,
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
      maxItems: 1,
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
              'diff-collection-failed',
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

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim()
}

function json(path: string, value: unknown): void {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`)
  if (existsSync(join(root, '.git')) && !path.startsWith('.arbiter/')) {
    commitFixtureChanges(path)
  }
}

function commitFixtureChanges(path: string): void {
  execFileSync('git', ['add', '--', path], { cwd: root, stdio: 'ignore' })
  const staged = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: root,
    stdio: 'ignore',
  })
  if (staged.status !== 1) return
  execFileSync('git', ['commit', '-q', '-m', 'fixture update', '--no-gpg-sign'], {
    cwd: root,
    stdio: 'ignore',
  })
}

function dispatch(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'arbiter-cross-model-dispatch-v1',
    taskId: '#2358',
    branch: git(['branch', '--show-current']),
    sha: git(['rev-parse', 'HEAD']),
    ts: '2026-08-28T12:00:00.000Z',
    phase: 'refactor',
    requested: [{ provider: 'codex', vertical: 'security' }],
    fulfilled: [],
    degraded: [],
    ...overrides,
  }
}

function run(env: Record<string, string> = {}, args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], {
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
    branch: git(['branch', '--show-current']),
    sha: git(['rev-parse', 'HEAD']),
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
  execFileSync('git', ['init', '-q', '-b', 'task/#2358-cross-model-degradation-evidence'], {
    cwd: root,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'test-user'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['commit', '-q', '-m', 'fixture', '--no-gpg-sign'], {
    cwd: root,
    stdio: 'ignore',
  })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-cross-model-review (#2358)', () => {
  it('ships the dispatch schema in the repository', () => {
    expect(readFileSync(SCHEMA, 'utf-8')).toContain('arbiter-cross-model-dispatch-v1')
  })

  it('uses descriptor-relative no-follow reads for evidence', () => {
    const source = readFileSync(SCRIPT, 'utf-8')
    expect(source).toContain('O_NOFOLLOW')
    expect(source).toContain('readFileContained')
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

  it('does not treat an invalid enabled flag as a degraded skip', () => {
    json('arbiter.json', { crossModelReview: { enabled: 'false', onUnavailable: 'degrade' } })
    const result = run({}, ['--require-degraded'])
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/enabled must be boolean/i)
  })

  it('rejects an invalid unavailable policy before checking evidence', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'ignore' } })
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/onUnavailable must be degrade or fail/i)
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

  it('accepts a valid degradation when degradation is explicitly required', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
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

    const result = run({}, ['--require-degraded'])
    expect(result.status).toBe(0)
  })

  it('rejects a symlinked configuration file', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    const outside = join(root, 'outside-arbiter.json')
    writeFileSync(outside, JSON.stringify({ crossModelReview: { enabled: false } }))
    rmSync(join(root, 'arbiter.json'))
    symlinkSync(outside, join(root, 'arbiter.json'))

    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/symlink|configuration/i)
  })

  it('rejects a symlinked task state file', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    const statusPath = join(root, '.claude', '.task', 'status.json')
    const outside = join(root, 'outside-status.json')
    writeFileSync(outside, JSON.stringify({ taskId: '#2358' }))
    rmSync(statusPath)
    symlinkSync(outside, statusPath)

    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/symlink|task state/i)
  })

  it('rejects an empty dispatch when a fulfilled seat is required', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    writeArtifact(dispatch({ requested: [] }))
    const result = run({}, ['--require-fulfilled'])
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/require-fulfilled|fulfilled|seat/i)
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

  it('rejects fulfilled evidence when current diff consent is absent', () => {
    json('arbiter.json', {
      crossModelReview: { enabled: true, diffEgressConsent: false, onUnavailable: 'degrade' },
    })
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
      }),
    )
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/consent|egress|fulfilled/i)
  })

  it('rejects a fulfilled envelope whose agent is not Codex', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    json(
      '.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json',
      envelope({ agent: 'attacker' }),
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
    expect(`${result.stdout}${result.stderr}`).toMatch(/agent|codex/i)
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

  it('rejects fulfilled and degraded outcomes that exceed the requested slots', () => {
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
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/outcome|requested|slot/i)
  })

  it('rejects evidence that requests more than the single external seat', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    writeArtifact(
      dispatch({
        requested: [
          { provider: 'codex', vertical: 'security' },
          { provider: 'codex', vertical: 'bugs' },
        ],
        degraded: [
          {
            provider: 'codex',
            vertical: 'security',
            substitute: 'anthropic',
            reason: 'cli-not-found',
            detail: 'Command not found: codex',
          },
          {
            provider: 'codex',
            vertical: 'bugs',
            substitute: 'anthropic',
            reason: 'cli-not-found',
            detail: 'Command not found: codex',
          },
        ],
      }),
    )
    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /one external seat|cardinality|maxItems|requested/i,
    )
  })

  it('rejects dispatch evidence stamped for another branch', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    writeArtifact(
      dispatch({
        branch: 'task/#9999-other-branch',
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
    expect(`${result.stdout}${result.stderr}`).toMatch(/branch|current/i)
  })

  it('rejects dispatch evidence whose SHA is not in the current history', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    writeArtifact(
      dispatch({
        sha: 'deadbeef',
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
    expect(`${result.stdout}${result.stderr}`).toMatch(/sha|ancestor|history/i)
  })

  it('rejects dispatch evidence stamped to an ancestor of the current HEAD', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    const ancestor = git(['rev-parse', 'HEAD'])
    execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'advance', '--no-gpg-sign'], {
      cwd: root,
      stdio: 'ignore',
    })
    writeArtifact(
      dispatch({
        sha: ancestor,
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
    expect(`${result.stdout}${result.stderr}`).toMatch(/current HEAD|match/i)
  })

  it('rejects dispatch evidence when tracked changes are staged after dispatch', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    writeFileSync(join(root, 'tracked.txt'), 'before\n')
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root })
    execFileSync('git', ['commit', '-q', '-m', 'tracked fixture', '--no-gpg-sign'], { cwd: root })
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
    writeFileSync(join(root, 'tracked.txt'), 'after\n')
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root })

    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/unreviewed|changes|checkout/i)
  })

  it('rejects a fulfilled envelope whose filename is not canonical', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    json('.arbiter/evidence/agent-returns/_2358/evil-name.json', envelope())
    writeArtifact(
      dispatch({
        fulfilled: [
          {
            provider: 'codex',
            cliVersion: '0.5.1',
            envelope: '.arbiter/evidence/agent-returns/_2358/evil-name.json',
          },
        ],
      }),
    )

    const result = run()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/canonical|filename|agent-return/i)
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

  it('rejects a fulfilled envelope stamped for another branch or SHA', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    json(
      '.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json',
      envelope({ sha: 'deadbeef' }),
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
    expect(`${result.stdout}${result.stderr}`).toMatch(/envelope|sha|current HEAD|match/i)
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

  it('rejects a fulfilled envelope symlink that resolves outside the repository', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    const outside = mkdtempSync(join(tmpdir(), 'cross-model-review-outside-'))
    const outsideEnvelope = join(outside, 'envelope.json')
    writeFileSync(outsideEnvelope, `${JSON.stringify(envelope(), null, 2)}\n`)
    mkdirSync(join(root, '.arbiter/evidence/agent-returns/_2358'), { recursive: true })
    const linkedEnvelope = join(root, '.arbiter/evidence/agent-returns/_2358/codex-reviewer-0.json')
    symlinkSync(outsideEnvelope, linkedEnvelope)
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
    rmSync(outside, { recursive: true, force: true })
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toMatch(/escapes|symlink|repository|agent-returns/i)
  })

  it('rejects degraded dispatch evidence reached through an external symlink', () => {
    json('arbiter.json', { crossModelReview: { enabled: true, onUnavailable: 'degrade' } })
    const outside = mkdtempSync(join(tmpdir(), 'cross-model-review-dispatch-outside-'))
    try {
      mkdirSync(join(outside, '_2358'), { recursive: true })
      writeFileSync(
        join(outside, '_2358', 'dispatch.json'),
        `${JSON.stringify(
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
          null,
          2,
        )}\n`,
      )
      mkdirSync(join(root, '.arbiter', 'evidence'), { recursive: true })
      symlinkSync(outside, join(root, '.arbiter', 'evidence', 'cross-model'), 'dir')

      const result = run()
      expect(result.status).toBe(1)
      expect(`${result.stdout}${result.stderr}`).toMatch(/symlink|repository|dispatch/i)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
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

  it.each([
    ['empty', [], 0],
    ['duplicate', ['codex-reviewer', 'codex-reviewer'], 2],
    ['non-string', [42], 1],
    ['without Codex', ['independent-review'], 1],
  ])('rejects a %s recorded reviewer panel', (_label, agents, count) => {
    json('arbiter.json', {
      crossModelReview: { enabled: true, diffEgressConsent: true, onUnavailable: 'degrade' },
    })
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
      }),
    )

    const result = run({}, [
      '--require-fulfilled',
      '--record-panel',
      JSON.stringify(agents),
      '--record-count',
      String(count),
    ])
    expect(result.status).toBe(2)
    expect(`${result.stdout}${result.stderr}`).toMatch(/reviewer panel/i)
  })
})
