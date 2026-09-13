import { afterEach, describe, expect, it } from 'vitest'
import { main } from '../../scripts/run-consumer-reliability.mjs'

// #2679 round 3 (CRITICAL): scrubOwnCredentials cannot clear /proc/<pid>/environ — a
// same-UID process can still read a deleted var's original value from this process's own
// environ file. The real fix is spawning the verify child with an EXPLICIT allowlisted
// environment built from scratch, never process.env (scrubbed or not). This spies on the
// exact env object passed to the verify spawnSync call via dependency injection.
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

describe('run-consumer-reliability.mjs local wrapper (#2679 round 3)', () => {
  const savedEnv: Record<string, string | undefined> = {}
  const CANARY_KEYS = ['ARBITER_CONSUMER_GO_DEPLOY_KEY', 'ARBITER_CONSUMER_GO_REPO', 'GH_TOKEN']

  afterEach(() => {
    for (const key of CANARY_KEYS) {
      if (savedEnv[key] === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = savedEnv[key]
    }
  })

  it('spawns the verify child with only the allowlisted env and a fresh HOME', () => {
    for (const key of CANARY_KEYS) {
      savedEnv[key] = process.env[key]
      process.env[key] = 'secret-canary'
    }
    const realHome = process.env.HOME
    const calls: Array<{ cmd: string; args: string[]; env: Record<string, string> }> = []
    const spawn = (
      cmd: string,
      args: string[],
      opts: { env: Record<string, string> },
    ): { status: number; signal: null } => {
      calls.push({ cmd, args, env: opts.env })
      return { status: 0, signal: null }
    }

    const exitCode = main(
      [
        '--workspace',
        '/tmp/arbiter-2679-workspace',
        '--report-dir',
        '/tmp/arbiter-2679-reports',
        '--arbiter-cli',
        '/tmp/arbiter-2679-cli.js',
      ],
      { spawn },
    )

    expect(exitCode).toBe(0)
    expect(calls).toHaveLength(2)
    const verifyEnv = calls[1].env
    for (const key of Object.keys(verifyEnv)) {
      expect(ALLOWED_VERIFY_ENV_KEYS.has(key)).toBe(true)
    }
    for (const key of CANARY_KEYS) expect(verifyEnv).not.toHaveProperty(key)
    expect(verifyEnv.HOME).toBeTruthy()
    expect(verifyEnv.HOME).not.toBe(realHome)
  })
})
