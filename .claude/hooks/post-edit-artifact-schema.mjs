#!/usr/bin/env node
// Arbiter hook: validate an edited ontology artifact against its registered schema (INV-142)
// Fires on: PostToolUse → Edit|Write
//
// A schema checked only in CI teaches the agent an hour late, after a commit and a push, when the
// cheapest moment to learn was the edit itself. This hook moves the same contract to the edit.
//
// REGISTERED below is the whole mechanism. Each wave that lands an artifact type adds ONE line and
// that type becomes edit-time enforced — which is why there is one hook here rather than one per
// artifact. The decision logic is exported as pure functions so it can be tested without writing
// fixtures into the live SSOT or into a real evidence directory (INV-139).
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const hookDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(hookDir, '..', '..')

/**
 * Registered artifact instances. `extract` says how to get the document out of the file:
 *   'json'            — the whole file is the document
 *   'yaml'            — the whole file is YAML
 *   'sentinel:<NAME>' — a ```json fence between <!-- NAME_START --> and <!-- NAME_END -->
 * A `path` ending in '/' is a directory prefix (optionally narrowed by `suffix`); otherwise it is
 * an exact repo-relative file. Paths are POSIX.
 *
 * This table is the whole mechanism, and until #2480 wave 8 it was ALSO the whole gap: four rows
 * of docs/internal/SYSTEM/ID-REGISTRY.md named this hook in their `hook` column while nothing here
 * matched their SSOT, so the hook would never have fired on a milestone, an epic, a source record
 * or a use case. `scripts/check-ontology-wired.mjs` now resolves each registry row's SSOT through
 * `selectEntry` below, so a row cannot claim edit-time enforcement this table does not provide.
 */
export const REGISTERED = [
  {
    path: 'docs/internal/SYSTEM/ID-REGISTRY.md',
    schema: 'schemas/id-registry.schema.json',
    extract: 'sentinel:ID_REGISTRY',
  },
  {
    path: '.arbiter/evidence/agent-returns/',
    schema: 'schemas/agent-return.schema.json',
    extract: 'json',
    suffix: '.json',
  },
  {
    // MS-NN and EP-NN share this SSOT, and it is the richest schema in the tree — a granularity
    // decay rule, a GSN goal shape, and the epic join. Learning at the edit that a `later`
    // milestone may not carry a `due` date is worth an order of magnitude more than learning it
    // from a CI log.
    path: 'docs/internal/PRODUCT/MILESTONES.yml',
    schema: 'schemas/milestone.schema.json',
    extract: 'yaml',
  },
]

/** The registered entry governing a repo-relative POSIX path, or undefined. */
export function selectEntry(rel, registered = REGISTERED) {
  return registered.find((e) =>
    e.path.endsWith('/')
      ? rel.startsWith(e.path) && (!e.suffix || rel.endsWith(e.suffix))
      : rel === e.path,
  )
}

/**
 * Pull the document out of the file text per the entry's extract mode.
 * @returns {{ ok: true, document: unknown } | { ok: false, error: string }}
 */
export function extractDocument(entry, text) {
  let payload = text
  if (entry.extract.startsWith('sentinel:')) {
    const name = entry.extract.slice('sentinel:'.length)
    const start = text.indexOf(`<!-- ${name}_START -->`)
    const end = text.indexOf(`<!-- ${name}_END -->`)
    if (start === -1 || end === -1 || end < start) {
      return {
        ok: false,
        error: `lost its ${name}_START/${name}_END sentinels — that block is what every consumer parses`,
      }
    }
    const fence = /```json\n([\s\S]*?)\n```/.exec(text.slice(start, end))
    if (!fence) return { ok: false, error: `has no \`\`\`json fence between the ${name} sentinels` }
    payload = fence[1]
  }
  if (entry.extract === 'yaml') {
    // Parsed by the caller, which can await the import; a synchronous require would tie this hook
    // to CJS and the repo is ESM throughout.
    return { ok: true, document: undefined, yaml: payload }
  }
  try {
    return { ok: true, document: JSON.parse(payload) }
    // FAIL-OPEN-INTENT: malformed JSON is returned as a blocking result by the caller (exit 2), not thrown.
  } catch (err) {
    return { ok: false, error: `is not valid JSON — ${err.message}` }
  }
}

