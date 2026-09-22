#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { existsSync, renameSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deriveGatesForFiles, parsePlanFilesManifest } from './lib/gate-derivation.mjs'
import { inspectGateContract } from './lib/gate-contract.mjs'

const [, , root, planPath] = process.argv
if (!root || !planPath) {
  console.error('usage: derive-plan-gates.mjs <root> <planPath>')
  process.exit(2)
}
const withoutFragment = planPath.split('#')[0]
const abs = withoutFragment.startsWith('/') ? withoutFragment : join(root, withoutFragment)
if (!existsSync(abs)) process.exit(0)
const files = parsePlanFilesManifest(readFileSync(abs, 'utf8'))
if (files === null || files.length === 0) process.exit(0)
const statusPath = join(root, '.claude', '.task', 'status.json')
if (!existsSync(statusPath)) process.exit(0)
const state = JSON.parse(readFileSync(statusPath, 'utf8'))
state.derivedGates = deriveGatesForFiles(files, undefined, inspectGateContract(root))
const tmpPath = `${statusPath}.${process.pid}.tmp`
writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n')
renameSync(tmpPath, statusPath)
