#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: E1 (#1943, M8 core + M12 citation) — agent-return envelope gate. Validates every
// CATALOG: file under .arbiter/evidence/agent-returns/** against schemas/agent-return.schema.json,
// CATALOG: enforces the M12 rule (a structural finding without a resolvable file:line citation is
// CATALOG: rejected at the tool layer), and under --enforce cross-checks the dispatch sidecar
// CATALOG: (.arbiter/agents-dispatched.json) so dispatched agents whose returns evaporated into
// CATALOG: the context window (the R1 signature) cannot pass silently.
// CATALOG: Rejected fold-in into check-evidence-bundle.mjs: that validates the per-task TDD
// CATALOG: evidence-bundle shape (gateResult/redTest/greenTest), a different envelope with its own
// CATALOG: schema and lifecycle; the agent-return envelope carries verdict/findings/citations and
// CATALOG: a citation-resolution step that has no analog in the bundle validator. Different shape,
// CATALOG: different failure surface — merging would conflate two drift models (CANON-21).
//
//INV-138 (advisory at land-time per design §0; promoted on owner ratification).
// Exit codes (INV-53): 0 PASS, 1 FAIL (envelope violations / evaporated returns), 2 ERROR (self).
//
// Usage:
//   node scripts/check-agent-return.mjs [--evidence-dir=<path>] [--schema=<path>]
//                                       [--repo-root=<path>] [--sidecar=<path>] [--enforce]
// Vacuous pass when no envelopes exist (nothing to validate). --enforce promotes the dispatch
// cross-check from advisory to hard.
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSchema, enforceCitations, loadSchema } from './lib/agent-return-validate.mjs'
import { arg } from './lib/gate-args.mjs'
import { isForeignSidecar } from './lib/evidence-binding.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const EVIDENCE_DIR = arg('evidence-dir', argv)
  ? resolve(arg('evidence-dir', argv))
  : join(repoDefault, '.arbiter', 'evidence', 'agent-returns')
const SCHEMA_PATH = arg('schema', argv)
  ? resolve(arg('schema', argv))
  : join(repoDefault, 'schemas', 'agent-return.schema.json')
const REPO_ROOT = arg('repo-root', argv) ? resolve(arg('repo-root', argv)) : repoDefault
const SIDECAR = arg('sidecar', argv)
  ? resolve(arg('sidecar', argv))
  : join(repoDefault, '.arbiter', 'agents-dispatched.json')
const ENFORCE = argv.includes('--enforce')

/**
 * Task the cross-check below belongs to: `--task` when given, else the task state on disk.
 * FAIL-OPEN-INTENT: `undefined` ("unknown task") is the STRICT side — nothing can be proven
 * foreign, so the R1 cross-check runs exactly as it did before #2399. Only a sidecar that
 * PROVABLY belongs to another task is skipped.
 */
function activeTaskId() {
  if (arg('task', argv)) return arg('task', argv)
  try {
    const parsed = JSON.parse(
      readFileSync(join(REPO_ROOT, '.claude', '.task', 'status.json'), 'utf-8'),
    )
    return typeof parsed?.taskId === 'string' ? parsed.taskId : undefined
    // FAIL-OPEN-INTENT: an unreadable task document means "unknown task" - the STRICT side, since nothing can then be proven foreign and every R1 cross-check below still runs.
  } catch {
    return undefined
  }
}

function main() {
  if (!existsSync(EVIDENCE_DIR)) {
    process.stdout.write('[check-agent-return] OK — evidence dir not found, vacuous pass\n')
    return 0
  }
  let schema
  try {
    schema = loadSchema(SCHEMA_PATH)
  } catch (err) {
    process.stderr.write(
      `[check-agent-return] ERROR: cannot load schema: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }

  /** @type {string[]} */
  const envelopeFiles = []
  try {
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        const st = statSync(full)
        if (st.isDirectory()) walk(full)
        else if (entry.endsWith('.json')) envelopeFiles.push(full)
      }
    }
    walk(EVIDENCE_DIR)
  } catch (err) {
    process.stderr.write(
      `[check-agent-return] ERROR: cannot walk evidence dir: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }

  let violations = 0
  let checked = 0
  for (const file of envelopeFiles) {
    checked++
    /** @type {unknown} */
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf-8'))
    } catch (err) {
      process.stdout.write(
        `[check-agent-return] FAIL: invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}\n`,
      )
      violations++
      continue
    }
    const schemaErrors = validateSchema(parsed, schema, schema, file)
    for (const e of schemaErrors) process.stdout.write(`[check-agent-return] FAIL: ${e}\n`)
    if (schemaErrors.length > 0) {
      violations++
      continue
    }
    const citationErrors = enforceCitations(
      /** @type {Record<string, unknown>} */ (parsed),
      REPO_ROOT,
      file,
    )
    for (const e of citationErrors) process.stdout.write(`[check-agent-return] FAIL: ${e}\n`)
    if (citationErrors.length > 0) violations++
  }

  // Dispatch cross-check (--enforce): sidecar records dispatched agents for the branch;
  // zero envelopes for a task that dispatched >0 ⇒ the R1 signature (returns evaporated).
  if (ENFORCE && existsSync(SIDECAR)) {
    try {
      const sidecar = JSON.parse(readFileSync(SIDECAR, 'utf-8'))
      // #2399: the tracked sidecar is shared by every branch — one recorded for another
      // task says nothing about THIS task's returns, so it counts as absent (an unknown
      // active task proves nothing and keeps the cross-check armed).
      const foreign = isForeignSidecar(sidecar, activeTaskId())
      if (foreign) {
        process.stdout.write(
          `[check-agent-return] dispatch sidecar belongs to task ${sidecar.taskId ?? sidecar.task} — ignored for this task\n`,
        )
      }
      const count =
        typeof sidecar === 'object' && sidecar && typeof sidecar['count'] === 'number'
          ? sidecar['count']
          : 0
      if (!foreign && count > 0 && checked === 0) {
        process.stdout.write(
          `[check-agent-return] FAIL: sidecar records ${count} dispatched agent(s) but zero return envelopes exist — findings evaporated into the context window (R1)\n`,
        )
        violations++
      }
    } catch (err) {
      process.stderr.write(
        `[check-agent-return] ERROR: cannot read sidecar ${SIDECAR}: ${err instanceof Error ? err.message : String(err)}\n`,
      )
      return 2
    }
  }

  if (violations > 0) {
    process.stdout.write(
      `[check-agent-return] FAIL: ${violations} envelope(s) failed (${checked} checked)\n`,
    )
    return 1
  }
  process.stdout.write(`[check-agent-return] OK — ${checked} agent-return envelope(s) passed\n`)
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(
    `[check-agent-return] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
