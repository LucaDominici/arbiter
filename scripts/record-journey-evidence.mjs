#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — record a completed acceptance journey against the built artifact (#2382, ADR-037).
// The journey runner remains project-specific; this command binds its result to this checkout.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const usage =
  'Usage: node scripts/record-journey-evidence.mjs --task-id <id> --spec <command-or-spec> --target artifact\n'

function fail(message) {
  process.stderr.write(`[record-journey-evidence] ERROR: ${message}\n${usage}`)
  process.exit(2)
}

const values = {}
const allowed = new Set(['task-id', 'spec', 'target'])
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (arg === '--help') {
    process.stdout.write(usage)
    process.exit(0)
  }
  const name = arg.startsWith('--') ? arg.slice(2) : ''
  if (!allowed.has(name) || i + 1 >= process.argv.length) fail(`invalid argument: ${arg}`)
  values[name] = process.argv[++i]
}

const taskId = String(values['task-id'] ?? '').trim()
const spec = String(values.spec ?? '').trim()
const target = String(values.target ?? '').trim()
if (taskId.length === 0) fail('--task-id is required')
if (spec.length === 0) fail('--spec is required')
if (target !== 'artifact')
  fail('--target must be exactly "artifact"; dev-server runs are not accepted')

const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: process.cwd(),
  encoding: 'utf8',
})
if (rootResult.status !== 0) fail('must run inside a git checkout')
const root = resolve(rootResult.stdout.trim())
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
const branchResult = git(['branch', '--show-current'])
const shaResult = git(['rev-parse', 'HEAD'])
if (branchResult.status !== 0 || shaResult.status !== 0)
  fail('could not resolve the current branch and HEAD sha')

const branch = branchResult.stdout.trim()
const sha = shaResult.stdout.trim()
if (branch.length === 0 || sha.length === 0)
  fail('could not resolve the current branch and HEAD sha')

const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown'
const evidenceDir = join(root, '.arbiter', 'evidence', 'journey')
const evidencePath = join(evidenceDir, `${safeTaskId}.json`)
const temporaryPath = `${evidencePath}.tmp-${process.pid}`
const evidence = { branch, sha, spec, target }

try {
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(temporaryPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8')
  renameSync(temporaryPath, evidencePath)
} catch (error) {
  fail(`could not write ${evidencePath}: ${error instanceof Error ? error.message : String(error)}`)
}

process.stdout.write(`[record-journey-evidence] wrote ${evidencePath}\n`)
