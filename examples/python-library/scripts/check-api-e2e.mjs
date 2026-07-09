#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-126 enforcement. Reads api-e2e.json at repo root; for SERVICE archetypes
// CATALOG:   (required:true) it FAILS when the live-API e2e suite is absent or empty —
// CATALOG:   the suite must boot the real binary and assert on live HTTP responses.
// CATALOG:   required:false (non-service) or absent manifest -> SKIP (exit 0). This is the
// CATALOG:   INVERTED absent-semantics vs INV-124: a declared service MUST ship the suite.
// CATALOG:   Boundary: file PRESENCE + non-empty only — live-run-pass is the CI/L2 runner
// CATALOG:   (tests/api/run.sh), assertion quality is INV-118 (anti-proforma).
// Exit codes: 0=PASS/SKIP, 1=policy violation (absent/empty suite), 2=schema/path-traversal error
// Usage: node scripts/check-api-e2e.mjs [--help]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'

function globMatch(pattern, filepath) {
  let reStr = '^'
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        reStr += '(?:[^/]*/)*'
        i += 3
      } else {
        reStr += '[\\s\\S]*'
        i += 2
      }
    } else if (ch === '*') {
      reStr += '[^/]*'
      i++
    } else if ('\\.+?^${}()|[]'.includes(ch)) {
      reStr += '\\' + ch
      i++
    } else {
      reStr += ch
      i++
    }
  }
  reStr += '$'
  return new RegExp(reStr).test(filepath)
}

const ROOT = resolve(process.cwd())
const MANIFEST_PATH = join(ROOT, 'api-e2e.json')
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.coverage',
  'target',
])

const HELP = `Usage: node scripts/check-api-e2e.mjs [--help]

Enforces that a SERVICE archetype (api-e2e.json required:true) ships a non-mocked
live-API e2e suite that boots the real binary/server (INV-126).

Rules:
  required:true   — the manifest glob must match >=1 NON-EMPTY suite file; otherwise FAIL.
  required:false  — SKIP (non-service archetype, e.g. library/cli/frontend).
  manifest absent — SKIP (ungoverned repo). Re-init with arbiter init to generate it.

Exit codes:
  0 — pass or SKIP
  1 — policy violation (required suite absent or empty)
  2 — schema error or path-traversal glob detected`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`${HELP}\n`)
  process.exit(0)
}

function walkDir(dir, files) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      walkDir(full, files)
    } else {
      files.push({ rel: full.slice(ROOT.length + 1).replace(/\\/g, '/'), abs: full })
    }
  }
}

function validateGlob(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return false
  if (isAbsolute(pattern)) return false
  for (const part of pattern.split('/')) {
    if (part === '..') return false
  }
  return true
}

function fileIsNonEmpty(abs) {
  try {
    return readFileSync(abs, 'utf-8').trim().length > 0
  } catch {
    return false
  }
}

async function main() {
  if (!existsSync(MANIFEST_PATH)) {
    process.stdout.write('[check-api-e2e] SKIP — api-e2e.json not found\n')
    process.exit(0)
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  } catch (err) {
    process.stderr.write(`[check-api-e2e] ERROR — invalid JSON: ${err.message}\n`)
    process.exit(2)
  }

  if (manifest.required !== true) {
    process.stdout.write(
      '[check-api-e2e] SKIP — required:false (non-service archetype, no live-API suite mandated)\n',
    )
    process.exit(0)
  }

  const glob = manifest.glob
  if (!validateGlob(glob)) {
    process.stderr.write(
      `[check-api-e2e] ERROR — manifest.glob "${glob}" is absent, absolute, or contains ` +
        `path traversal — only relative, non-traversal globs are allowed\n`,
    )
    process.exit(2)
  }

  const allFiles = []
  walkDir(ROOT, allFiles)

  const matches = allFiles.filter((f) => globMatch(glob, f.rel))
  const nonEmpty = matches.filter((f) => fileIsNonEmpty(f.abs))

  if (nonEmpty.length === 0) {
    const reason =
      matches.length === 0 ? 'no suite file matched' : 'matched suite file(s) are empty'
    process.stderr.write(
      `[check-api-e2e] FAIL — service archetype "${manifest.archetype}" declares a required ` +
        `live-API e2e suite but ${reason} (glob: ${glob}). A non-mocked suite that boots the ` +
        `real binary and asserts on live HTTP responses is mandatory — see ${manifest.suiteDir}/.\n`,
    )
    process.exit(1)
  }

  process.stdout.write(`[check-api-e2e] OK — ${nonEmpty.length} live-API suite file(s) present\n`)
  process.exit(0)
}

try {
  await main()
} catch (err) {
  process.stderr.write(`[check-api-e2e] ERROR — unexpected: ${err.message}\n`)
  process.exit(2)
}
