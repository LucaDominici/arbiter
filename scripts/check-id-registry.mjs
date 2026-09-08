#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: validates docs/internal/SYSTEM/ID-REGISTRY.md — the registry of every identifier scheme —
// CATALOG: against schemas/id-registry.schema.json, then proves the three properties a registry of
// CATALOG: registries exists to guarantee: no two schemes can match the same identifier, every
// CATALOG: declared SSOT resolves on disk, and every staged row carries a future deadline.
// CATALOG: Also resolves every OD-NN citation in the tree against docs/internal/SYSTEM/OD-REGISTRY.md,
// CATALOG: which is why an owner decision can no longer be cited into existence.
// CATALOG: rejected fold-in into check-ontology-wired.mjs because that gate asks a different question
// CATALOG: of the same file — whether each row's gate/tool/hook is WIRED — and would conflate a
// CATALOG: malformed registry with a correctly-declared but unwired mechanism. This gate must pass
// CATALOG: before that one can mean anything, so they are ordered, not merged.
// CATALOG: rejected fold-in into check-decision-registry.mjs because that gate reads a governed
// CATALOG: project's D-NN registry emitted from a template (Track B); owner decisions are arbiter's
// CATALOG: own governance SSOT and share neither file, shape nor lifecycle.
//
// scripts/check-id-registry.mjs
// L1 gate: the ID registry is well-formed, collision-free, and its citations resolve.
//
// Asserts:
//   1. the ID_REGISTRY_START/END block parses and satisfies schemas/id-registry.schema.json,
//   2. no two schemes share a prefix, and no scheme's pattern matches another scheme's identifiers
//      (checked by expanding each pattern into a canonical sample and cross-matching every regex),
//   3. every pattern is anchored on its own prefix — the property that makes (2) hold for
//      identifiers the sample expansion does not reach,
//   4. every `ssot` path resolves on disk (except the literal `github`, which GitHub owns),
//   5. a `gate` or `hook` path resolves on disk unless the row is `staged`,
//   6. `n/a` in gate/tool/hook, and any `staged`/`retired` status, carries a `note`,
//   7. `staged` carries an `expires` that has not passed,
//   8. every OD-NN cited anywhere in the tree resolves to a row in the OD registry — except on
//      a line marked `id-registry:ignore-citation`, which declares the text to be ABOUT a
//      citation (a fixture, a quoted shape) rather than one.
//
// Usage: node scripts/check-id-registry.mjs [--dir <repo>] [--today YYYY-MM-DD]
// `--today` exists so the expiry assertions are testable without waiting for a calendar.
// Exit: 0 pass, 1 violation, 2 error (INV-53).
//
// Exports for unit tests: extractJsonBlock, sampleFromPattern, findCollisions, collectOdCitations

import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkRepo } from './lib/glob-walk.mjs'
import { loadSchema, validateSchema } from './lib/agent-return-validate.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const REGISTRY_REL = join('docs', 'internal', 'SYSTEM', 'ID-REGISTRY.md')
const OD_REL = join('docs', 'internal', 'SYSTEM', 'OD-REGISTRY.md')
const SCHEMA_REL = join('schemas', 'id-registry.schema.json')

/** Files an OD citation can plausibly live in. Binaries and lockfiles are never scanned. */
const CITATION_EXTENSIONS = new Set(['.md', '.ts', '.tsx', '.mjs', '.js', '.json', '.yml', '.yaml'])
const MAX_SCAN_BYTES = 2 * 1024 * 1024
/** `OD-14` but not `GOOD-14` and not the `OD-140` of some future wider scheme. */
const OD_CITATION = /(?<![A-Za-z0-9-])OD-\d{2}(?!\d)/g
/**
 * A line carrying this marker is text ABOUT citations, not a citation: a test fixture asserting
 * that an unknown id fails, or documentation quoting the shape. Deliberately a same-line marker
 * and deliberately greppable — `rg id-registry:ignore-citation` lists every escape in one command,
 * so an abused exemption is visible rather than buried in an allowlist file.
 */
const IGNORE_MARKER = 'id-registry:ignore-citation'

