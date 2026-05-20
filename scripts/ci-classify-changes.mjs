#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CI change classifier — outputs step outputs for conditional job skipping.
// Reads BASE_SHA + HEAD_SHA from env; writes to $GITHUB_OUTPUT.
//
// Fail-closed semantics (#969): if any uncaught error occurs while resolving
// the changed-file set, every category flag is emitted as `true` so that
// downstream jobs run defensively. "Fail-closed" here means "run everything"
// — never skip work just because classification broke.
//
// --stdin: read newline-delimited paths from stdin instead of `git diff`,
// for unit-testability and ad-hoc reclassification.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

const CATEGORY_KEYS = [
  'docs_only',
  'backend_changed',
  'frontend_changed',
  'infra_changed',
  'high_risk',
  'e2e_specs',
  'ssot',
]

const baseSha = process.env.BASE_SHA || 'origin/main'
const headSha = process.env.HEAD_SHA || 'HEAD'
const outputFile = process.env.GITHUB_OUTPUT
const useStdin = process.argv.includes('--stdin')

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim()
}

function setOutput(key, value) {
  const line = `${key}=${value}\n`
  process.stdout.write(`  classify: ${key}=${value}\n`)
  if (outputFile) appendFileSync(outputFile, line)
}

function emitAllTrue() {
  for (const key of CATEGORY_KEYS) setOutput(key, 'true')
}

function readStdinPaths() {
  // Synchronously read all of stdin. Empty stdin yields an empty list.
  const buf = readFileSync(0, 'utf-8')
  return buf.split('\n').filter(Boolean)
}

function resolveChangedPaths() {
  if (useStdin) return readStdinPaths()
  // No inner swallowing: any git failure propagates to the outer guard so
  // fail-closed emits true for every category (#969).
  let mergeBase
  try {
    mergeBase = git('merge-base', baseSha, headSha)
  } catch {
    // merge-base may legitimately fail for shallow clones; fall back to a
    // direct diff. If that also fails, the outer guard fires.
    return git('diff', '--name-only', baseSha, headSha).split('\n').filter(Boolean)
  }
  return git('diff', '--name-only', mergeBase, headSha).split('\n').filter(Boolean)
}

let succeeded = false
try {
  const changed = resolveChangedPaths()

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

  const e2eSpecs = changed.some((f) => f.startsWith('__tests__/e2e/') || f.startsWith('tests/e2e/'))

  const ssot = changed.some(
    (f) =>
      f.startsWith('docs/SYSTEM/') || f === 'docs/METHOD/SSOT_CORE_SET.md' || f === 'arbiter.json',
  )

  setOutput('docs_only', String(docsOnly))
  setOutput('backend_changed', String(backendChanged))
  setOutput('frontend_changed', String(frontendChanged))
  setOutput('infra_changed', String(infraChanged))
  setOutput('high_risk', String(highRisk))
  setOutput('e2e_specs', String(e2eSpecs))
  setOutput('ssot', String(ssot))
  succeeded = true
} finally {
  if (!succeeded) {
    process.stderr.write(
      '  classify: ERROR resolving changed set — fail-closed, emitting all categories=true\n',
    )
    emitAllTrue()
  }
  process.exit(0)
}
