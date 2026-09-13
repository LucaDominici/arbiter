#!/usr/bin/env node
// Single-command LOCAL DEV entry point for the private consumer reliability bar (#2135).
// CI never runs this: the workflow calls prepare-consumer-reliability.mjs and
// consumer-reliability-bar.mjs directly as two SEPARATE jobs on two separate runners — that
// job boundary (no secret ever enters the verify job's environment at all) is the real
// credential boundary. This wrapper runs both phases as two children of ONE process on a
// developer's own machine instead.
//
// #2679 round 3 (final): this wrapper's OWN process.env must never hold a credential at
// all — a same-UID process can read them from /proc/<this-pid>/environ regardless of what
// any spawned child receives, so deleting a key after the fact (the previous
// scrubOwnCredentials approach) does not help; the parent already exposed them for as long
// as it held them. Fix by construction instead: refuse to start if process.env carries a
// credential, and take credentials only via --credentials-file (KEY=VALUE lines, mode
// 0600), injected exclusively into the prepare child's spawn env — this process's own
// environment never holds one.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import {
  assertCredentialFreeEnvironment,
  buildVerifierEnvironment,
} from './lib/consumer-reliability-bar.mjs'

export function main(argv, { spawn = spawnSync } = {}) {
  const root = process.cwd()
  let isolatedHome = null
  try {
    assertOwnEnvironmentCredentialFree(process.env)
    const options = parseArgs(argv)
    const credentials = loadCredentials(options.credentialsFile)

    const prepare = runPrepare(spawn, root, options, credentials)
    if (prepareFailed(prepare)) {
      process.stderr.write('[consumer-reliability] ERROR — credentialed preparation failed\n')
      return 2
    }

    isolatedHome = mkdtempSync(join(tmpdir(), 'arbiter-local-verifier-home-'))
    const verify = runVerify(spawn, root, options, isolatedHome)
    return verifyExitCode(verify)
  } catch (error) {
    process.stderr.write(`[consumer-reliability] ERROR — ${errorMessage(error)}\n`)
    return 2
  } finally {
    cleanupIsolatedHome(isolatedHome)
  }
}

function runPrepare(spawn, root, options, credentials) {
  return spawn(
    'node',
    [resolve(root, 'scripts', 'prepare-consumer-reliability.mjs'), '--output', options.workspace],
    {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 900000,
      // Credentials reach ONLY this child's env object — never process.env itself.
      env: { ...process.env, ...credentials },
    },
  )
}

function prepareFailed(result) {
  return result.status !== 0 || Boolean(result.signal)
}

function runVerify(spawn, root, options, isolatedHome) {
  return spawn(
    'node',
    [
      resolve(root, 'scripts', 'consumer-reliability-bar.mjs'),
      '--workspace',
      options.workspace,
      '--report-dir',
      options.reportDir,
      '--arbiter-cli',
      options.arbiterCli,
    ],
    {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 1800000,
      // process.env is guaranteed credential-free already (checked at the top); this
      // still builds an explicit allowlisted environment plus a fresh HOME from scratch.
      env: buildVerifierEnvironment(process.env, isolatedHome),
    },
  )
}

function verifyExitCode(result) {
  if (result.signal || ![0, 1, 2].includes(result.status)) return 2
  return result.status
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function cleanupIsolatedHome(isolatedHome) {
  if (isolatedHome !== null) rmSync(isolatedHome, { recursive: true, force: true })
}

function loadCredentials(credentialsFile) {
  return credentialsFile === null ? {} : readCredentialsFile(credentialsFile)
}

function assertOwnEnvironmentCredentialFree(environment) {
  try {
    assertCredentialFreeEnvironment(environment)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${detail} — this wrapper must never hold a credential in its own environment (a ` +
        'same-UID process can read it from /proc/<pid>/environ regardless of what any ' +
        'spawned child receives); pass credentials with --credentials-file <path> instead ' +
        '(KEY=VALUE lines, file mode 0600)',
    )
  }
}

function readCredentialsFile(path) {
  const mode = statSync(path).mode & 0o777
  if (mode !== 0o600) {
    throw new Error(`--credentials-file must be mode 0600 (found ${mode.toString(8)}): ${path}`)
  }
  const credentials = {}
  for (const rawLine of readFileSync(path, 'utf-8').split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const separator = line.indexOf('=')
    if (separator === -1) {
      throw new Error(`--credentials-file line is not KEY=VALUE: ${line}`)
    }
    credentials[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return credentials
}

function parseArgs(args) {
  return {
    workspace: resolve(argument(args, '--workspace')),
    reportDir: resolve(argument(args, '--report-dir')),
    arbiterCli: resolve(argument(args, '--arbiter-cli')),
    credentialsFile: optionalArgument(args, '--credentials-file'),
  }
}

function argument(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || typeof args[index + 1] !== 'string' || args[index + 1].length === 0) {
    throw new Error(`required argument missing: ${name}`)
  }
  return args[index + 1]
}

function optionalArgument(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return null
  const value = args[index + 1]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`required argument missing: ${name}`)
  }
  return resolve(value)
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)))
}
