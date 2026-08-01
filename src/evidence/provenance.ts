// SPDX-License-Identifier: Apache-2.0
//
// Author provenance for evidence artifacts (#2164).
//
// Complements the existing evidence-gated-done principle: bundles already prove *what*
// existed at a given SHA; this module records *what produced it* (model/harness/config/gate
// snapshot/session) so a gate regression weeks later can be traced back to a code change vs.
// an agent/prompt/model change. Every field is either an opaque id or a sha256 digest — never
// file content or transcript text (AC-4). `model_id` has no derivable env source in this
// harness and must stay omitted rather than guessed (never invent a value that isn't
// observable).
//
// Shared by both evidence subsystems:
//   - schemas/evidence-bundle.schema.json / scripts/check-evidence-bundle.mjs (bundle path —
//     the JSON Schema stays the enforced source of truth there; `validateProvenance` here is
//     the TS-side mirror used by the SUMMARY.json path only).
//   - src/evidence/summary.ts / src/commands/verify.ts (SUMMARY.json path).
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ProvenanceConfigHashes {
  agents_md?: string
  claude_md?: string
  skills?: string[]
}

export interface Provenance {
  model_id?: string
  agent_harness?: string
  harness_version?: string
  gate_manifest_hash?: string
  session_id?: string
  config_hashes?: ProvenanceConfigHashes
}

// ─── validateProvenance ─────────────────────────────────────────────────────
// TS-side mirror of schemas/evidence-bundle.schema.json's `$defs.Provenance` /
// `$defs.ConfigHashes`. Loop over key lists rather than one hand-unrolled `if` per
// field — a per-field chain is exactly the near-duplicate shape the jscpd
// duplication ratchet (INV-109) flags, and the ratchet is upward-only.

const PROVENANCE_STRING_FIELDS = [
  'model_id',
  'agent_harness',
  'harness_version',
  'gate_manifest_hash',
  'session_id',
] as const

type ConfigHashKind = 'string' | 'stringArray'

const CONFIG_HASH_FIELD_KINDS: Record<string, ConfigHashKind> = {
  agents_md: 'string',
  claude_md: 'string',
  skills: 'stringArray',
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((e) => typeof e === 'string')
}

function validateConfigHashes(value: unknown): string[] {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push('provenance.config_hashes: expected an object')
    return errors
  }
  const obj = value as Record<string, unknown>

  const allowed = new Set(Object.keys(CONFIG_HASH_FIELD_KINDS))
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(`provenance.config_hashes: additional property "${key}" is not allowed`)
    }
  }

  for (const [field, kind] of Object.entries(CONFIG_HASH_FIELD_KINDS)) {
    if (!(field in obj)) continue
    const val = obj[field]
    const ok = kind === 'string' ? typeof val === 'string' : isStringArray(val)
    if (!ok) {
      errors.push(`provenance.config_hashes.${field}: invalid type`)
    }
  }

  return errors
}

/**
 * Validate a `provenance` value against the shape shared with
 * schemas/evidence-bundle.schema.json's `$defs.Provenance`. Used by the
 * SUMMARY.json path (src/evidence/summary.ts) — the bundle gate itself
 * validates against the JSON Schema directly.
 */
export function validateProvenance(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['provenance: expected an object']
  }
  const obj = value as Record<string, unknown>
  const errors: string[] = []

  const allowedTop = new Set<string>([...PROVENANCE_STRING_FIELDS, 'config_hashes'])
  for (const key of Object.keys(obj)) {
    if (!allowedTop.has(key)) {
      errors.push(`provenance: additional property "${key}" is not allowed`)
    }
  }

  for (const field of PROVENANCE_STRING_FIELDS) {
    if (field in obj && typeof obj[field] !== 'string') {
      errors.push(`provenance.${field}: expected type "string", got "${typeof obj[field]}"`)
    }
  }

  if ('config_hashes' in obj) {
    errors.push(...validateConfigHashes(obj['config_hashes']))
  }

  return errors
}

// ─── buildProvenance ────────────────────────────────────────────────────────

