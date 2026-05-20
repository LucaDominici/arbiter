#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// emit-context-pack.mjs (#975) — deterministic CONTEXT_PACK emitter.
// Reads invariants from GLOBAL_INVARIANTS.md, canon entries from
// docs/SYSTEM/CANON.md, optional explicit routing rules from a fenced
// `routes:` YAML block in docs/METHOD/KNOWLEDGE_MAP.md, and emits a signed
// Markdown bundle per docs/METHOD/CONTEXT_PACK_SPEC.md.
//
// Determinism contract:
//   - No timestamps, hostnames, PIDs, or environment variables in output.
//   - All collections sorted before serialization.
//   - sha256 footer hash makes regeneration a fixed-point check.
//
// Usage:
//   node scripts/emit-context-pack.mjs --task-id <#NNN> --track <name>
//                                      [--files a,b,c] [--out path]

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

const SPEC_VERSION = '1.0.0'
const BASELINE_INV = ['INV-01', 'INV-12', 'INV-13']
const VALID_TRACKS = new Set(['core', 'templates', 'kit', 'docs', 'ci', 'meta'])

// Per-track defaults — mirror docs/METHOD/CONTEXT_PACK_SPEC.md §v1 Defaults.
const TRACK_DEFAULTS = {
  core: { inv: ['INV-04', 'INV-05', 'INV-06'], canon: ['CANON-16'] },
  templates: { inv: ['INV-04'], canon: ['CANON-04', 'CANON-13', 'CANON-16'] },
  kit: { inv: ['INV-04'], canon: ['CANON-02', 'CANON-03'] },
  docs: { inv: [], canon: [] },
  ci: { inv: ['INV-13'], canon: ['CANON-18', 'CANON-19'] },
  meta: { inv: [], canon: [] },
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      'task-id': { type: 'string' },
      track: { type: 'string' },
      files: { type: 'string', default: '' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    process.stdout.write(usage())
    process.exit(0)
  }

  if (!values['task-id']) {
    process.stderr.write('error: --task-id is required\n' + usage())
    process.exit(2)
  }
  if (!values.track) {
    process.stderr.write('error: --track is required\n' + usage())
    process.exit(2)
  }
  if (!VALID_TRACKS.has(values.track)) {
    process.stderr.write(`error: --track must be one of ${[...VALID_TRACKS].sort().join(', ')}\n`)
    process.exit(2)
  }

  const files = values.files
    ? values.files
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : []

  return { taskId: values['task-id'], track: values.track, files, out: values.out }
}

function usage() {
  return (
    'Usage: emit-context-pack.mjs --task-id <#NNN> --track <name>\n' +
    '                             [--files a,b,c] [--out path]\n' +
    `  track: ${[...VALID_TRACKS].sort().join(' | ')}\n`
  )
}

// ─── Invariant extraction ────────────────────────────────────────────────────

/**
 * Find a `### INV-NN: ...` heading and extract from that line up to the
 * next horizontal rule (`---`) or next `### INV-` heading, whichever first.
 * Returns { startLine, endLine, body } with 1-based inclusive line numbers,
 * or null if not found.
 */
function extractInvariant(doc, invId) {
  const lines = doc.split('\n')
  const escaped = invId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headingRe = new RegExp(`^### ${escaped}:`)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) return null

  let end = lines.length - 1
  for (let i = start + 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      end = i - 1
      break
    }
    if (/^### INV-\d+:/.test(lines[i])) {
      end = i - 1
      break
    }
  }

  while (end > start && lines[end].trim() === '') end--

  return {
    startLine: start + 1,
    endLine: end + 1,
    body: lines.slice(start, end + 1).join('\n'),
  }
}

/**
 * Find a `## CANON-NN ...` heading and extract until the next `## CANON-`
 * heading or end of file (whichever first).
 */
function extractCanon(doc, canonId) {
  const lines = doc.split('\n')
  const escaped = canonId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headingRe = new RegExp(`^## ${escaped}(\\s|$)`)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) return null

  let end = lines.length - 1
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## CANON-\d+/.test(lines[i])) {
      end = i - 1
      break
    }
  }
  while (end > start && lines[end].trim() === '') end--

  return {
    startLine: start + 1,
    endLine: end + 1,
    body: lines.slice(start, end + 1).join('\n'),
  }
}

// ─── KNOWLEDGE_MAP routing (v1: fenced YAML block) ───────────────────────────

/**
 * Look for a fenced ```yaml routes: ...``` block in KNOWLEDGE_MAP.md.
 * v1 supports a minimal shape:
 *   routes:
 *     - track: core
 *       invariants: [INV-01]
 *       canon: [CANON-16]
 * Returns the first matching rule for the given track, or null.
 *
 * If no fenced routes block exists, returns null — caller falls back to
 * spec defaults. This keeps KNOWLEDGE_MAP backward-compatible (prose-only
 * is still valid).
 */
function loadExplicitRoute(track) {
  const kmPath = join(REPO_ROOT, 'docs', 'METHOD', 'KNOWLEDGE_MAP.md')
  if (!existsSync(kmPath)) return null
  const content = readFileSync(kmPath, 'utf-8')
  const match = /```yaml[ \t]*\n(routes:[\s\S]*?)\n```/m.exec(content)
  if (!match) return null
  const body = match[1]
  const lines = body.split('\n')
  let current = null
  const rules = []
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    const dash = /^\s*-\s*track:\s*([A-Za-z0-9_-]+)\s*$/.exec(line)
    if (dash) {
      if (current) rules.push(current)
      current = { track: dash[1], invariants: [], canon: [] }
      continue
    }
    if (!current) continue
    const inv = /^\s+invariants:\s*\[([^\]]*)\]\s*$/.exec(line)
    if (inv) {
      current.invariants = inv[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^INV-\d+$/.test(s))
      continue
    }
    const canon = /^\s+canon:\s*\[([^\]]*)\]\s*$/.exec(line)
    if (canon) {
      current.canon = canon[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^CANON-\d+$/.test(s))
      continue
    }
  }
  if (current) rules.push(current)
  return rules.find((r) => r.track === track) ?? null
}

