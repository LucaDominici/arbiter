// SPDX-License-Identifier: Apache-2.0
// #2686: plan/TDD verification must use the project selected by inherited --dir.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_THRESHOLDS } from '../helpers.js'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const PLAN_FIXTURE = resolve(import.meta.dirname, '../fixtures/bridge/approved/PLAN.json')
const TASK = '#90002686'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'arbiter-2686-'))
  roots.push(root)
  return root
}

function run(cwd: string, args: string[]) {
  const env = { ...process.env, NO_COLOR: '1' }
  delete env.E2E_RISK_SKIP
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env,
    encoding: 'utf-8',
    timeout: 45_000,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function placements(command: 'plan' | 'tdd', value: string, dir: string): string[][] {
  return ['validate', 'verify'].flatMap((alias) => [
    [alias, '--dir', dir, command, value, '--json'],
    [alias, command, value, '--dir', dir, '--json'],
  ])
}

function installBlockingPlanPlugin(dir: string): void {
  const plugin = join(dir, 'node_modules', 'block-plan')
  writeJson(join(plugin, 'package.json'), {
    name: 'block-plan',
    version: '1.0.0',
    main: 'index.cjs',
    keywords: ['arbiter-plugin'],
  })
  writeFileSync(
    join(plugin, 'index.cjs'),
    `module.exports = {
      name: 'block-plan',
      apiVersion: '1',
      templateRoot: __dirname,
      generate() { return { files: [] } },
      verifyPlanRules: [{
        id: 'TEST-BLOCK',
        ssotPointer: { path: 'policy.md', anchor: 'TEST-BLOCK' },
        applicability() { return true },
        evaluate() { return [{
          rule_id: 'TEST-BLOCK', severity: 'ERROR', message: 'B target rule executed',
          ssot_pointer: { path: 'policy.md', anchor: 'TEST-BLOCK' }, evidence: { paths: [] }
        }] }
      }]
    }\n`,
  )
  writeJson(join(dir, 'arbiter.json'), {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: true,
      securityScanning: true,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
    },
    thresholds: DEFAULT_THRESHOLDS.L2,
    plugins: ['block-plan'],
  })
}

function createTddFixture(root: string): { valid: string; malformed: string } {
  const valid = join(root, 'valid')
  const malformed = join(root, 'malformed')
  mkdirSync(valid)
  mkdirSync(malformed)
  mkdirSync(join(valid, 'node_modules', 'fixture-dependency'), { recursive: true })
  writeFileSync(
    join(valid, 'node_modules', 'fixture-dependency', 'index.js'),
    'module.exports = 1\n',
  )
  writeFileSync(
    join(valid, 'red.test.cjs'),
    "const test=require('node:test');const assert=require('node:assert/strict');const actual=require('fixture-dependency');test('RED one',()=>assert.equal(actual,2));test('RED two',()=>assert.equal(actual,3));\n",
  )
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Arbiter fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Arbiter fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  }
  for (const args of [
    ['init', '-q'],
    ['add', 'red.test.cjs'],
    ['commit', '-qm', 'Fixture RED test'],
  ]) {
    expect(spawnSync('git', args, { cwd: valid, env: gitEnv }).status).toBe(0)
  }
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: valid,
    env: gitEnv,
    encoding: 'utf-8',
  }).stdout.trim()
  const testCommand = [process.execPath, '--test', '--test-reporter=tap', 'red.test.cjs']
  const red = spawnSync(testCommand[0], testCommand.slice(1), {
    cwd: valid,
    encoding: 'utf-8',
  })
  expect(red.status).toBe(1)
  expect(red.stdout).toMatch(/^# fail 2$/m)
  writeJson(join(valid, '.arbiter', 'evidence', 'tdd', `${TASK}.json`), {
    $schemaVersion: 1,
    task_id: TASK,
    test_path: 'red.test.cjs',
    test_commit_sha: sha,
    test_run_log: red.stdout,
    observed_failure: '# fail 2',
    recorded_at: new Date().toISOString(),
    test_command: testCommand,
  })
  const malformedPath = join(malformed, '.arbiter', 'evidence', 'tdd', `${TASK}.json`)
  mkdirSync(dirname(malformedPath), { recursive: true })
  writeFileSync(malformedPath, '{ malformed')
  return { valid, malformed }
}

describe('verify plan/TDD honors the selected --dir (#2686)', () => {
  it('loads target B plan rules and persists review in B for both aliases and positions (AC-1, AC-4)', () => {
    const root = fixtureRoot()
    const cwd = join(root, 'A')
    const target = join(root, 'B')
    mkdirSync(cwd)
    mkdirSync(target)
    installBlockingPlanPlugin(target)
    const plan = join(root, 'PLAN.json')
    writeFileSync(plan, readFileSync(PLAN_FIXTURE))

    for (const args of placements('plan', plan, target)) {
      const result = run(cwd, args)
      const output = JSON.parse(result.stdout) as {
        status: string
        data: { status: string; reviewPath: string }
      }
      expect(result.status, args.join(' ')).toBe(2)
      expect(output.status).toBe('error')
      expect(output.data.status).toBe('REJECTED')
      expect(output.data.reviewPath).toBe(join(target, '.arbiter', 'plan', 'REVIEW.json'))
      expect(readFileSync(output.data.reviewPath, 'utf-8')).toContain('B target rule executed')
      expect(existsSync(join(cwd, '.arbiter', 'plan', 'REVIEW.json'))).toBe(false)
    }
  }, 60_000)

  it('keeps plan file and review rooted in cwd without --dir (AC-3)', () => {
    const root = fixtureRoot()
    const cwd = join(root, 'A')
    mkdirSync(cwd)
    const plan = join(root, 'PLAN.json')
    writeFileSync(plan, readFileSync(PLAN_FIXTURE))
    const result = run(cwd, ['verify', 'plan', plan, '--json'])
    const output = JSON.parse(result.stdout) as { data: { status: string; reviewPath: string } }
    expect(result.status).toBe(0)
    expect(output.data.status).toBe('APPROVED')
    expect(output.data.reviewPath).toBe(join(cwd, '.arbiter', 'plan', 'REVIEW.json'))
  })

  it('uses target B for both TDD inversion directions, aliases and positions (AC-2, AC-4)', () => {
    const { valid, malformed } = createTddFixture(fixtureRoot())
    for (const args of placements('tdd', TASK, malformed)) {
      const result = run(valid, args)
      const output = JSON.parse(result.stdout) as { status: string; data: { exitCode: number } }
      expect(result.status, args.join(' ')).toBe(1)
      expect(output.status).toBe('error')
      expect(output.data.exitCode).toBe(1)
    }
    for (const args of placements('tdd', TASK, valid)) {
      const result = run(malformed, args)
      const output = JSON.parse(result.stdout) as {
        status: string
        data: { exitCode: number; checks: unknown[] }
      }
      expect(result.status, args.join(' ')).toBe(0)
      expect(output.status).toBe('ok')
      expect(output.data.exitCode).toBe(0)
      expect(output.data.checks).toHaveLength(6)
    }
    expect(run(valid, ['verify', 'tdd', TASK, '--dir', '.', '--json']).status).toBe(0)
  }, 120_000)

  it('keeps TDD rooted in cwd without --dir (AC-3)', () => {
    const { valid, malformed } = createTddFixture(fixtureRoot())
    expect(run(valid, ['validate', 'tdd', TASK, '--json']).status).toBe(0)
    expect(run(malformed, ['verify', 'tdd', TASK, '--json']).status).toBe(1)
  }, 60_000)
})