/**
 * Parse the YAML an entry deferred. Separated from extractDocument so that function stays
 * synchronous and pure for the unit tests, and so a missing `yaml` package fails OPEN here rather
 * than turning every edit into a block.
 * @returns {{ ok: true, document: unknown } | { ok: false, error: string } | null} null = fail open
 */
export async function parseYamlPayload(text) {
  let YAML
  try {
    ;({ default: YAML } = await import('yaml'))
    // FAIL-OPEN-INTENT: the hook's own dependency is not the edit's fault; blocking an unrelated write because `yaml` could not be resolved is worse than the failure it prevents, and the CI gate re-reads the file.
  } catch {
    return null
  }
  try {
    return { ok: true, document: YAML.parse(text) }
    // FAIL-OPEN-INTENT: malformed YAML is returned as a blocking result by the caller (exit 2), not thrown — the same contract the JSON path above uses.
  } catch (err) {
    return { ok: false, error: `is not valid YAML — ${err.message}` }
  }
}

async function main() {
  const { resolveToolInputPath } = await import('./lib.mjs')
  const file = resolveToolInputPath()
  if (!file || !existsSync(file)) return 0
  if (!file.startsWith(repoRoot)) return 0

  const rel = relative(repoRoot, file).split(sep).join('/')
  const entry = selectEntry(rel)
  if (!entry) return 0

  let text
  try {
    text = readFileSync(file, 'utf-8')
    // FAIL-OPEN-INTENT: an unreadable file was just written by another tool and is not this hook's to adjudicate; the CI gate re-reads it.
  } catch {
    return 0
  }

  let extracted = extractDocument(entry, text)
  if (extracted.ok && entry.extract === 'yaml') {
    const parsed = await parseYamlPayload(extracted.yaml)
    if (parsed === null) return 0
    extracted = parsed
  }
  if (!extracted.ok) {
    process.stderr.write(`[arbiter] INV-142: ${rel} ${extracted.error}\n`)
    return 2
  }

  // Imported lazily and failing OPEN: a guard that blocks an unrelated edit because its own
  // dependency moved is a worse failure than the one it prevents. The CI gate is the backstop.
  let validateSchema, loadSchema
  try {
    ;({ validateSchema, loadSchema } = await import(
      join(repoRoot, 'scripts', 'lib', 'agent-return-validate.mjs')
    ))
    // FAIL-OPEN-INTENT: INV-142 fails OPEN on its own infrastructure: if the validator cannot be imported, blocking an unrelated edit is worse than the failure it prevents. The CI gate is the backstop.
  } catch {
    return 0
  }
  let schema
  try {
    schema = loadSchema(join(repoRoot, entry.schema))
    // FAIL-OPEN-INTENT: same fail-open contract: an unloadable schema must not block an edit it cannot judge.
  } catch {
    return 0
  }

  const label = entry.schema.replace(/^schemas\//, '').replace(/\.schema\.json$/, '')
  const errors = validateSchema(extracted.document, schema, schema, label)
  if (errors.length > 0) {
    process.stderr.write(`[arbiter] INV-142: ${rel} violates ${entry.schema}:\n`)
    for (const e of errors.slice(0, 5)) process.stderr.write(`  ${e}\n`)
    if (errors.length > 5) process.stderr.write(`  ...and ${errors.length - 5} more\n`)
    return 2
  }
  return 0
}

// Exit 2 is the ONLY blocking code under the Claude Code hook protocol: it feeds the violation
// back to the agent. Exit 1 prints and the agent never sees it, so the guard would be decoration.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await main())
  } catch (err) {
    // An unexpected fault in the hook itself is surfaced, not swallowed — but it exits 1, which
    // under the hook protocol prints without blocking. Blocking every edit because this guard
    // broke would be the larger failure; the CI gate still refuses the artifact.
    process.stderr.write(`[arbiter] INV-142: hook fault — ${err.message}\n`)
    process.exit(1)
  }
}
