// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PROJECT_ROOT = resolve('.')
type SecretKey =
  | 'ARBITER_CONSUMER_GO_REPO'
  | 'ARBITER_CONSUMER_GO_DEPLOY_KEY'
  | 'ARBITER_CONSUMER_TYPESCRIPT_REPO'
  | 'ARBITER_CONSUMER_TYPESCRIPT_DEPLOY_KEY'
  | 'ARBITER_CONSUMER_JAVA_REPO'
  | 'ARBITER_CONSUMER_JAVA_DEPLOY_KEY'

describe('consumer reliability prepare → verify boundary (#2135)', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('runs three real local clones through the single command and scrubs verifier children', () => {
    const fixture = createFixture()
    roots.push(fixture.root)
    const workspace = join(fixture.root, 'workspace')
    const reports = join(fixture.root, 'reports')
    const result = run(
      fixture,
      'run-consumer-reliability.mjs',
      ['--workspace', workspace, '--report-dir', reports, '--arbiter-cli', fixture.fakeCli],
      {
        ...fixture.secrets,
        GITHUB_TOKEN: 'must-not-reach-verifier',
        AWS_SECRET_ACCESS_KEY: 'must-not-reach-verifier',
      },
    )

    expect(result.status).toBe(0)
    const summary = JSON.parse(readFileSync(join(reports, 'summary.json'), 'utf-8'))
    expect(summary.result).toBe('PASS')
    expect(summary.consumers).toHaveLength(3)
    for (const consumer of fixture.config.consumers) {
      const repo = join(workspace, consumer.id)
      expect(git(repo, ['remote'])).toBe('')
      const observations = readFileSync(join(repo, '.verifier-env.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { keys: string[] })
      expect(observations).toHaveLength(4)
      for (const observation of observations) {
        expect(observation.keys.some((key) => key.startsWith('ARBITER_CONSUMER_'))).toBe(false)
        expect(observation.keys).not.toContain('GITHUB_TOKEN')
        expect(observation.keys).not.toContain('AWS_SECRET_ACCESS_KEY')
      }
      expect(statSync(join(reports, `${consumer.id}.json`)).mode & 0o777).toBe(0o600)
    }
  }, 60_000)

  it('returns ERROR and never updates a clone with a residual remote or mismatched HEAD', () => {
    const fixture = createFixture()
    roots.push(fixture.root)
    const workspace = join(fixture.root, 'boundary-workspace')
    const reports = join(fixture.root, 'boundary-reports')
    expect(
      run(fixture, 'prepare-consumer-reliability.mjs', ['--output', workspace], fixture.secrets)
        .status,
    ).toBe(0)
    const goRepo = join(workspace, 'go')
    const typescriptRepo = join(workspace, 'typescript')
    execFileSync('git', ['remote', 'add', 'residual', 'https://example.invalid/private.git'], {
      cwd: goRepo,
    })
    execFileSync('git', ['commit', '--allow-empty', '-m', 'mismatched head'], {
      cwd: typescriptRepo,
      env: gitIdentityEnvironment(),
    })

    const result = run(
      fixture,
      'consumer-reliability-bar.mjs',
      ['--workspace', workspace, '--report-dir', reports, '--arbiter-cli', fixture.fakeCli],
      {},
    )
    expect(result.status).toBe(2)
    expect(JSON.parse(readFileSync(join(reports, 'go.json'), 'utf-8'))).toMatchObject({
      kind: 'error',
      checks: { originFree: { status: 'ERROR' }, update: { detail: 'not evaluated' } },
    })
    expect(JSON.parse(readFileSync(join(reports, 'typescript.json'), 'utf-8'))).toMatchObject({
      kind: 'error',
      checks: { pinnedHead: { status: 'ERROR' }, update: { detail: 'not evaluated' } },
    })
    const updated = readFileSync(fixture.updateMarker, 'utf-8').trim().split('\n')
    expect(updated.some((line) => line === goRepo || line === typescriptRepo)).toBe(false)
    expect(updated).toContain(join(workspace, 'java'))
  }, 60_000)

  it('fails before cloning when one required secret is absent', () => {
    const fixture = createFixture()
    roots.push(fixture.root)
    const incomplete = { ...fixture.secrets }
    delete incomplete.ARBITER_CONSUMER_JAVA_DEPLOY_KEY
    const workspace = join(fixture.root, 'missing-secret-workspace')
    const result = run(
      fixture,
      'run-consumer-reliability.mjs',
      [
        '--workspace',
        workspace,
        '--report-dir',
        join(fixture.root, 'missing-secret-reports'),
        '--arbiter-cli',
        fixture.fakeCli,
      ],
      incomplete,
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('credentialed preparation failed')
    expect(existsSync(workspace)).toBe(false)
    expect(readFileSync(fixture.sshMarker, 'utf-8')).toBe('')
  })
})

interface ConsumerConfig {
  $schemaVersion: 1
  consumers: Array<{
    id: string
    language: string
    repoEnv: SecretKey
    keyEnv: SecretKey
    sha: string
  }>
}

function createFixture(): {
  root: string
  scriptsDir: string
  fakeCli: string
  updateMarker: string
  sshMarker: string
  config: ConsumerConfig
  secrets: Record<string, string>
} {
  const root = mkdtempSync(join(tmpdir(), 'arbiter-consumer-flow-'))
  const scriptsDir = join(root, 'scripts')
  mkdirSync(join(scriptsDir, 'data'), { recursive: true })
  mkdirSync(join(scriptsDir, 'lib'), { recursive: true })
  for (const path of [
    'prepare-consumer-reliability.mjs',
    'consumer-reliability-bar.mjs',
    'run-consumer-reliability.mjs',
    'probe-hooks.mjs',
    'check-hook-routing.mjs',
  ]) {
    copyFileSync(join(PROJECT_ROOT, 'scripts', path), join(scriptsDir, path))
  }
  copyFileSync(
    join(PROJECT_ROOT, 'scripts', 'lib', 'consumer-reliability-bar.mjs'),
    join(scriptsDir, 'lib', 'consumer-reliability-bar.mjs'),
  )

  const rows = [
    {
      id: 'go',
      language: 'go',
      repoEnv: 'ARBITER_CONSUMER_GO_REPO',
      keyEnv: 'ARBITER_CONSUMER_GO_DEPLOY_KEY',
    },
    {
      id: 'typescript',
      language: 'typescript',
      repoEnv: 'ARBITER_CONSUMER_TYPESCRIPT_REPO',
      keyEnv: 'ARBITER_CONSUMER_TYPESCRIPT_DEPLOY_KEY',
    },
    {
      id: 'java',
      language: 'java',
      repoEnv: 'ARBITER_CONSUMER_JAVA_REPO',
      keyEnv: 'ARBITER_CONSUMER_JAVA_DEPLOY_KEY',
    },
  ] as const
  const sources: Record<string, string> = {}
  const config: ConsumerConfig = {
    $schemaVersion: 1,
    consumers: rows.map((row) => {
      const repo = join(root, `source-${row.id}`)
      createConsumerRepo(repo)
      sources[row.id] = repo
      return { ...row, sha: git(repo, ['rev-parse', 'HEAD']) }
    }),
  }
  writeFileSync(
    join(scriptsDir, 'data', 'consumer-reliability-bar.json'),
    JSON.stringify(config, null, 2),
  )

  const fakeBin = join(root, 'fake-bin')
  mkdirSync(fakeBin)
  const fakeSsh = join(fakeBin, 'ssh')
  const sshMarker = join(root, 'ssh-invocations.txt')
  writeFileSync(sshMarker, '')
  writeFileSync(
    fakeSsh,
    [
      '#!/bin/sh',
      `printf '%s\\n' invoked >> ${shellQuote(sshMarker)}`,
      'last=""',
      'for arg in "$@"; do last="$arg"; done',
      'case "$last" in',
      `  *owner/go.git*) exec git-upload-pack ${shellQuote(sources.go)} ;;`,
      `  *owner/typescript.git*) exec git-upload-pack ${shellQuote(sources.typescript)} ;;`,
      `  *owner/java.git*) exec git-upload-pack ${shellQuote(sources.java)} ;;`,
      'esac',
      'exit 1',
      '',
    ].join('\n'),
  )
  chmodSync(fakeSsh, 0o755)

  const updateMarker = join(root, 'updated-repositories.txt')
  writeFileSync(updateMarker, '')
  const fakeCli = join(root, 'fake-arbiter-cli.mjs')
  writeFileSync(
    fakeCli,
    [
      "import { appendFileSync } from 'node:fs'",
      `const marker = ${JSON.stringify(updateMarker)}`,
      "const index = process.argv.indexOf('--dir')",
      "if (index !== -1) appendFileSync(marker, process.argv[index + 1] + '\\n')",
      "process.stdout.write(JSON.stringify({ command: 'update', version: '1', status: 'ok' }) + '\\n')",
      'process.exit(0)',
      '',
    ].join('\n'),
  )

  const secrets: Record<string, string> = {}
  for (const row of rows) {
    secrets[row.repoEnv] = `owner/${row.id}`
    secrets[row.keyEnv] = `fake-private-key-${row.id}`
  }
  return { root, scriptsDir, fakeCli, updateMarker, sshMarker, config, secrets }
}

function createConsumerRepo(dir: string): void {
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }))
  writeFileSync(
    join(dir, '.claude', 'hooks', 'debug-state-on-failure.mjs'),
    [
      '#!/usr/bin/env node',
      '// Arbiter hook: verifier environment observer fixture',
      "import { appendFileSync } from 'node:fs'",
      "appendFileSync('.verifier-env.jsonl', JSON.stringify({ keys: Object.keys(process.env) }) + '\\n')",
      'process.exit(0)',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(dir, '.claude', 'hooks', 'hooks.mjs'),
    "const HANDLERS = {\n  'PostToolUseFailure:Bash': ['debug-state-on-failure.mjs'],\n};\n",
  )
  writeFileSync(
    join(dir, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        PostToolUseFailure: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: 'node .claude/hooks/hooks.mjs PostToolUseFailure:Bash',
              },
            ],
          },
        ],
      },
    }),
  )
  writeFileSync(
    join(dir, '.arbiter-generated-manifest.json'),
    JSON.stringify({
      $schemaVersion: 1,
      files: {
        '.claude/hooks/debug-state-on-failure.mjs': 'fixture-baseline',
      },
    }),
  )
  copyFileSync(
    join(PROJECT_ROOT, 'scripts', 'check-hook-routing.mjs'),
    join(dir, 'scripts', 'check-hook-routing.mjs'),
  )
  writeFileSync(
    join(dir, 'scripts', 'check-all.mjs'),
    "runCheck('project check', 'node', ['project-check.mjs'])\n",
  )
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-m', 'consumer fixture'], {
    cwd: dir,
    env: gitIdentityEnvironment(),
    stdio: 'ignore',
  })
}

function run(
  fixture: { root: string },
  script: string,
  args: string[],
  extraEnvironment: Record<string, string>,
) {
  return spawnSync('node', [join(fixture.root, 'scripts', script), ...args], {
    cwd: fixture.root,
    encoding: 'utf-8',
    timeout: 60_000,
    env: {
      PATH: `${join(fixture.root, 'fake-bin')}:${process.env.PATH}`,
      HOME: process.env.HOME,
      LANG: process.env.LANG ?? 'C',
      FAKE_UNUSED_CANARY: 'must-not-reach-verifier',
      ...extraEnvironment,
    },
  })
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

function gitIdentityEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'Arbiter Test',
    GIT_AUTHOR_EMAIL: 'arbiter-test' + '@' + 'example.invalid',
    GIT_COMMITTER_NAME: 'Arbiter Test',
    GIT_COMMITTER_EMAIL: 'arbiter-test' + '@' + 'example.invalid',
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
