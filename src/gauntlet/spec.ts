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

export interface GauntletConstraint {
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

export type ParseSpecResult =
  | { ok: true; spec: GauntletSpec }
  | { ok: false; reason: string }

export function parseSpec(raw: string): ParseSpecResult {
  let parsed: unknown
  try {
    parsed = parseMinimalYaml(raw)
  } catch (err) {
    return { ok: false, reason: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` }
  }

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

  const dimensions: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(obj['dimensions'] as Record<string, unknown>)) {
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

  const strategyRaw = obj['strategy'] ?? 'pairwise'
  if (strategyRaw !== 'pairwise' && strategyRaw !== '3-way') {
    return { ok: false, reason: `spec.strategy must be "pairwise" or "3-way"` }
  }
  const strategy = strategyRaw as 'pairwise' | '3-way'

  const constraints: GauntletConstraint[] = []
  if (obj['constraints'] !== undefined && obj['constraints'] !== null) {
    if (!Array.isArray(obj['constraints'])) {
      return { ok: false, reason: 'spec.constraints must be an array' }
    }
    for (const c of obj['constraints'] as unknown[]) {
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
      constraints.push({
        when: co['when'] as Record<string, string>,
        then: 'skip',
      })
    }
  }

  const tags: string[] = []
  if (obj['tags'] !== undefined) {
    if (!Array.isArray(obj['tags'])) {
      return { ok: false, reason: 'spec.tags must be an array' }
    }
    for (const t of obj['tags'] as unknown[]) {
      if (typeof t !== 'string') {
        return { ok: false, reason: 'spec.tags entries must be strings' }
      }
      tags.push(t)
    }
  }

  return {
    ok: true,
    spec: { name: obj['name'], dimensions, strategy, constraints, tags },
  }
}

/** Compute a stable SHA-256 hash for a spec. Used by the sync gate. */
export function specHash(raw: string): string {
  // Normalise line endings and trim trailing whitespace before hashing
  const normalised = raw.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trimEnd()
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

function parseMinimalYaml(text: string): YamlValue {
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

  /** Skip blank lines and comment-only lines; return next significant line's indent. */
  peekIndent(minIndent: number): number {
    let i = this.pos
    while (i < this.lines.length) {
      const line = this.lines[i]!
      const trimmed = line.replace(/^\s+/, '')
      if (trimmed === '' || trimmed.startsWith('#')) { i++; continue }
      return line.length - trimmed.length
    }
    return -1
  }

  skipBlanks(): void {
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos]!
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) { this.pos++; continue }
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
  const lineIndent = line.length - line.trimStart().length

  if (lineIndent < indent) return null

  // Sequence block
  if (trimmed.startsWith('- ') || trimmed === '-') {
    return parseBlockSeq(ctx, lineIndent)
  }

  // Mapping block
  if (/^[a-zA-Z_][a-zA-Z0-9_\-]*\s*:/.test(trimmed) || /^"[^"]+"\s*:/.test(trimmed) || /^'[^']+'\s*:/.test(trimmed)) {
    return parseBlockMap(ctx, lineIndent)
  }

  // Scalar fallback
  ctx.consume()
  return parseScalar(trimmed.replace(/#.*$/, '').trim())
}

function parseBlockSeq(ctx: ParseCtx, indent: number): YamlValue[] {
  const items: YamlValue[] = []
  while (true) {
    ctx.skipBlanks()
    const line = ctx.peek()
    if (line === undefined) break
    const lineIndent = line.length - line.trimStart().length
    if (lineIndent < indent) break
    const trimmed = line.trim()
    if (!trimmed.startsWith('-')) break

    ctx.consume()
    const rest = trimmed.slice(1).trim().replace(/#.*$/, '').trim()

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

function parseSubKeysAfterDash(ctx: ParseCtx, indent: number): YamlValue | null {
  ctx.skipBlanks()
  const line = ctx.peek()
  if (line === undefined) return null
  const lineIndent = line.length - line.trimStart().length
  if (lineIndent < indent) return null
  const trimmed = line.trim()
  if (/^[a-zA-Z_][a-zA-Z0-9_\-]*\s*:/.test(trimmed)) {
    return parseBlockMap(ctx, lineIndent)
  }
  return null
}

function parseBlockMap(ctx: ParseCtx, indent: number): Record<string, YamlValue> {
  const obj: Record<string, YamlValue> = {}
  while (true) {
    ctx.skipBlanks()
    const line = ctx.peek()
    if (line === undefined) break
    const lineIndent = line.length - line.trimStart().length
    if (lineIndent < indent) break
    if (lineIndent > indent) break // Should not happen at this level

    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('-')) break

    const colonIdx = findMappingColon(trimmed)
    if (colonIdx < 0) break

    ctx.consume()
    const rawKey = trimmed.slice(0, colonIdx).trim()
    const key = unquote(rawKey)
    const valuePart = trimmed.slice(colonIdx + 1).replace(/#.*$/, '').trim()

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
        const nextIndent = next.length - next.trimStart().length
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

function findMappingColon(s: string): number {
  // Find the colon that separates key from value in a block map line.
  // Must not be inside quotes.
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue }
    if (c === ':' && !inSingle && !inDouble) {
      // Must be followed by space, end-of-string, or newline
      if (i + 1 >= s.length || s[i + 1] === ' ' || s[i + 1] === '\t') return i
    }
  }
  return -1
}

function parseFlowSeq(s: string): string[] {
  // Extract content between [ and ]
  const inner = s.replace(/^\[/, '').replace(/\].*$/, '')
  return inner
    .split(',')
    .map((t) => unquote(t.trim()))
    .filter((t) => t !== '')
}

function parseFlowMap(s: string): Record<string, string> {
  const inner = s.replace(/^\{/, '').replace(/\}.*$/, '')
  const obj: Record<string, string> = {}
  for (const pair of inner.split(',')) {
    const colonIdx = pair.indexOf(':')
    if (colonIdx < 0) continue
    const k = unquote(pair.slice(0, colonIdx).trim())
    const v = unquote(pair.slice(colonIdx + 1).trim())
    if (k !== '') obj[k] = v
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
