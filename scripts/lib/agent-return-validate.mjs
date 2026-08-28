// SPDX-License-Identifier: Apache-2.0
// scripts/lib/agent-return-validate.mjs
// Pure semantics export for the agent-return envelope (E1 #1943, M8 core + M12 citation).
// Shared by scripts/check-agent-return.mjs (gate) and scripts/record-agent-return.mjs
// (recorder): both validate against schemas/agent-return.schema.json BEFORE writing/passing,
// so a malformed return fails at hand-back time, not at gate time. The validator also
// encodes the M12 rule the design seals: a finding with kind:"structural" MUST carry >=1
// citation, and every citation must resolve (file exists at the envelope sha, line <= file
// length). A structural claim without a resolvable file:line is rejected at the tool layer.
//
// No entry point, no process.exit (see check-fail-closed-audit SKIP_FILES). Consumers own
// the exit contract. Pure deterministic — missing inputs throw / return errors, never a
// silent pass.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { execFileSync, execSync } from 'node:child_process'

/**
 * Resolve a $ref within the root schema (only local "#/$defs/Name" refs supported).
 * @param {string} ref
 * @param {Record<string, unknown>} rootSchema
 * @returns {Record<string, unknown>}
 */
function resolveRef(ref, rootSchema) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref: ${ref}`)
  const parts = ref.slice(2).split('/')
  let node = rootSchema
  for (const part of parts) {
    if (typeof node !== 'object' || node === null || !(part in node)) {
      throw new Error(`Cannot resolve $ref: ${ref}`)
    }
    node = /** @type {Record<string, unknown>} */ (node)[part]
  }
  return /** @type {Record<string, unknown>} */ (node)
}

/**
 * Minimal JSON Schema v7 validator (same subset as check-evidence-bundle.mjs):
 * type, required, additionalProperties, properties, enum, const, pattern, minLength,
 * minimum, maximum, format (date-time), items, $ref, $defs.
 * @param {unknown} value
 * @param {Record<string, unknown>} schemaNode
 * @param {Record<string, unknown>} rootSchema
 * @param {string} path
 * @returns {string[]}
 */
export function validateSchema(value, schemaNode, rootSchema, path) {
  /** @type {string[]} */
  const errors = []
  if ('$ref' in schemaNode) {
    const resolved = resolveRef(/** @type {string} */ (schemaNode['$ref']), rootSchema)
    return validateSchema(value, resolved, rootSchema, path)
  }
  if ('type' in schemaNode) {
    const expected = schemaNode['type']
    const actual = Array.isArray(value) ? 'array' : typeof value
    if (expected === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${path}: expected type "integer", got "${actual}"`)
        return errors
      }
    } else if (actual !== expected) {
      errors.push(`${path}: expected type "${expected}", got "${actual}"`)
      return errors
    }
  }
  if ('const' in schemaNode && value !== schemaNode['const']) {
    errors.push(
      `${path}: value ${JSON.stringify(value)} !== const ${JSON.stringify(schemaNode['const'])}`,
    )
  }
  if ('enum' in schemaNode && Array.isArray(schemaNode['enum'])) {
    if (!schemaNode['enum'].includes(value)) {
      errors.push(
        `${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schemaNode['enum'])}`,
      )
    }
  }
  if (typeof value === 'string') {
    if ('minLength' in schemaNode && typeof schemaNode['minLength'] === 'number') {
      if (value.length < schemaNode['minLength']) {
        errors.push(`${path}: string length ${value.length} < minLength ${schemaNode['minLength']}`)
      }
    }
    if ('pattern' in schemaNode && typeof schemaNode['pattern'] === 'string') {
      if (!new RegExp(schemaNode['pattern']).test(value)) {
        errors.push(`${path}: value "${value}" does not match pattern "${schemaNode['pattern']}"`)
      }
    }
    if (schemaNode['format'] === 'date-time') {
      if (Number.isNaN(Date.parse(value)))
        errors.push(`${path}: value "${value}" is not a valid date-time`)
    }
  }
  if (typeof value === 'number') {
    if (
      'minimum' in schemaNode &&
      typeof schemaNode['minimum'] === 'number' &&
      value < schemaNode['minimum']
    ) {
      errors.push(`${path}: value ${value} < minimum ${schemaNode['minimum']}`)
    }
    if (
      'maximum' in schemaNode &&
      typeof schemaNode['maximum'] === 'number' &&
      value > schemaNode['maximum']
    ) {
      errors.push(`${path}: value ${value} > maximum ${schemaNode['maximum']}`)
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = /** @type {Record<string, unknown>} */ (value)
    if ('required' in schemaNode && Array.isArray(schemaNode['required'])) {
      for (const req of schemaNode['required']) {
        if (!(req in obj)) errors.push(`${path}: missing required property "${req}"`)
      }
    }
    if (schemaNode['additionalProperties'] === false && 'properties' in schemaNode) {
      const allowed = new Set(
        Object.keys(/** @type {Record<string, unknown>} */ (schemaNode['properties'])),
      )
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) errors.push(`${path}: additional property "${key}" is not allowed`)
      }
    }
    if ('properties' in schemaNode && typeof schemaNode['properties'] === 'object') {
      const props = /** @type {Record<string, unknown>} */ (schemaNode['properties'])
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj) {
          errors.push(
            ...validateSchema(
              obj[key],
              /** @type {Record<string, unknown>} */ (propSchema),
              rootSchema,
              `${path}.${key}`,
            ),
          )
        }
      }
    }
  }
  if (Array.isArray(value)) {
    if (
      'items' in schemaNode &&
      typeof schemaNode['items'] === 'object' &&
      schemaNode['items'] !== null
    ) {
      const itemSchema = /** @type {Record<string, unknown>} */ (schemaNode['items'])
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateSchema(value[i], itemSchema, rootSchema, `${path}[${i}]`))
      }
    }
  }
  return errors
}

