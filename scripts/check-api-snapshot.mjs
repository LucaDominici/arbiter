#!/usr/bin/env node
// Gate: verify public TypeScript API exports have not changed without acknowledgment. (#602)
//
// Normalization protocol (survives tsc-version drift):
//   1. Strip // line comments and /* */ block comments
//   2. Sort top-level export declarations alphabetically by symbol name
//   3. Sort interface/type member declarations alphabetically
//   4. Collapse runs of whitespace to single space
//   5. Drop blank lines
//
// Snapshot files live in api/*.api.md.
// To regenerate: npm run api:snapshot
// On intentional breaking changes: include "BREAKING API CHANGE:" in PR_BODY env var.
//
// Exit 0: snapshots match current source exports (or drift acknowledged).
// Exit 1: drift detected without acknowledgment.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = process.cwd()
const API_DIR = join(ROOT, 'api')
const REGEN = process.argv.includes('--regen')
const PR_BODY = process.env.PR_BODY ?? ''
const BREAKING_MARKER = 'BREAKING API CHANGE:'

// Map of snapshot file → source file(s) to scan for exports
const SNAPSHOT_TARGETS = [
  { snapshot: 'plugin.api.md', sources: ['src/types/plugin.ts'] },
  {
    snapshot: 'invariants.api.md',
    sources: ['src/invariants/index.ts', 'src/invariants/types.ts'],
  },
  { snapshot: 'compatibility.api.md', sources: ['src/compatibility/index.ts'] },
]

function stripComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
  out = out.replace(/\/\/[^\n]*/g, '')
  return out
}

function extractExportLines(src) {
  const stripped = stripComments(src)
  const lines = stripped.split('\n')
  const exports = []
  let current = []
  let depth = 0
  let inExport = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!inExport && /^export\b/.test(trimmed)) {
      inExport = true
      current = []
    }
    if (inExport) {
      current.push(trimmed)
      for (const ch of line) {
        if (ch === '{') depth++
        if (ch === '}') depth--
      }
      const blockDone =
        depth <= 0 &&
        (trimmed.endsWith('}') ||
          trimmed.endsWith(';') ||
          (!trimmed.endsWith(',') && !trimmed.endsWith('{')))
      if (blockDone) {
        exports.push(current.join(' '))
        current = []
        inExport = false
        depth = 0
      }
    }
  }
  if (current.length > 0) exports.push(current.join(' '))
  return exports
}

function normalize(exports) {
  const sorted = [...exports].sort()
  return sorted
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

function readSource(relPath) {
  const full = join(ROOT, relPath)
  if (!existsSync(full)) {
    console.error(
      `check-api-snapshot: source file not found: ${full}\nUpdate SNAPSHOT_TARGETS in this script if the file was renamed or removed.`,
    )
    process.exit(1)
  }
  return readFileSync(full, 'utf-8')
}

function snapshotContent(sources) {
  const allExports = []
  for (const src of sources) {
    const content = readSource(src)
    allExports.push(...extractExportLines(content))
  }
  const normalized = normalize(allExports)
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16)
  return `<!-- api-snapshot hash:${hash} -->\n\`\`\`typescript\n${normalized}\n\`\`\`\n`
}

function hashOf(content) {
  const hashMatch = content.match(/api-snapshot hash:([0-9a-f]+)/)
  return hashMatch ? hashMatch[1] : null
}

mkdirSync(API_DIR, { recursive: true })

let drifted = false
for (const target of SNAPSHOT_TARGETS) {
  const snapshotPath = join(API_DIR, target.snapshot)
  const current = snapshotContent(target.sources)
  const currentHash = hashOf(current)

  if (REGEN) {
    writeFileSync(snapshotPath, current)
    process.stdout.write(`check-api-snapshot: regenerated ${target.snapshot}
`)
    continue
  }

  if (!existsSync(snapshotPath)) {
    writeFileSync(snapshotPath, current)
    process.stdout.write(`check-api-snapshot: created initial snapshot ${target.snapshot}
`)
    continue
  }

  const committed = readFileSync(snapshotPath, 'utf-8')
  const committedHash = hashOf(committed)

  if (currentHash !== committedHash) {
    if (PR_BODY.includes(BREAKING_MARKER)) {
      process.stdout.write(
        `check-api-snapshot: ${target.snapshot} drifted — acknowledged via "${BREAKING_MARKER}" in PR_BODY\n`,
      )
    } else {
      console.error(
        `check-api-snapshot: DRIFT in ${target.snapshot} (committed=${committedHash ?? 'none'}, current=${currentHash ?? 'none'}).\n` +
          `  Regenerate with: npm run api:snapshot\n` +
          `  Or acknowledge breaking changes by including "${BREAKING_MARKER}" in the PR body.`,
      )
      drifted = true
    }
  }
}

if (REGEN) {
  process.stdout.write('check-api-snapshot: all snapshots regenerated\n')
  process.exit(0)
}

if (drifted) {
  process.exit(1)
} else {
  process.stdout.write('check-api-snapshot: OK — all snapshots match\n')
}