/**
 * Pull the JSON payload out of a `<!-- NAME_START -->` … `<!-- NAME_END -->` fenced block.
 * Sentinels rather than "the first code fence" so prose may carry examples without becoming data.
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function extractJsonBlock(text, name) {
  const start = text.indexOf(`<!-- ${name}_START -->`)
  const end = text.indexOf(`<!-- ${name}_END -->`)
  if (start === -1 || end === -1 || end < start) {
    return { ok: false, error: `missing ${name}_START/${name}_END sentinels` }
  }
  const between = text.slice(start, end)
  const fence = /```json\n([\s\S]*?)\n```/.exec(between)
  if (!fence) return { ok: false, error: `no \`\`\`json fence between the ${name} sentinels` }
  try {
    return { ok: true, value: JSON.parse(fence[1]) }
    // FAIL-OPEN-INTENT: a malformed payload is REPORTED as a violation by the caller, not thrown — this gate's job is to name a bad registry, not to crash on it.
  } catch (err) {
    // FAIL-OPEN-INTENT: a malformed payload is REPORTED as a violation by the caller, not thrown —
    // the gate's job is to name the bad registry, not to crash on it.
    return { ok: false, error: `payload is not valid JSON: ${(err && err.message) || err}` }
  }
}

/** `[0-9]{2}`, `[A-Z]+`, `[a-z]?` — the only quantified classes the registry's patterns use. */
const CHAR_CLASS = /^\[([0-9A-Za-z-]+)\](\{(\d+)(,\d+)?\}|\+|\?|\*)?/

/** One canonical run of characters for a matched class: '00', 'A', or '' for an optional one. */
function expandClass(match) {
  const [, set, quant, exact] = match
  const ch = set.startsWith('0-9') ? '0' : set.startsWith('A-Z') ? 'A' : 'a'
  if (quant === '?' || quant === '*') return ''
  return ch.repeat(exact ? Number(exact) : 1)
}

/**
 * Expand an anchored identifier pattern into one canonical example.
 * Deliberately a tiny grammar covering the shapes the registry actually uses — a general regex
 * inverter would be a research project, and a scheme whose pattern this cannot expand is a scheme
 * whose collision risk a reader cannot reason about either, so it is reported rather than guessed.
 * @returns {string | null}
 */
export function sampleFromPattern(pattern) {
  let body = pattern
  if (!body.startsWith('^') || !body.endsWith('$')) return null
  body = body.slice(1, -1)
  let out = ''
  let i = 0
  while (i < body.length) {
    const rest = body.slice(i)
    const cls = CHAR_CLASS.exec(rest)
    if (cls) {
      out += expandClass(cls)
      i += cls[0].length
      continue
    }
    if (rest.startsWith('\\')) {
      out += rest[1]
      i += 2
      continue
    }
    const ch = rest[0]
    // Any other metacharacter means the grammar above does not cover this pattern.
    if ('()|[]{}+*?.'.includes(ch)) return null
    out += ch
    i += 1
  }
  return out
}

/**
 * Cross-match every scheme's regex against every other scheme's canonical sample.
 * @returns {string[]} violations
 */
/** No two rows may claim one prefix — the historical MN collision, made impossible. */
function duplicatePrefixViolations(schemes) {
  const out = []
  const seen = new Map()
  for (const s of schemes) {
    if (seen.has(s.prefix)) {
      out.push(`prefix "${s.prefix}" is claimed twice (${seen.get(s.prefix)} and ${s.meaning})`)
      continue
    }
    seen.set(s.prefix, s.meaning)
  }
  return out
}

/** One canonical identifier per scheme, plus the rows whose pattern cannot yield one. */
function buildSamples(schemes) {
  const samples = new Map()
  const out = []
  for (const s of schemes) {
    if (!s.pattern.startsWith(`^${s.prefix}`)) {
      out.push(
        `scheme "${s.prefix}": pattern ${s.pattern} is not anchored on its own prefix — ` +
          `cross-scheme uniqueness cannot be established from it`,
      )
    }
    const sample = sampleFromPattern(s.pattern)
    if (sample === null) {
      out.push(
        `scheme "${s.prefix}": pattern ${s.pattern} uses constructs this gate cannot expand ` +
          `into an example; simplify it or the collision check is vacuous for this row`,
      )
      continue
    }
    samples.set(s.prefix, sample)
  }
  return { samples, violations: out }
}

