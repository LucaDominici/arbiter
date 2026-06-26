// SPDX-License-Identifier: Apache-2.0
/**
 * Gauntlet spec types and YAML parser (#260).
 *
 * The spec format is:
 *
 * ```yaml
 * name: trip-form
 * dimensions:
 *   transport: [car, train, plane]
 *   duration: [1d, 3d, 7d]
 * strategy: pairwise        # or 3-way
 * constraints:
 *   - when: { transport: plane, duration: 1d }
 *     then: skip
 * tags: ["@gauntlet"]
 * ```
 *
 * YAML parsing is done with a minimal bespoke parser tailored to the
 * limited spec format above — no external YAML library is required.
 * This avoids the ESM/symlink resolution issue in worktrees with `#` in the
 * path and keeps the dependency surface small.
 */

import { createHash } from 'node:crypto'

interface GauntletConstraint {
  when: Record<string, string>
  then: 'skip'
}

export interface GauntletSpec {
  name: string
  dimensions: Record<string, string[]>
  strategy: 'pairwise' | '3-way'
  constraints: GauntletConstraint[]
  tags: string[]
}

export type ParseSpecResult = { ok: true; spec: GauntletSpec } | { ok: false; reason: string }

export function parseSpec(raw: string): ParseSpecResult {
  let parsed: unknown
  try {
    parsed = parseMinimalYaml(raw)
  } catch (err) {
    return {
      ok: false,
      reason: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return parseSpecObj(parsed)
}

function parseSpecObj(parsed: unknown): ParseSpecResult {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'spec must be a YAML object' }
  }

  const obj = parsed as Record<string, unknown>

  if (typeof obj['name'] !== 'string' || obj['name'].trim() === '') {
    return { ok: false, reason: 'spec.name is required (string)' }
  }

  if (typeof obj['dimensions'] !== 'object' || obj['dimensions'] === null) {
    return { ok: false, reason: 'spec.dimensions is required (object)' }
  }

  const dimensionsResult = parseDimensions(obj['dimensions'] as Record<string, unknown>)
  if (!dimensionsResult.ok) return dimensionsResult

  const strategyRaw = obj['strategy'] ?? 'pairwise'
  if (strategyRaw !== 'pairwise' && strategyRaw !== '3-way') {
    return { ok: false, reason: `spec.strategy must be "pairwise" or "3-way"` }
  }
  const strategy: 'pairwise' | '3-way' = strategyRaw

  const constraintsResult = parseConstraints(obj['constraints'])
  if (!constraintsResult.ok) return constraintsResult

  const tagsResult = parseTags(obj['tags'])
  if (!tagsResult.ok) return tagsResult

  return {
    ok: true,
    spec: {
      name: obj['name'],
      dimensions: dimensionsResult.dimensions,
      strategy,
      constraints: constraintsResult.constraints,
      tags: tagsResult.tags,
    },
  }
}

function parseDimensions(
  raw: Record<string, unknown>,
): { ok: false; reason: string } | { ok: true; dimensions: Record<string, string[]> } {
  const dimensions: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      return { ok: false, reason: `spec.dimensions.${k} must be an array of strings` }
    }
    if (v.length === 0) {
      return { ok: false, reason: `spec.dimensions.${k} must not be empty` }
    }
    dimensions[k] = v as string[]
  }
  if (Object.keys(dimensions).length === 0) {
    return { ok: false, reason: 'spec.dimensions must have at least one parameter' }
  }
  return { ok: true, dimensions }
}

function parseConstraints(
  raw: unknown,
): { ok: false; reason: string } | { ok: true; constraints: GauntletConstraint[] } {
  const constraints: GauntletConstraint[] = []
  if (raw === undefined || raw === null) return { ok: true, constraints }
  if (!Array.isArray(raw)) return { ok: false, reason: 'spec.constraints must be an array' }
  for (const c of raw as unknown[]) {
    if (typeof c !== 'object' || c === null) {
      return { ok: false, reason: 'each constraint must be an object' }
    }
    const co = c as Record<string, unknown>
    if (typeof co['when'] !== 'object' || co['when'] === null) {
      return { ok: false, reason: 'constraint.when must be an object' }
    }
    if (co['then'] !== 'skip') {
      return { ok: false, reason: 'constraint.then must be "skip"' }
    }
    constraints.push({ when: co['when'] as Record<string, string>, then: 'skip' })
  }
  return { ok: true, constraints }
}

