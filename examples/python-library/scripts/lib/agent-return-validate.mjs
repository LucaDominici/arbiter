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
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

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
 * Keywords this validator actually enforces. Anything outside this set is reported as an
 * error rather than skipped (#2509) — a subset validator that silently ignores what it does
 * not implement lets a schema declare a constraint that never runs, which is how
 * id-registry (minItems), cross-model-dispatch (maxItems) and the vendored c4-model
 * (anyOf, minItems) all shipped with dead rules.
 */
const ENFORCED_KEYWORDS = new Set([
  '$ref',
  'type',
  'const',
  'enum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'required',
  'additionalProperties',
  'properties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
])

/** Metadata that constrains nothing, so carries no enforcement obligation. */
const ANNOTATION_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'examples',
  'default',
  'definitions',
  '$defs',
  'deprecated',
  'readOnly',
  'writeOnly',
])

/**
 * Keywords present on this node that the validator cannot honour. `additionalProperties`
 * is special-cased: the `false` form is enforced, the schema form is not.
 * @param {Record<string, unknown>} schemaNode
 * @returns {string[]}
 */
function unsupportedKeywords(schemaNode) {
  const unsupported = []
  for (const key of Object.keys(schemaNode)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue
    if (!ENFORCED_KEYWORDS.has(key)) {
      unsupported.push(key)
      continue
    }
    if (
      key === 'additionalProperties' &&
      typeof schemaNode[key] === 'object' &&
      schemaNode[key] !== null
    ) {
      unsupported.push('additionalProperties (schema form)')
    }
  }
  return unsupported
}

/**
 * allOf / anyOf / oneOf / not / if-then-else. Branch failures are summarised rather than
 * forwarded verbatim: an anyOf that fails every branch should read as one rejection, not
 * as the union of every branch's complaints.
 * @param {unknown} value
 * @param {Record<string, unknown>} schemaNode
 * @param {Record<string, unknown>} rootSchema
 * @param {string} path
 * @returns {string[]}
 */
function validateCombinators(value, schemaNode, rootSchema, path) {
  const ctx = { value, schemaNode, rootSchema, path }
  return [
    ...validateAllOf(ctx),
    ...validateAnyOf(ctx),
    ...validateOneOf(ctx),
    ...validateNot(ctx),
    ...validateConditional(ctx),
  ]
}

/**
 * @typedef {{ value: unknown, schemaNode: Record<string, unknown>,
 *             rootSchema: Record<string, unknown>, path: string }} CombinatorCtx
 */

/** Branch list under `key`, normalised to an array. @param {CombinatorCtx} ctx @param {string} key */
function branchesOf(ctx, key) {
  return /** @type {Record<string, unknown>[]} */ (
    Array.isArray(ctx.schemaNode[key]) ? ctx.schemaNode[key] : []
  )
}

/** Does `value` satisfy one branch? @param {CombinatorCtx} ctx @param {Record<string, unknown>} sub */
function branchMatches(ctx, sub) {
  return validateSchema(ctx.value, sub, ctx.rootSchema, ctx.path).length === 0
}

/** @param {CombinatorCtx} ctx @returns {string[]} */
function validateAllOf(ctx) {
  const errors = []
  for (const sub of branchesOf(ctx, 'allOf')) {
    errors.push(...validateSchema(ctx.value, sub, ctx.rootSchema, ctx.path))
  }
  return errors
}

/** @param {CombinatorCtx} ctx @returns {string[]} */
function validateAnyOf(ctx) {
  if (!('anyOf' in ctx.schemaNode)) return []
  const branches = branchesOf(ctx, 'anyOf')
  if (branches.some((sub) => branchMatches(ctx, sub))) return []
  return [`${ctx.path}: value matches none of the ${branches.length} anyOf branches`]
}

/** @param {CombinatorCtx} ctx @returns {string[]} */
function validateOneOf(ctx) {
  if (!('oneOf' in ctx.schemaNode)) return []
  const hits = branchesOf(ctx, 'oneOf').filter((sub) => branchMatches(ctx, sub)).length
  if (hits === 1) return []
  return [`${ctx.path}: value matches ${hits} oneOf branches, expected exactly 1`]
}

/** @param {CombinatorCtx} ctx @returns {string[]} */
function validateNot(ctx) {
  const sub = ctx.schemaNode['not']
  if (typeof sub !== 'object' || sub === null) return []
  if (!branchMatches(ctx, /** @type {Record<string, unknown>} */ (sub))) return []
  return [`${ctx.path}: value must NOT match the "not" schema, but does`]
}