function isTruthy(val: string | undefined): boolean {
  return !!val && val !== '0' && val !== 'false'
}

/** sha256 of a file's raw bytes, or undefined when unreadable/absent. */
function hashFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return undefined
  }
}

/** sha256 of every `.claude/skills/<name>/SKILL.md`, or undefined when none exist. */
function hashSkills(root: string): string[] | undefined {
  const skillsDir = join(root, '.claude', 'skills')
  if (!existsSync(skillsDir)) return undefined
  let entries: string[]
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return undefined
  }
  const hashes: string[] = []
  for (const name of entries) {
    const h = hashFile(join(skillsDir, name, 'SKILL.md'))
    if (h) hashes.push(h)
  }
  return hashes.length > 0 ? hashes : undefined
}

function buildConfigHashes(root: string): ProvenanceConfigHashes | undefined {
  const agentsMd = hashFile(join(root, 'AGENTS.md'))
  const claudeMd = hashFile(join(root, '.claude', 'CLAUDE.md'))
  const skills = hashSkills(root)
  if (!agentsMd && !claudeMd && !skills) return undefined

  const result: ProvenanceConfigHashes = {}
  if (agentsMd) result.agents_md = agentsMd
  if (claudeMd) result.claude_md = claudeMd
  if (skills) result.skills = skills
  return result
}

/** Structural parse of the `/versions/<x>/` segment — never an opaque-format guess. */
function parseHarnessVersion(execPath: string | undefined): string | undefined {
  if (!execPath) return undefined
  const parts = execPath.split('/')
  const idx = parts.indexOf('versions')
  if (idx === -1 || idx + 1 >= parts.length) return undefined
  return parts[idx + 1]
}

/**
 * Build the provenance block from what is genuinely observable in `env`/`root` —
 * never inventing a value (e.g. `model_id`, which no env var carries in this
 * harness, stays omitted). Returns undefined when nothing is derivable at all.
 */
export function buildProvenance(
  root: string,
  env: Record<string, string | undefined>,
): Provenance | undefined {
  const result: Provenance = {}

  if (isTruthy(env['CLAUDECODE'])) {
    result.agent_harness = 'claude-code'
  }

  const harnessVersion = parseHarnessVersion(env['CLAUDE_CODE_EXECPATH'])
  if (harnessVersion) result.harness_version = harnessVersion

  const sessionId = env['CLAUDE_CODE_SESSION_ID']
  if (sessionId) result.session_id = sessionId

  const configHashes = buildConfigHashes(root)
  if (configHashes) result.config_hashes = configHashes

  const gateManifestHash = hashFile(join(root, 'scripts', 'check-all.mjs'))
  if (gateManifestHash) result.gate_manifest_hash = gateManifestHash

  return Object.keys(result).length > 0 ? result : undefined
}

// ─── formatProvenance ───────────────────────────────────────────────────────

/** Render populated provenance fields as text lines (CLI `verify evidence` output). */
export function formatProvenance(p: Provenance): string[] {
  const lines: string[] = []
  if (p.model_id) lines.push(`provenance.model_id: ${p.model_id}`)
  if (p.agent_harness) lines.push(`provenance.agent_harness: ${p.agent_harness}`)
  if (p.harness_version) lines.push(`provenance.harness_version: ${p.harness_version}`)
  if (p.session_id) lines.push(`provenance.session_id: ${p.session_id}`)
  if (p.gate_manifest_hash) lines.push(`provenance.gate_manifest_hash: ${p.gate_manifest_hash}`)
  if (p.config_hashes?.agents_md) {
    lines.push(`provenance.config_hashes.agents_md: ${p.config_hashes.agents_md}`)
  }
  if (p.config_hashes?.claude_md) {
    lines.push(`provenance.config_hashes.claude_md: ${p.config_hashes.claude_md}`)
  }
  if (p.config_hashes?.skills && p.config_hashes.skills.length > 0) {
    lines.push(`provenance.config_hashes.skills: ${p.config_hashes.skills.length} skill(s)`)
  }
  return lines
}