function parseTags(raw: unknown): { ok: false; reason: string } | { ok: true; tags: string[] } {
  const tags: string[] = []
  if (raw === undefined) return { ok: true, tags }
  if (!Array.isArray(raw)) return { ok: false, reason: 'spec.tags must be an array' }
  for (const t of raw as unknown[]) {
    if (typeof t !== 'string') return { ok: false, reason: 'spec.tags entries must be strings' }
    tags.push(t)
  }
  return { ok: true, tags }
}

/** Compute a stable SHA-256 hash for a spec. Used by the sync gate. */
export function specHash(raw: string): string {
  // Normalise line endings and trim trailing whitespace before hashing
  const normalised = raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trimEnd()
  return createHash('sha256').update(normalised, 'utf-8').digest('hex')
}

// ── Minimal YAML parser ──────────────────────────────────────────────────────
//
// Supports the gauntlet spec subset:
//   - Block mappings (key: value)
//   - Block sequences (- item)
//   - Inline flow sequences ([a, b, c])
//   - Inline flow mappings ({ k: v, k2: v2 })
//   - Quoted strings ("..." or '...')
//   - Unquoted scalar values
//   - Comments (# ...)
//   - Indented nesting
//
// Does NOT support: anchors, aliases, multi-doc, complex scalar types.

// Use unknown to avoid the self-referential type alias restriction in TS < 4.8
type YamlValue = unknown

/**
 * Indentation width of a line, in columns. YAML forbids the TAB character for
 * indentation (it makes column arithmetic ambiguous), so a leading tab is a hard
 * parse error here — failing closed rather than silently miscounting a tab as a
 * single column and mis-nesting the document (#1554). js-yaml rejects the same.
 */
function computeIndent(line: string): number {
  const width = line.length - line.trimStart().length
  for (let i = 0; i < width; i++) {
    if (line[i] === '\t') {
      throw new Error('tab character is not allowed for indentation')
    }
  }
  return width
}

/**
 * Parse the gauntlet YAML subset into a plain value. Fail-closed: every
 * construct the parser does not model (over-indentation, duplicate keys, tab
 * indentation, an unbalanced flow collection) throws rather than silently
 * producing a divergent shape (#1554). Exported for the differential test that
 * pins this parser against js-yaml.
 */
export function parseMinimalYaml(text: string): YamlValue {
  const lines = text.split('\n')
  const ctx = new ParseCtx(lines)
  return parseBlock(ctx, 0)
}

class ParseCtx {
  pos: number = 0
  constructor(public readonly lines: string[]) {}

  peek(): string | undefined {
    return this.lines[this.pos]
  }

  skipBlanks(): void {
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos] ?? ''
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) {
        this.pos++
        continue
      }
      break
    }
  }

  consume(): string {
    return this.lines[this.pos++] ?? ''
  }
}

function parseBlock(ctx: ParseCtx, indent: number): YamlValue {
  ctx.skipBlanks()
  const line = ctx.peek()
  if (line === undefined) return null

  const trimmed = line.trim()
  const lineIndent = computeIndent(line)

  if (lineIndent < indent) return null

  // Sequence block
  if (trimmed.startsWith('- ') || trimmed === '-') {
    return parseBlockSeq(ctx, lineIndent)
  }

  // Mapping block
  if (
    /^[a-zA-Z_][a-zA-Z0-9_-]*\s*:/.test(trimmed) ||
    /^"[^"]+"\s*:/.test(trimmed) ||
    /^'[^']+'\s*:/.test(trimmed)
  ) {
    return parseBlockMap(ctx, lineIndent)
  }

  // Scalar fallback
  ctx.consume()
  return parseScalar(stripComment(trimmed))
}