/** @param {CombinatorCtx} ctx @returns {string[]} */
function validateConditional(ctx) {
  const condition = ctx.schemaNode['if']
  if (typeof condition !== 'object' || condition === null) return []
  const taken = branchMatches(ctx, /** @type {Record<string, unknown>} */ (condition))
    ? ctx.schemaNode['then']
    : ctx.schemaNode['else']
  if (typeof taken !== 'object' || taken === null) return []
  return validateSchema(
    ctx.value,
    /** @type {Record<string, unknown>} */ (taken),
    ctx.rootSchema,
    ctx.path,
  )
}

/**
 * Array cardinality and uniqueness. Uniqueness compares by serialised form, which is
 * adequate for the schemas in this repo (scalars and flat records).
 * @param {unknown[]} value
 * @param {Record<string, unknown>} schemaNode
 * @param {string} path
 * @returns {string[]}
 */
function validateArrayConstraints(value, schemaNode, path) {
  const errors = []
  const min = schemaNode['minItems']
  const max = schemaNode['maxItems']
  if (typeof min === 'number' && value.length < min) {
    errors.push(`${path}: array length ${value.length} < minItems ${min}`)
  }
  if (typeof max === 'number' && value.length > max) {
    errors.push(`${path}: array length ${value.length} > maxItems ${max}`)
  }
  if (schemaNode['uniqueItems'] === true) {
    const seen = new Set(value.map((v) => JSON.stringify(v)))
    if (seen.size !== value.length) errors.push(`${path}: array items are not unique`)
  }
  return errors
}

/**
 * Exclusive numeric bounds (draft-07 numeric form). The inclusive pair is handled inline.
 * @param {number} value
 * @param {Record<string, unknown>} schemaNode
 * @param {string} path
 * @returns {string[]}
 */
function validateExclusiveBounds(value, schemaNode, path) {
  const errors = []
  const exMin = schemaNode['exclusiveMinimum']
  const exMax = schemaNode['exclusiveMaximum']
  if (typeof exMin === 'number' && value <= exMin) {
    errors.push(`${path}: value ${value} <= exclusiveMinimum ${exMin}`)
  }
  if (typeof exMax === 'number' && value >= exMax) {
    errors.push(`${path}: value ${value} >= exclusiveMaximum ${exMax}`)
  }
  return errors
}

/**
 * JSON Schema draft-07 validator over the keyword set in `ENFORCED_KEYWORDS`:
 * type, required, additionalProperties (false form), properties, enum, const, pattern,
 * minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum,
 * format (date-time), items, minItems, maxItems, uniqueItems, allOf, anyOf, oneOf, not,
 * if/then/else, $ref (into `definitions` or `$defs`).
 *
 * Any keyword outside that set is REPORTED, not skipped (#2509) — see `unsupportedKeywords`.
 * @param {unknown} value
 * @param {Record<string, unknown>} schemaNode
 * @param {Record<string, unknown>} rootSchema
 * @param {string} path
 * @returns {string[]}
 */
export function validateSchema(value, schemaNode, rootSchema, path) {
  /** @type {string[]} */
  const errors = []
  for (const kw of unsupportedKeywords(schemaNode)) {
    errors.push(`${path}: schema uses "${kw}", which this validator does not support (#2509)`)
  }
  errors.push(...validateCombinators(value, schemaNode, rootSchema, path))
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
    if ('maxLength' in schemaNode && typeof schemaNode['maxLength'] === 'number') {
      if (value.length > schemaNode['maxLength']) {
        errors.push(`${path}: string length ${value.length} > maxLength ${schemaNode['maxLength']}`)
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
    errors.push(...validateExclusiveBounds(value, schemaNode, path))
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
    errors.push(...validateArrayConstraints(value, schemaNode, path))
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
  if (isGitRepo(repoRoot)) {
    try {
      execSync(`git cat-file -e ${sha}:${file}`, {
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
      content = execSync(`git show ${sha}:${file}`, {
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
  const abs = resolve(repoRoot, file)
  if (!existsSync(abs)) {
    return { ok: false, reason: `citation file "${file}" does not resolve at repo root` }
  }
  const content = readFileSync(abs, 'utf-8')
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
