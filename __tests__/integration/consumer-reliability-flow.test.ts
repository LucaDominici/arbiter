// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
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
import YAML from 'yaml'

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
    const credentialsFile = writeCredentialsFile(fixture, fixture.secrets)
    const result = run(
      fixture,
      'run-consumer-reliability.mjs',
      [
        '--workspace',
        workspace,
        '--report-dir',
        reports,
        '--arbiter-cli',
        fixture.fakeCli,
        '--credentials-file',
        credentialsFile,
      ],
      // GITHUB_TOKEN can no longer be an ambient-env canary here — the wrapper now refuses
      // to start at all if a credential is in its own environment (unit-tested directly in
      // run-consumer-reliability.test.ts). AWS_SECRET_ACCESS_KEY is not a recognized
      // credential name, so it stays a valid canary proving it never reaches verify.
      { AWS_SECRET_ACCESS_KEY: 'must-not-reach-verifier' },
    )

    expect(result.status).toBe(0)
    const summary = JSON.parse(readFileSync(join(reports, 'summary.json'), 'utf-8'))
    expect(summary.result).toBe('PASS')
    expect(summary.consumers).toHaveLength(3)
    for (const consumer of fixture.config.consumers) {
      const repo = join(workspace, consumer.id)
      expect(git(repo, ['remote'])).toBe('')
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(consumer.sha)
      expect(statSync(join(reports, `${consumer.id}.json`)).mode & 0o777).toBe(0o600)
    }
  }, 60_000)

  it('bypasses an ambient signing agent and interactive authentication with the supplied key', () => {
    const fixture = createFixture()
    roots.push(fixture.root)
    const reports = join(fixture.root, 'agent-reports')
    const credentialsFile = writeCredentialsFile(fixture, fixture.secrets)
    const result = run(
      fixture,
      'run-consumer-reliability.mjs',
      [
        '--workspace',
        join(fixture.root, 'agent-workspace'),
        '--report-dir',
        reports,
        '--arbiter-cli',
        fixture.fakeCli,
        '--credentials-file',
        credentialsFile,
      ],
      { FAKE_REQUIRE_NONINTERACTIVE_KEY: '1' },
    )
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(join(reports, 'summary.json'), 'utf-8')).result).toBe('PASS')
    const calls = readFileSync(fixture.sshMarker, 'utf-8')
    expect(calls).toContain('agent=none batch=yes')
    expect(calls).not.toContain('ambient-agent-attempt')
    expect(calls).not.toContain('interactive-auth-attempt')
    expect(readFileSync(fixture.updateMarker, 'utf-8').trim()).not.toBe('')
  }, 60_000)

  it('returns ERROR on explicit-key rejection before any verifier execution', () => {
    const fixture = createFixture()
    roots.push(fixture.root)
    const reports = join(fixture.root, 'rejected-key-reports')
    const credentialsFile = writeCredentialsFile(fixture, {
      ...fixture.secrets,
      ARBITER_CONSUMER_GO_DEPLOY_KEY: 'fake-rejected-private-key',
    })
    const result = run(
      fixture,
      'run-consumer-reliability.mjs',
      [
        '--workspace',
        join(fixture.root, 'rejected-key-workspace'),
        '--report-dir',
        reports,
        '--arbiter-cli',
        fixture.fakeCli,
        '--credentials-file',
        credentialsFile,
      ],
      {},
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('credentialed preparation failed')
    expect(readFileSync(fixture.sshMarker, 'utf-8')).toContain('rejected-explicit-key')
    expect(readFileSync(fixture.updateMarker, 'utf-8')).toBe('')
    expect(existsSync(join(reports, 'summary.json'))).toBe(false)
  })

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
    // #2479: the same recorded details must reach STDOUT, not only the report files, so a
    // red run is diagnosable from the CI log alone. Before this the log carried nothing but
    // the one-line verdict, and reading a failure meant downloading the uploaded artifact —
    // the friction that let a multi-day red streak on main go unread.
    expect(result.stdout).toContain('originFree: ERROR')
    expect(result.stdout).toContain('pinnedHead: ERROR')
    expect(result.stdout).toContain('go (')
    expect(result.stdout).toContain('typescript (')
    // The verdict still lands last, so the log reads detail-then-conclusion.
    expect(result.stdout.trimEnd().split('\n').at(-1)).toContain('[consumer-reliability] ERROR')

    const updated = readFileSync(fixture.updateMarker, 'utf-8').trim().split('\n')
    expect(updated.some((line) => line === goRepo || line === typescriptRepo)).toBe(false)
    expect(updated).toContain(join(workspace, 'java'))
  }, 60_000)

  it('fails before cloning when one required secret is absent', () => {
    const fixture = createFixture()
    roots.push(fixture.root)
    const incomplete = { ...fixture.secrets }
    delete incomplete.ARBITER_CONSUMER_JAVA_DEPLOY_KEY
    const credentialsFile = writeCredentialsFile(fixture, incomplete)
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
        '--credentials-file',
        credentialsFile,
      ],
      {},
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('credentialed preparation failed')
    expect(existsSync(workspace)).toBe(false)
    expect(readFileSync(fixture.sshMarker, 'utf-8')).toBe('')
  })

  // #2679: the prepared workspace crosses a real artifact upload/download between two
  // separate CI jobs on two separate runners — a different absolute path than the one
  // `prepare` used. The verifier must re-root against ITS OWN --workspace, with no network
  // and no credential in its environment, and reach the same verdict shape it would from
  // the un-moved workspace.
  it('verifies a prepared workspace after it moves to an unrelated absolute path', () => {
    const fixture = createFixture()
    roots.push(fixture.root)
    const preparedAt = join(fixture.root, 'prepare-side', 'workspace')
    expect(
      run(fixture, 'prepare-consumer-reliability.mjs', ['--output', preparedAt], fixture.secrets)
        .status,
    ).toBe(0)

    const movedTo = join(fixture.root, 'verify-side', 'workspace')
    mkdirSync(join(fixture.root, 'verify-side'), { recursive: true })
    cpSync(preparedAt, movedTo, { recursive: true })

    const reports = join(fixture.root, 'moved-reports')
    const result = run(
      fixture,
      'consumer-reliability-bar.mjs',
      ['--workspace', movedTo, '--report-dir', reports, '--arbiter-cli', fixture.fakeCli],
      {},
    )
    expect(result.status, result.stderr).toBe(0)
    const summary = JSON.parse(readFileSync(join(reports, 'summary.json'), 'utf-8'))
    expect(summary.result).toBe('PASS')
    expect(summary.consumers).toHaveLength(3)
  }, 60_000)

  // #2679 round 3 (MAJOR): this test must run the WORKFLOW's own tar commands, not a
  // hand-written stand-in — extracted straight from the committed YAML text, so a future
  // edit to the real archive/extract steps either stays proven or breaks this test, never
  // silently diverges from what the test actually exercises.
  it('packs the prepared workspace into the tar the WORKFLOW itself runs, with no credential material', () => {
    const fixture = createFixture()
    roots.push(fixture.root)
    // Two different literal paths, standing in for two different runners' $RUNNER_TEMP —
    // the workflow's prepare and verify jobs never share a filesystem; only the artifact
    // (the tarball) crosses between them.
    const prepareTemp = join(fixture.root, 'prepare-runner-temp')
    const verifyTemp = join(fixture.root, 'verify-runner-temp')
    mkdirSync(prepareTemp, { recursive: true })
    mkdirSync(verifyTemp, { recursive: true })
    const workspace = join(prepareTemp, 'consumer-reliability')
    expect(
      run(fixture, 'prepare-consumer-reliability.mjs', ['--output', workspace], fixture.secrets)
        .status,
    ).toBe(0)

    const workflowSource = readFileSync(
      resolve('.github/workflows/consumer-reliability.yml'),
      'utf-8',
    )
    const archiveCommand = extractWorkflowRunCommand(workflowSource, 'prepare', '-czf')
    const extractCommand = extractWorkflowRunCommand(workflowSource, 'verify', '-xzf')
    const substitute = (command: string, runnerTemp: string): string =>
      command.replaceAll('$RUNNER_TEMP', runnerTemp).replaceAll('"', '')

    execFileSync('sh', ['-c', substitute(archiveCommand, prepareTemp)], { cwd: prepareTemp })

    const tarball = join(prepareTemp, 'consumer-workspace.tar.gz')
    const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf-8' })
    expect(listing).not.toMatch(/\.ssh\//)
    expect(listing).not.toMatch(/\.key$/m)

    // Simulate the upload/download artifact round trip: only the tarball crosses.
    cpSync(tarball, join(verifyTemp, 'consumer-workspace.tar.gz'))
    execFileSync('sh', ['-c', substitute(extractCommand, verifyTemp)], { cwd: verifyTemp })
    const extractedWorkspace = join(verifyTemp, 'consumer-reliability')

    for (const id of ['go', 'typescript', 'java']) {
      expect(existsSync(join(extractedWorkspace, id, '.git'))).toBe(true)
    }
    // The executable bit on the consumer's own script must survive the round trip.
    const runSh = join(extractedWorkspace, 'go', 'scripts', 'run.sh')
    expect(statSync(runSh).mode & 0o111).not.toBe(0)

    // No deploy-key content, SSH material, or GIT_ASKPASS token can be inside the archive —
    // prepare unlinks the key file before the workspace is ever written, and the credential
    // directory lives outside the workspace entirely.
    for (const needle of ['fake-private-key', 'GIT_ASKPASS', 'x-access-token']) {
      expect(() =>
        execFileSync('grep', ['-r', '-l', needle, extractedWorkspace], { encoding: 'utf-8' }),
      ).toThrow()
    }
    // #2679 round 3: no `http.<url>.extraheader`/credential URL (the shape actions/checkout
    // itself uses to carry a bearer token) may survive into any packed .git/config, even
    // though this clone is made over SSH and should never have one in the first place.
    for (const id of ['go', 'typescript', 'java']) {
      const gitConfig = readFileSync(join(extractedWorkspace, id, '.git', 'config'), 'utf-8')
      expect(gitConfig).not.toMatch(/extraheader/i)
      expect(gitConfig).not.toMatch(/https?:\/\/[^/]*:[^/]*@/)
    }
  }, 60_000)

  it('refuses to verify when a consumer deploy-key variable reaches the verifier process', () => {
    const fixture = createFixture()
    roots.push(fixture.root)
    const workspace = join(fixture.root, 'leaked-key-workspace')
    expect(
      run(fixture, 'prepare-consumer-reliability.mjs', ['--output', workspace], fixture.secrets)
        .status,
    ).toBe(0)
    const reports = join(fixture.root, 'leaked-key-reports')
    const result = run(
      fixture,
      'consumer-reliability-bar.mjs',
      ['--workspace', workspace, '--report-dir', reports, '--arbiter-cli', fixture.fakeCli],
      { ARBITER_CONSUMER_GO_DEPLOY_KEY: 'must-not-reach-verifier' },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('credential-bearing verifier environment')
    expect(existsSync(join(reports, 'summary.json'))).toBe(false)
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
  // AC-2's committed name->gate mapping. `new emitted gate` is emitted by the fresh
  // render and absent from the consumer's own spine, so it is carried as tracked debt.
  writeFileSync(
    join(scriptsDir, 'data', 'consumer-gate-map.json'),
    JSON.stringify(
      {
        $schemaVersion: 1,
        consumers: Object.fromEntries(
          rows.map((row) => [
            row.id,
            {
              gateSurface: { kind: 'spine' },
              debtCeiling: 1,
              mapping: {
                'project check': 'WIRED:project check',
                'new emitted gate': 'DEBT:#1',
              },
            },
          ]),
        ),
      },
      null,
      2,
    ),
  )

  const fakeBin = join(root, 'fake-bin')
  mkdirSync(fakeBin)
  // The debt register is only a ratchet if every entry names a still-open issue, and that
  // lookup lives in the CREDENTIALED prepare phase — the verifier runs without a token.
  const fakeGh = join(fakeBin, 'gh')
  writeFileSync(fakeGh, ['#!/bin/sh', `printf '%s' '{"state":"OPEN"}'`, ''].join('\n'))
  chmodSync(fakeGh, 0o755)
  const fakeSsh = join(fakeBin, 'ssh')
  const sshMarker = join(root, 'ssh-invocations.txt')
  writeFileSync(sshMarker, '')
  writeFileSync(
    fakeSsh,
    [
      '#!/bin/sh',
      `printf '%s\\n' invoked >> ${shellQuote(sshMarker)}`,
      'last=""',
      'agent=default; batch=no; key=""; previous=""',
      'for arg in "$@"; do',
      '  case "$previous:$arg" in',
      '    -o:IdentityAgent=none) agent=none ;;',
      '    -o:BatchMode=yes) batch=yes ;;',
      '    -i:*) key="$arg" ;;',
      '  esac',
      '  last="$arg"; previous="$arg"',
      'done',
      `printf 'agent=%s batch=%s\\n' "$agent" "$batch" >> ${shellQuote(sshMarker)}`,
      'if [ "${FAKE_REQUIRE_NONINTERACTIVE_KEY:-}" = 1 ]; then',
      `  if [ "$agent" != none ]; then echo ambient-agent-attempt >> ${shellQuote(sshMarker)}; exit 255; fi`,
      `  if [ "$batch" != yes ]; then echo interactive-auth-attempt >> ${shellQuote(sshMarker)}; exit 255; fi`,
      'fi',
      'if [ -n "$key" ] && [ "$(cat "$key")" = fake-rejected-private-key ]; then',
      `  echo rejected-explicit-key >> ${shellQuote(sshMarker)}`,
      '  exit 255',
      'fi',
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
      "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      `const marker = ${JSON.stringify(updateMarker)}`,
      "const index = process.argv.indexOf('--dir')",
      // AC-2 reads the FRESH render off a throwaway copy whose spine was deleted, so the
      // fake CLI has to behave like the real one and materialize it — emitting one name
      // the consumer already runs and one it does not.
      'if (index !== -1) {',
      '  const dir = process.argv[index + 1]',
      "  appendFileSync(marker, dir + '\\n')",
      "  mkdirSync(join(dir, 'scripts'), { recursive: true })",
      "  writeFileSync(join(dir, 'scripts', 'check-all.mjs'), \"runCheck('project check', 'node', ['project-check.mjs'])\\nrunCheck('new emitted gate', 'node', ['new.mjs'])\\n\")",
      '}',
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
      "if (Object.keys(process.env).some((key) => key.startsWith('ARBITER_CONSUMER_') || key === 'GITHUB_TOKEN' || key === 'AWS_SECRET_ACCESS_KEY')) process.exit(1)",
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
  // #2679 round 2: a real executable the consumer runs (e.g. java's run.sh) must survive the
  // tar-based artifact round trip; git records the exec bit in the tree so the clone in
  // prepare-consumer-reliability.mjs checks it out with the bit already set.
  writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(dir, 'scripts', 'run.sh'), 0o755)
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

// #2679 round 3 (final): run-consumer-reliability.mjs refuses to start if a credential is in
// its OWN environment — secrets must be written to a 0600 KEY=VALUE file instead.
function writeCredentialsFile(fixture: { root: string }, secrets: Record<string, string>): string {
  const path = join(fixture.root, `credentials-${Math.random().toString(36).slice(2)}.env`)
  writeFileSync(
    path,
    Object.entries(secrets)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  )
  return path
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

// #2679 round 3: the test must run the workflow's OWN command, never a hand-written
// stand-in, so a future edit to the real archive/extract step either stays proven here or
// breaks this test.
function extractWorkflowRunCommand(source: string, jobId: string, marker: string): string {
  const parsed = YAML.parse(source) as { jobs: Record<string, { steps: Array<{ run?: string }> }> }
  const steps = parsed.jobs[jobId]?.steps ?? []
  const step = steps.find((candidate) => String(candidate.run ?? '').includes(marker))
  if (typeof step?.run !== 'string') {
    throw new Error(`no step in job "${jobId}" has a run command containing "${marker}"`)
  }
  return step.run
}