function parseBlockSeq(ctx: ParseCtx, indent: number): YamlValue[] {
  const items: YamlValue[] = []
  for (;;) {
    ctx.skipBlanks()
    const line = ctx.peek()
    if (line === undefined) break
    const lineIndent = computeIndent(line)
    if (lineIndent < indent) break
    const trimmed = line.trim()
    if (!trimmed.startsWith('-')) break

    ctx.consume()
    const rest = stripComment(trimmed.slice(1).trim())

    if (rest === '') {
      // Multi-line item: indented sub-block
      items.push(parseBlock(ctx, indent + 2))
    } else if (rest.startsWith('{')) {
      // Inline flow map: - { k: v, k2: v2 }
      const m = parseFlowMap(rest)
      // Check if there are indented sub-keys following
      const sub = parseSubKeysAfterDash(ctx, indent + 2)
      if (sub !== null) {
        items.push({ ...(m as Record<string, YamlValue>), ...(sub as Record<string, YamlValue>) })
      } else {
        items.push(m)
      }
    } else if (rest.includes(':')) {
      // - key: value  (inline)
      const colonIdx = rest.indexOf(':')
      const k = rest.slice(0, colonIdx).trim()
      const v = rest.slice(colonIdx + 1).trim()
      const entry: Record<string, YamlValue> = { [k]: parseScalarOrFlow(v) }
      const sub = parseSubKeysAfterDash(ctx, indent + 2)
      if (sub !== null) {
        Object.assign(entry, sub as Record<string, YamlValue>)
      }
      items.push(entry)
    } else {
      items.push(parseScalar(rest))
    }
  }
  return items
}

function parseSubKeysAfterDash(ctx: ParseCtx, indent: number): YamlValue {
  ctx.skipBlanks()
  const line = ctx.peek()
  if (line === undefined) return null
  const lineIndent = computeIndent(line)
  if (lineIndent < indent) return null
  const trimmed = line.trim()
  if (/^[a-zA-Z_][a-zA-Z0-9_-]*\s*:/.test(trimmed)) {
    return parseBlockMap(ctx, lineIndent)
  }
  return null
}

function parseBlockMap(ctx: ParseCtx, indent: number): Record<string, YamlValue> {
  const obj: Record<string, YamlValue> = {}
  for (;;) {
    ctx.skipBlanks()
    const line = ctx.peek()
    if (line === undefined) break
    const lineIndent = computeIndent(line)
    if (lineIndent < indent) break
    if (lineIndent > indent) {
      // A sibling MORE indented than this mapping level is malformed YAML — the
      // child of the previous key, if any, was already consumed by the value
      // parse, so a leftover over-indented line means the document does not nest
      // the way it appears to. js-yaml errors here; failing closed prevents a
      // silently dropped mapping entry from shrinking the gauntlet matrix (#1554).
      throw new Error(`unexpected over-indentation in mapping (indent ${lineIndent} > ${indent})`)
    }

    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('-')) break

    const colonIdx = findMappingColon(trimmed)
    if (colonIdx < 0) break

    ctx.consume()
    const rawKey = trimmed.slice(0, colonIdx).trim()
    const key = unquote(rawKey)
    // YAML mandates an error on a duplicate key; the old last-wins silently
    // discarded the earlier entry — fail closed instead (#1554).
    if (Object.hasOwn(obj, key)) {
      throw new Error(`duplicate mapping key: ${key}`)
    }
    const valuePart = stripComment(trimmed.slice(colonIdx + 1))

    if (valuePart === '') {
      // Value is on subsequent lines
      const child = parseBlock(ctx, indent + 1)
      obj[key] = child
    } else if (valuePart.startsWith('[')) {
      obj[key] = parseFlowSeq(valuePart)
    } else if (valuePart.startsWith('{')) {
      obj[key] = parseFlowMap(valuePart)
    } else {
      // Check if next line is indented (child block)
      ctx.skipBlanks()
      const next = ctx.peek()
      if (next !== undefined) {
        const nextIndent = computeIndent(next)
        if (nextIndent > indent) {
          obj[key] = parseBlock(ctx, nextIndent)
          continue
        }
      }
      obj[key] = parseScalar(valuePart)
    }
  }
  return obj
}

