#!/usr/bin/env node
// Single-command entry point for the private consumer reliability bar (#2135).
// Preparation runs to completion with credentials; verification starts afterward
// in a fresh child process with a strict credential-free environment.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { buildVerifierEnvironment } from './lib/consumer-reliability-bar.mjs'

const root = process.cwd()

try {
  const options = parseArgs(process.argv.slice(2))
  const prepare = spawnSync(
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
    process.exit(2)
  }

  const verify = spawnSync(
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
      env: buildVerifierEnvironment(process.env),
    },
  )
  process.exit(verify.signal || ![0, 1, 2].includes(verify.status) ? 2 : verify.status)
} catch (error) {
  process.stderr.write(
    `[consumer-reliability] ERROR — ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(2)
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
