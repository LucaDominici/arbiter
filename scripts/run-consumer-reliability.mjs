#!/usr/bin/env node
// Single-command LOCAL DEV entry point for the private consumer reliability bar (#2135).
// CI never runs this: the workflow calls prepare-consumer-reliability.mjs and
// consumer-reliability-bar.mjs directly as two SEPARATE jobs on two separate runners — that
// job boundary (no secret ever enters the verify job's environment at all) is the real
// credential boundary. This wrapper runs both phases as two children of ONE process on a
// developer's own machine instead, so scrubOwnCredentials and the explicit
// allowlisted/fresh-HOME verify environment below are best-effort defense in depth here,
// never a substitute for the CI job split (#2679 round 3).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { buildVerifierEnvironment, scrubOwnCredentials } from './lib/consumer-reliability-bar.mjs'

export function main(argv, { spawn = spawnSync } = {}) {
  const root = process.cwd()
  let isolatedHome = null
  try {
    const options = parseArgs(argv)
    const prepare = spawn(
      'node',
      [resolve(root, 'scripts', 'prepare-consumer-reliability.mjs'), '--output', options.workspace],
      {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['ignore', 'inherit', 'inherit'],
        timeout: 900000,
        env: { ...process.env },
      },
    )
    if (prepare.status !== 0 || prepare.signal) {
      process.stderr.write('[consumer-reliability] ERROR — credentialed preparation failed\n')
      return 2
    }

    // Defense in depth only — see the module comment above. Verified: deleting a key from
    // process.env does not clear /proc/<this-pid>/environ, so a same-UID process can still
    // read the original value from THIS process's environ file regardless. The verify child
    // below is therefore spawned with an EXPLICIT allowlisted environment built from scratch
    // and a fresh, empty HOME — never process.env, scrubbed or not.
    scrubOwnCredentials(process.env)
    isolatedHome = mkdtempSync(join(tmpdir(), 'arbiter-local-verifier-home-'))

    const verify = spawn(
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
        env: buildVerifierEnvironment(process.env, isolatedHome),
      },
    )
    return verify.signal || ![0, 1, 2].includes(verify.status) ? 2 : verify.status
  } catch (error) {
    process.stderr.write(
      `[consumer-reliability] ERROR — ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 2
  } finally {
    if (isolatedHome !== null) rmSync(isolatedHome, { recursive: true, force: true })
  }
}

function parseArgs(args) {
  return {
    workspace: resolve(argument(args, '--workspace')),
    reportDir: resolve(argument(args, '--report-dir')),
    arbiterCli: resolve(argument(args, '--arbiter-cli')),
  }
}

function argument(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || typeof args[index + 1] !== 'string' || args[index + 1].length === 0) {
    throw new Error(`required argument missing: ${name}`)
  }
  return args[index + 1]
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)))
}