/**
 * Detect whether repoRoot is inside a git work tree.
 * @param {string} repoRoot
 * @returns {boolean}
 */
function isGitRepo(repoRoot) {
  try {
    const out = execSync('git rev-parse --is-inside-work-tree', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
    })
    return out.trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Resolve a citation against the envelope sha.
 * Production (git repo): `git cat-file -e <sha>:<file>` must succeed and the file content
 * at that sha must have >= `line` lines. Fail-closed — a bad sha or missing file at the
 * sha is a rejection, never a silent pass.
 * Non-git fixture dirs: fall back to the filesystem (test harness, not a real repo).
 * @param {string} repoRoot
 * @param {string} sha
 * @param {string} file
 * @param {number} line
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function resolveCitation(repoRoot, sha, file, line) {
  if (file === '' || isAbsolute(file)) {
    return { ok: false, reason: `citation file "${file}" is not repo-relative` }
  }
  const repoPath = resolve(repoRoot)
  const abs = resolve(repoPath, file)
  const lexical = relative(repoPath, abs)
  if (lexical === '' || lexical.startsWith('..') || isAbsolute(lexical)) {
    return { ok: false, reason: `citation file "${file}" escapes the repository` }
  }
  if (isGitRepo(repoRoot)) {
    let mode
    try {
      const treeEntry = execFileSync('git', ['ls-tree', '-z', sha, '--', file], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
      })
        .split('\0')
        .find((entry) => entry.length > 0)
      mode = treeEntry?.split(/[ \t]/, 1)[0]
    } catch {
      return { ok: false, reason: `citation file "${file}" does not resolve at sha ${sha}` }
    }
    if (mode !== '100644' && mode !== '100755') {
      return { ok: false, reason: `citation file "${file}" is not a regular file at sha ${sha}` }
    }
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}:${file}`], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 4000,
      })
    } catch {
      return { ok: false, reason: `citation file "${file}" does not resolve at sha ${sha}` }
    }
    let content = ''
    try {
      content = execFileSync('git', ['show', `${sha}:${file}`], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 6000,
      })
    } catch {
      return { ok: false, reason: `cannot read "${file}" at sha ${sha}` }
    }
    const lineCount = content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
    if (line > lineCount) {
      return { ok: false, reason: `citation line ${line} > file length ${lineCount} for "${file}"` }
    }
    return { ok: true }
  }
  // Non-git fallback (fixture dirs): resolve against the filesystem.
  if (!existsSync(abs)) {
    return { ok: false, reason: `citation file "${file}" does not resolve at repo root` }
  }
  let realRepoPath
  let realAbs
  try {
    realRepoPath = realpathSync(repoPath)
    realAbs = realpathSync(abs)
  } catch {
    return { ok: false, reason: `citation file "${file}" does not resolve at repo root` }
  }
  const realRelative = relative(realRepoPath, realAbs)
  if (realRelative === '' || realRelative.startsWith('..') || isAbsolute(realRelative)) {
    return { ok: false, reason: `citation file "${file}" escapes the repository` }
  }
  let content
  try {
    content = readFileSync(realAbs, 'utf-8')
  } catch {
    return { ok: false, reason: `cannot read citation file "${file}"` }
  }
  const lineCount = content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
  if (line > lineCount) {
    return { ok: false, reason: `citation line ${line} > file length ${lineCount} for "${file}"` }
  }
  return { ok: true }
}

/**
 * Enforce the M12 citation rule on a validated envelope: every structural finding MUST
 * carry >=1 citation, and every citation must resolve.
 * @param {Record<string, unknown>} envelopeParsed
 * @param {string} repoRoot
 * @param {string} envelopePath
 * @returns {string[]}
 */
export function enforceCitations(envelopeParsed, repoRoot, envelopePath) {
  /** @type {string[]} */
  const errors = []
  const sha = typeof envelopeParsed['sha'] === 'string' ? envelopeParsed['sha'] : 'HEAD'
  const findings = Array.isArray(envelopeParsed['findings']) ? envelopeParsed['findings'] : []
  for (let i = 0; i < findings.length; i++) {
    const f = /** @type {Record<string, unknown>} */ (findings[i])
    if (f['kind'] !== 'structural') continue
    const citations = Array.isArray(f['citations']) ? f['citations'] : []
    if (citations.length === 0) {
      errors.push(`${envelopePath}: findings[${i}] is structural but has no citations (M12)`)
      continue
    }
    for (let j = 0; j < citations.length; j++) {
      const c = /** @type {Record<string, unknown>} */ (citations[j])
      const file = typeof c['file'] === 'string' ? c['file'] : ''
      const line = typeof c['line'] === 'number' ? c['line'] : 0
      const r = resolveCitation(repoRoot, sha, file, line)
      if (!r.ok) errors.push(`${envelopePath}: findings[${i}].citations[${j}] — ${r.reason}`)
    }
  }
  return errors
}

/**
 * Load and parse a JSON schema file.
 * @param {string} schemaPath
 * @returns {Record<string, unknown>}
 */
export function loadSchema(schemaPath) {
  const abs = resolve(schemaPath)
  if (!existsSync(abs)) throw new Error(`schema not found: ${abs}`)
  return JSON.parse(readFileSync(abs, 'utf-8'))
}
