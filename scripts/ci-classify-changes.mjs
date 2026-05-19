#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CI change classifier — outputs step outputs for conditional job skipping.
// Reads BASE_SHA + HEAD_SHA from env; writes to $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const baseSha = process.env.BASE_SHA || 'origin/main'
const headSha = process.env.HEAD_SHA || 'HEAD'
const outputFile = process.env.GITHUB_OUTPUT

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim()
}

function setOutput(key, value) {
  const line = `${key}=${value}\n`
  process.stdout.write(`  classify: ${key}=${value}\n`)
  if (outputFile) appendFileSync(outputFile, line)
}

let changed = []
try {
  const mergeBase = git('merge-base', baseSha, headSha)
  changed = git('diff', '--name-only', mergeBase, headSha).split('\n').filter(Boolean)
} catch {
  // Fallback: diff against base directly
  try {
    changed = git('diff', '--name-only', baseSha, headSha).split('\n').filter(Boolean)
  } catch {
    changed = []
  }
}

const docsOnly =
  changed.length > 0 &&
  changed.every((f) => f.startsWith('docs/') || f.endsWith('.md') || f.startsWith('website/'))

const backendChanged = changed.some(
  (f) =>
    f.startsWith('src/') ||
    f.startsWith('scripts/') ||
    f.endsWith('.ts') ||
    f.endsWith('.mjs') ||
    f.endsWith('.js'),
)

const frontendChanged = changed.some(
  (f) => f.startsWith('website/') || f.includes('frontend') || f.includes('ui/'),
)

const infraChanged = changed.some(
  (f) =>
    f.startsWith('infra/') ||
    f.startsWith('.github/') ||
    f === 'Dockerfile' ||
    f.endsWith('.yml') ||
    f.endsWith('.yaml'),
)

const highRisk = changed.some(
  (f) =>
    f.startsWith('migrations/') ||
    f === 'package-lock.json' ||
    f === 'yarn.lock' ||
    f === 'package.json' ||
    f.startsWith('infra/'),
)

setOutput('docs_only', String(docsOnly))
setOutput('backend_changed', String(backendChanged))
setOutput('frontend_changed', String(frontendChanged))
setOutput('infra_changed', String(infraChanged))
setOutput('high_risk', String(highRisk))