/**
 * Strip a trailing YAML comment, returning the trimmed remainder. In YAML a `#`
 * begins a comment ONLY when it is at string start or preceded by whitespace AND
 * is not inside a quoted scalar — so `"#fff"`, `bug#hot`, and `#260` are NOT
 * comments. Quote tracking mirrors `findMappingColon`. (#1528)
 */
function stripComment(s: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? ''
    if (c === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (c === '#' && !inSingle && !inDouble) {
      const prev = i === 0 ? '' : (s[i - 1] ?? '')
      if (i === 0 || prev === ' ' || prev === '\t') {
        return s.slice(0, i).trim()
      }
    }
  }
  return s.trim()
}

function findMappingColon(s: string): number {
  // Find the colon that separates key from value in a block map line.
  // Must not be inside quotes.
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? ''
    if (c === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (c === ':' && !inSingle && !inDouble) {
      // Must be followed by space, end-of-string, or newline
      if (i + 1 >= s.length || s[i + 1] === ' ' || s[i + 1] === '\t') return i
    }
  }
  return -1
}

/**
 * Return the substring strictly inside the flow collection that OPENS at `s[0]`
 * (`[` or `{`), locating the matching close at the correct nesting depth while
 * respecting quotes — NOT the first `]`/`}` (the old `.replace(/\].*$/,'')`
 * truncated `["x]y"]` at the inner bracket). Throws on an unbalanced collection
 * or on non-whitespace trailing content after the close (#1554).
 */
function flowInner(s: string, open: string, close: string): string {
  let depth = 0
  let inSingle = false
  let inDouble = false
  let end = -1
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? ''
    if (c === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (inSingle || inDouble) continue
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) throw new Error(`unbalanced ${open}${close} flow collection`)
  if (s.slice(end + 1).trim() !== '') {
    throw new Error(`unexpected content after ${close} in flow collection`)
  }
  return s.slice(1, end)
}

/**
 * Split a flow-collection inner string on its TOP-LEVEL commas only, respecting
 * quotes and nested `[]`/`{}` so `"us,east"` and `[a,b]` are kept intact (the old
 * `.split(',')` corrupted any embedded comma into extra members) (#1554).
 */
function splitFlowEntries(inner: string): string[] {
  const out: string[] = []
  let depth = 0
  let inSingle = false
  let inDouble = false
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i] ?? ''
    if (c === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (inSingle || inDouble) continue
    if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) {
      out.push(inner.slice(start, i))
      start = i + 1
    }
  }
  out.push(inner.slice(start))
  return out
}

/** Index of the first colon not inside a quoted scalar (the flow key/value
 *  separator), or -1. Quote-aware twin of the old `indexOf(':')` (#1554). */
function firstUnquotedColon(s: string): number {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? ''
    if (c === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (c === ':' && !inSingle && !inDouble) return i
  }
  return -1
}

function parseFlowSeq(s: string): string[] {
  const inner = flowInner(s, '[', ']')
  if (inner.trim() === '') return []
  return splitFlowEntries(inner)
    .map((t) => unquote(t.trim()))
    .filter((t) => t !== '')
}

function parseFlowMap(s: string): Record<string, string> {
  const inner = flowInner(s, '{', '}')
  const obj: Record<string, string> = {}
  if (inner.trim() === '') return obj
  for (const pair of splitFlowEntries(inner)) {
    const colonIdx = firstUnquotedColon(pair)
    if (colonIdx < 0) continue
    const k = unquote(pair.slice(0, colonIdx).trim())
    const v = unquote(pair.slice(colonIdx + 1).trim())
    if (k === '') continue
    // YAML mandates an error on a duplicate key; fail closed (#1554).
    if (Object.hasOwn(obj, k)) {
      throw new Error(`duplicate mapping key: ${k}`)
    }
    obj[k] = v
  }
  return obj
}

function parseScalarOrFlow(s: string): YamlValue {
  if (s.startsWith('[')) return parseFlowSeq(s)
  if (s.startsWith('{')) return parseFlowMap(s)
  return parseScalar(s)
}

function parseScalar(s: string): string | null {
  if (s === '' || s === 'null' || s === '~') return null
  return unquote(s)
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}
