import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../scripts/run-consumer-reliability.mjs'

// #2679 round 3 (final, CRITICAL): a same-UID process can read a credential from THIS
// process's own /proc/<pid>/environ regardless of what any spawned child receives —
// deleting the key afterward (scrubOwnCredentials) does not help, because the parent
// already held it. The wrapper must never hold a credential in process.env AT ALL: it
// refuses to start if one is present, and takes credentials only via --credentials-file,
// injected exclusively into the prepare child's spawn env.
const ALLOWED_VERIFY_ENV_KEYS = new Set([
  'PATH',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'CI',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'XDG_CACHE_HOME',
  'npm_config_cache',
  'NO_COLOR',
  'HOME',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_GLOBAL',
  'GIT_TERMINAL_PROMPT',
  'npm_config_audit',
  'npm_config_fund',
])

type SpawnCall = { cmd: string; args: string[]; env: Record<string, string> }

function spyingSpawn(calls: SpawnCall[]) {
  return (cmd: string, args: string[], opts: { env: Record<string, string> }) => {
    calls.push({ cmd, args, env: opts.env })
    return { status: 0, signal: null }
  }
}

describe('run-consumer-reliability.mjs local wrapper (#2679 round 3 final)', () => {
  const savedEnv: Record<string, string | undefined> = {}
  const CANARY_KEYS = ['ARBITER_CONSUMER_GO_DEPLOY_KEY', 'gh_token']
  const tempFiles: string[] = []

  afterEach(() => {
    for (const key of CANARY_KEYS) {
      if (savedEnv[key] === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = savedEnv[key]
    }
    for (const path of tempFiles.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  it.each(CANARY_KEYS)(
    'refuses to start when %s is present in its own environment, in any case',
    (key) => {
      savedEnv[key] = process.env[key]
      process.env[key] = 'secret-canary'
      const calls: SpawnCall[] = []

      const exitCode = main(
        ['--workspace', '/tmp/x', '--report-dir', '/tmp/y', '--arbiter-cli', '/tmp/z'],
        { spawn: spyingSpawn(calls) },
      )

      expect(exitCode).toBe(2)
      expect(calls).toHaveLength(0)
    },
  )

  it('reads --credentials-file into the prepare spawn env only, never the verify spawn env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-credentials-file-'))
    tempFiles.push(dir)
    const credentialsFile = join(dir, 'credentials.env')
    writeFileSync(
      credentialsFile,
      'ARBITER_CONSUMER_GO_DEPLOY_KEY=secret-canary\nGH_TOKEN=secret-canary\n',
      { mode: 0o600 },
    )
    const calls: SpawnCall[] = []

    const exitCode = main(
      [
        '--workspace',
        '/tmp/x',
        '--report-dir',
        '/tmp/y',
        '--arbiter-cli',
        '/tmp/z',
        '--credentials-file',
        credentialsFile,
      ],
      { spawn: spyingSpawn(calls) },
    )

    expect(exitCode).toBe(0)
    expect(calls).toHaveLength(2)
    const [prepareCall, verifyCall] = calls
    expect(prepareCall.env.ARBITER_CONSUMER_GO_DEPLOY_KEY).toBe('secret-canary')
    expect(prepareCall.env.GH_TOKEN).toBe('secret-canary')
    for (const key of Object.keys(verifyCall.env)) {
      expect(ALLOWED_VERIFY_ENV_KEYS.has(key)).toBe(true)
    }
    expect(verifyCall.env).not.toHaveProperty('ARBITER_CONSUMER_GO_DEPLOY_KEY')
    expect(verifyCall.env).not.toHaveProperty('GH_TOKEN')
  })

  it('refuses a --credentials-file that is not mode 0600', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-credentials-file-'))
    tempFiles.push(dir)
    const credentialsFile = join(dir, 'credentials.env')
    writeFileSync(credentialsFile, 'ARBITER_CONSUMER_GO_DEPLOY_KEY=secret-canary\n')
    chmodSync(credentialsFile, 0o644)
    const calls: SpawnCall[] = []

    const exitCode = main(
      [
        '--workspace',
        '/tmp/x',
        '--report-dir',
        '/tmp/y',
        '--arbiter-cli',
        '/tmp/z',
        '--credentials-file',
        credentialsFile,
      ],
      { spawn: spyingSpawn(calls) },
    )

    expect(exitCode).toBe(2)
    expect(calls).toHaveLength(0)
  })
})