/**
 * Cross-match every scheme's regex against every other scheme's canonical sample.
 * @returns {string[]} violations
 */
export function findCollisions(schemes) {
  const { samples, violations } = buildSamples(schemes)
  violations.unshift(...duplicatePrefixViolations(schemes))
  for (const s of schemes) {
    let re
    try {
      re = new RegExp(s.pattern)
      // FAIL-OPEN-INTENT: an invalid regex becomes a named violation on the next line — that IS the surfacing.
    } catch (err) {
      violations.push(`scheme "${s.prefix}": pattern is not a valid regex: ${err.message}`)
      continue
    }
    for (const [prefix, sample] of samples) {
      if (prefix === s.prefix) continue
      if (re.test(sample)) {
        violations.push(
          `collision: pattern of "${s.prefix}" (${s.pattern}) matches "${sample}", ` +
            `a valid identifier of "${prefix}"`,
        )
      }
    }
  }
  return violations
}

/**
 * Where a Track-B script actually lives. A `target` scheme's gate is not run by arbiter — it is
 * EMITTED, so the file on disk is the EJS template under src/templates/, and demanding it at the
 * consumer path would fail every correctly-declined gate (CANON-01).
 */
export function templateTwin(gatePath) {
  return (
    join(
      'src',
      'templates',
      gatePath.startsWith('scripts/') ? gatePath : join('scripts', gatePath),
    ) + '.ejs'
  )
}

function resolveTrackPath(gatePath, track) {
  return track === 'target' ? templateTwin(gatePath) : gatePath
}

/** Every OD-NN token in the tree, mapped to the files citing it. */
/** The OD tokens one file cites, or null when the file is not worth scanning. */
function odTokensIn(root, rel) {
  const dot = rel.lastIndexOf('.')
  if (dot === -1 || !CITATION_EXTENSIONS.has(rel.slice(dot))) return null
  const abs = join(root, rel)
  let text
  try {
    if (statSync(abs).size > MAX_SCAN_BYTES) return null
    text = readFileSync(abs, 'utf-8')
    // FAIL-OPEN-INTENT: an unstattable/unreadable file cannot carry a citation, and aborting the whole-tree sweep on one bad file would hide every real one.
  } catch {
    return null
  }
  const found = []
  for (const line of text.split('\n')) {
    if (line.includes(IGNORE_MARKER)) continue
    for (const m of line.matchAll(OD_CITATION)) found.push(m[0])
  }
  return found
}

/** Every OD-NN token in the tree, mapped to the files citing it. */
export function collectOdCitations(root) {
  /** @type {Map<string, Set<string>>} */
  const found = new Map()
  for (const rel of walkRepo(root)) {
    const tokens = odTokensIn(root, rel)
    if (tokens === null) continue
    for (const token of tokens) {
      if (!found.has(token)) found.set(token, new Set())
      found.get(token).add(rel)
    }
  }
  return found
}

function parseArgs(argv) {
  const dirArg = argv.find((a) => a === '--dir')
  const dir = dirArg ? argv[argv.indexOf('--dir') + 1] : undefined
  const todayArg = argv.find((a) => a.startsWith('--today'))
  let today
  if (todayArg) {
    today = todayArg.includes('=') ? todayArg.split('=')[1] : argv[argv.indexOf(todayArg) + 1]
  }
  return { dir, today }
}

/** An `n/a` leg, and any staged/retired status, must carry a written reason. */
function exemptionViolations(s, where) {
  const out = []
  for (const field of ['gate', 'tool', 'hook']) {
    if (s[field] === 'n/a' && !s.note) {
      out.push(`${where}: ${field} is "n/a" with no note — an unreasoned exemption`)
    }
  }
  if ((s.status === 'staged' || s.status === 'retired') && !s.note) {
    out.push(`${where}: status "${s.status}" requires a note explaining it`)
  }
  return out
}

/** A stage is a DATED obligation: no date, or a passed one, is a violation. */
function stagedViolations(s, where, todayStr) {
  if (!s.expires) return [`${where}: staged rows must carry an expires date`]
  if (s.expires > todayStr) return []
  return [
    `${where}: staged since before ${s.expires}, which has passed (today ${todayStr}) — ` +
      `wire it or re-date it deliberately`,
  ]
}