// ─── Sorting helpers ─────────────────────────────────────────────────────────

function numericTail(id) {
  const m = /-(\d+)$/.exec(id)
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER
}

function sortIdsAsc(ids) {
  return [...new Set(ids)].sort((a, b) => {
    const na = numericTail(a)
    const nb = numericTail(b)
    if (na !== nb) return na - nb
    return a.localeCompare(b)
  })
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// ─── File excerpt loader ─────────────────────────────────────────────────────

function loadFileExcerpt(relPath) {
  const abs = resolve(REPO_ROOT, relPath)
  if (!existsSync(abs)) return null
  const content = readFileSync(abs, 'utf-8')
  const lines = content.split('\n')
  const lastLine =
    lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  return {
    startLine: 1,
    endLine: lastLine,
    body: lines.slice(0, lastLine).join('\n'),
  }
}

// ─── Renderer ────────────────────────────────────────────────────────────────

function render({ taskId, track, files, invIds, canonIds, excerpts, routingSource }) {
  const out = []
  out.push(`# CONTEXT_PACK — ${taskId}`)
  out.push('')

  out.push('## Header')
  out.push(`- spec_version: ${SPEC_VERSION}`)
  out.push(`- task_id: ${taskId}`)
  out.push(`- track: ${track}`)
  out.push(`- emitted_from: scripts/emit-context-pack.mjs`)
  out.push('')

  out.push('## Task Identity')
  out.push(`- task_id: ${taskId}`)
  out.push(`- track: ${track}`)
  out.push(`- files: [${files.length === 0 ? '(none)' : files.join(', ')}]`)
  out.push(`- routing_source: ${routingSource}`)
  out.push('')

  out.push('## INV Set')
  if (invIds.length === 0) {
    out.push('- (none)')
  } else {
    for (const id of invIds) out.push(`- ${id}`)
  }
  out.push('')

  out.push('## CANON Set')
  if (canonIds.length === 0) {
    out.push('- (none)')
  } else {
    for (const id of canonIds) out.push(`- ${id}`)
  }
  out.push('')

  out.push('## Excerpts')
  out.push('')
  for (const ex of excerpts) {
    out.push(`### ${ex.slug}`)
    out.push(`source: ${ex.source}:L${ex.startLine}-L${ex.endLine}`)
    out.push('')
    out.push(ex.body)
    out.push('')
  }

  out.push('## Footer')
  out.push(`- excerpt_count: ${excerpts.length}`)
  const bodyBeforeHash = out.join('\n') + '\n'
  const hash = createHash('sha256').update(bodyBeforeHash, 'utf-8').digest('hex')
  out.push(`- hash: sha256:${hash}`)

  return out.join('\n') + '\n'
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const { taskId, track, files, out } = parseCli()

  const explicit = loadExplicitRoute(track)
  const trackDefault = TRACK_DEFAULTS[track] ?? { inv: [], canon: [] }

  const routingSource = explicit ? 'explicit-rule' : 'spec-default'
  const invIds = sortIdsAsc([
    ...BASELINE_INV,
    ...(explicit ? explicit.invariants : trackDefault.inv),
  ])
  const canonIds = sortIdsAsc(explicit ? explicit.canon : trackDefault.canon)

  const excerpts = []

  const invDocRel = 'GLOBAL_INVARIANTS.md'
  const invDocPath = join(REPO_ROOT, invDocRel)
  if (existsSync(invDocPath)) {
    const invDoc = readFileSync(invDocPath, 'utf-8')
    for (const id of invIds) {
      const ex = extractInvariant(invDoc, id)
      if (!ex) continue
      excerpts.push({
        slug: slugify(id),
        source: invDocRel,
        startLine: ex.startLine,
        endLine: ex.endLine,
        body: ex.body,
      })
    }
  }

  const canonDocRel = 'docs/SYSTEM/CANON.md'
  const canonDocPath = join(REPO_ROOT, canonDocRel)
  if (existsSync(canonDocPath)) {
    const canonDoc = readFileSync(canonDocPath, 'utf-8')
    for (const id of canonIds) {
      const ex = extractCanon(canonDoc, id)
      if (!ex) continue
      excerpts.push({
        slug: slugify(id),
        source: canonDocRel,
        startLine: ex.startLine,
        endLine: ex.endLine,
        body: ex.body,
      })
    }
  }

  const sortedFiles = [...files].sort()
  for (const rel of sortedFiles) {
    const ex = loadFileExcerpt(rel)
    if (!ex) continue
    excerpts.push({
      slug: slugify(rel),
      source: rel,
      startLine: ex.startLine,
      endLine: ex.endLine,
      body: ex.body,
    })
  }

  excerpts.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source)
    return a.startLine - b.startLine
  })

  const rendered = render({
    taskId,
    track,
    files: sortedFiles,
    invIds,
    canonIds,
    excerpts,
    routingSource,
  })

  if (out) {
    const abs = resolve(out)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, rendered)
  } else {
    process.stdout.write(rendered)
  }
}

main()
