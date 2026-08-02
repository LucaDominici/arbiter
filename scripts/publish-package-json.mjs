#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Publish-only manifest projection (#2133). The development package.json remains the
// source of npm lifecycle and contributor scripts; the packed consumer artifact gets
// the same manifest with scripts removed, then the original bytes are restored.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packagePath = resolve(root, 'package.json')
const backupPath = resolve(root, '.arbiter/package.json.prepack')

function writeAtomically(path, content) {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, path)
}

function stripScripts() {
  if (existsSync(backupPath)) {
    throw new Error(`stale publish manifest backup exists at ${backupPath}; run restore first`)
  }
  mkdirSync(dirname(backupPath), { recursive: true })
  copyFileSync(packagePath, backupPath)
  const manifest = JSON.parse(readFileSync(packagePath, 'utf-8'))
  delete manifest.scripts
  writeAtomically(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function restoreScripts() {
  if (!existsSync(backupPath)) {
    throw new Error(`publish manifest backup is missing at ${backupPath}`)
  }
  copyFileSync(backupPath, packagePath)
  rmSync(backupPath)
}

const command = process.argv[2]
try {
  if (command === 'strip') stripScripts()
  else if (command === 'restore') restoreScripts()
  else throw new Error('usage: publish-package-json.mjs <strip|restore>')
} catch (error) {
  process.stderr.write(
    `publish-package-json: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(2)
}