/** An ACTIVE row's declared SSOT, gate and hook must all resolve on disk. */
function pathViolations(s, where, root) {
  const out = []
  if (s.ssot !== 'github' && !existsSync(join(root, s.ssot))) {
    out.push(`${where}: ssot "${s.ssot}" does not exist`)
  }
  for (const field of ['gate', 'hook']) {
    const value = s[field]
    if (value === 'n/a') continue
    if (existsSync(join(root, resolveTrackPath(value, s.track)))) continue
    out.push(
      `${where}: ${field} "${value}" does not exist` +
        (s.track === 'target' ? ` (nor as the Track-B template ${templateTwin(value)})` : ''),
    )
  }
  return out
}

/**
 * The per-row obligations. A staged row is exempt from pathViolations by design — it names the
 * SSOT, gate and hook it has not built yet, and the expiry is what stops that promise being
 * open-ended.
 */
function rowViolations(s, root, todayStr) {
  const where = `scheme "${s.prefix}"`
  const out = exemptionViolations(s, where)
  if (s.status === 'staged') return [...out, ...stagedViolations(s, where, todayStr)]
  return [...out, ...pathViolations(s, where, root)]
}

/** Collisions plus every row's own obligations, once the document is known schema-valid. */
function schemeViolations(schemes, root, today) {
  const todayStr = today || new Date().toISOString().slice(0, 10)
  const out = [...findCollisions(schemes)]
  for (const s of schemes) out.push(...rowViolations(s, root, todayStr))
  return out
}

/** Every OD-NN in the tree resolves — the property that stopped OD-14 being undefined. */
function odViolations(root) {
  const odPath = join(root, OD_REL)
  if (!existsSync(odPath)) return [`${OD_REL} not found — OD-NN citations cannot be resolved`]
  const odBlock = extractJsonBlock(readFileSync(odPath, 'utf-8'), 'OD_REGISTRY')
  if (!odBlock.ok) return [`${OD_REL}: ${odBlock.error}`]
  const known = new Set((odBlock.value?.decisions || []).map((d) => d.id))
  const out = []
  for (const [id, files] of collectOdCitations(root)) {
    if (known.has(id)) continue
    const list = [...files].sort().slice(0, 4).join(', ')
    out.push(`${id} is cited (${list}) but has no row in ${OD_REL}`)
  }
  return out
}

function main() {
  const { dir, today } = parseArgs(process.argv.slice(2))
  const root = dir ? resolve(dir) : resolve(scriptDir, '..')
  const registryPath = join(root, REGISTRY_REL)

  if (!existsSync(registryPath)) {
    process.stderr.write(`check-id-registry: ERROR — ${REGISTRY_REL} not found under ${root}\n`)
    return 2
  }
  const block = extractJsonBlock(readFileSync(registryPath, 'utf-8'), 'ID_REGISTRY')
  if (!block.ok) {
    process.stderr.write(`check-id-registry: ERROR — ${REGISTRY_REL}: ${block.error}\n`)
    return 2
  }
  let schema
  try {
    schema = loadSchema(resolve(scriptDir, '..', SCHEMA_REL))
  } catch (err) {
    process.stderr.write(`check-id-registry: ERROR — cannot load ${SCHEMA_REL}: ${err.message}\n`)
    return 2
  }

  const violations = validateSchema(block.value, schema, schema, 'id-registry')
  const schemes = Array.isArray(block.value?.schemes) ? block.value.schemes : []
  // Structure first: collision and row checks read fields the schema pass has just proven present,
  // so running them over an invalid document would report noise instead of the real fault.
  if (violations.length === 0) {
    violations.push(...schemeViolations(schemes, root, today))
  }
  violations.push(...odViolations(root))

  if (violations.length > 0) {
    process.stderr.write(`check-id-registry: FAIL — ${violations.length} violation(s)\n`)
    for (const v of violations) process.stderr.write(`  - ${v}\n`)
    return 1
  }
  process.stdout.write(
    `check-id-registry: PASS — ${schemes.length} schemes, no collisions, citations resolve\n`,
  )
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main())
  } catch (err) {
    process.stderr.write(`check-id-registry: ERROR — unexpected: ${err.message}\n`)
    process.exit(1)
  }
}
