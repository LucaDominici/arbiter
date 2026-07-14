#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: E1 (#1943, M8 core) — agent-return envelope recorder. The orchestrator pipes a
// CATALOG: sub-agent's JSON return through this recorder, which (a) validates it against
// CATALOG: schemas/agent-return.schema.json BEFORE writing — a malformed return fails at
// CATALOG: hand-back time, not at gate time; (b) stamps branch/sha/ts itself (never trusted
// CATALOG: from input, same authority model as gate-pass.json written by check-all.mjs);
// CATALOG: (c) writes .arbiter/evidence/agent-returns/<sanitized-task>/<agent>-<n>.json.
// CATALOG: Rejected fold-in into check-agent-return.mjs: that VALIDATES the persisted corpus
// CATALOG: at gate time; this RECORDS a single return at hand-back time with authority-stamped
// CATALOG: provenance. Different lifecycle (write-path vs read-path), shared validator lib.
//
//INV-137 (advisory at land-time per design §0).
// Exit codes (INV-53): 0 written, 1 invalid input (schema/M12 violation — nothing written),
// 2 ERROR (self / IO failure).
//
// Usage:
//   node scripts/record-agent-return.mjs --task '#NNN' [--evidence-dir=<path>]
//                                       [--repo-root=<path>] < return.json
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateSchema, enforceCitations, loadSchema } from './lib/agent-return-validate.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')

function arg(flag, argv) {
  const i = argv.indexOf(`--${flag}`)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  const eq = argv.find((x) => x.startsWith(`--${flag}=`))
  return eq ? eq.slice(`--${flag}=`.length) : null
}

const argv = process.argv.slice(2)
const TASK_ID = arg('task', argv)
const EVIDENCE_DIR = arg('evidence-dir', argv)
  ? resolve(arg('evidence-dir', argv))
  : join(repoDefault, '.arbiter', 'evidence', 'agent-returns')
const REPO_ROOT = arg('repo-root', argv) ? resolve(arg('repo-root', argv)) : repoDefault
const SCHEMA_PATH = join(repoDefault, 'schemas', 'agent-return.schema.json')

function readStdin() {
  return new Promise((resolveRead) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolveRead(data))
    process.stdin.on('error', () => resolveRead(''))
  })
}

function stampProvenance() {
  let branch = 'unknown'
  let sha = '0000000'
  try {
    branch =
      execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim() || 'unknown'
    // FAIL-OPEN-INTENT: git rev-parse --abbrev-ref HEAD failed — non-git fixture dir; branch defaults to "unknown" (stamped, not trusted from input).
  } catch {
    /* non-git fixture */
  }
  try {
    sha =
      execSync('git rev-parse HEAD', {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
      })
        .trim()
        .slice(0, 40) || '0000000'
    // FAIL-OPEN-INTENT: git rev-parse HEAD failed — non-git fixture dir; sha defaults to "0000000" (stamped, not trusted from input).
  } catch {
    /* non-git fixture */
  }
  return { branch, sha, ts: new Date().toISOString() }
}

async function main() {
  if (!TASK_ID || !/^#[0-9]+$/.test(TASK_ID)) {
    process.stderr.write(
      `[record-agent-return] ERROR: --task must be a GitHub issue id like '#1943' (got: ${String(TASK_ID)})\n`,
    )
    return 2
  }
  const raw = await readStdin()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    process.stdout.write(
      `[record-agent-return] FAIL: invalid JSON stdin: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 1
  }
  let schema
  try {
    schema = loadSchema(SCHEMA_PATH)
  } catch (err) {
    process.stderr.write(
      `[record-agent-return] ERROR: cannot load schema: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
  // The agent supplies everything EXCEPT provenance (branch/sha/ts). The recorder stamps
  // those itself — never trusted from input — then validates the FULL stamped envelope
  // against the schema before writing. A malformed return fails at hand-back time.
  const stamped = stampProvenance()
  const env = /** @type {Record<string, unknown>} */ (parsed)
  env['branch'] = stamped.branch
  env['sha'] = stamped.sha
  env['ts'] = stamped.ts
  const schemaErrors = validateSchema(env, schema, schema, '<stdin>')
  if (schemaErrors.length > 0) {
    for (const e of schemaErrors) process.stdout.write(`[record-agent-return] FAIL: ${e}\n`)
    return 1
  }
  const citationErrors = enforceCitations(env, REPO_ROOT, '<stdin>')
  if (citationErrors.length > 0) {
    for (const e of citationErrors) process.stdout.write(`[record-agent-return] FAIL: ${e}\n`)
    return 1
  }
  const sanitizedTask = TASK_ID.replace(/[^0-9A-Za-z-]/g, '_')
  const taskDir = join(EVIDENCE_DIR, sanitizedTask)
  try {
    mkdirSync(taskDir, { recursive: true })
  } catch (err) {
    process.stderr.write(
      `[record-agent-return] ERROR: cannot mkdir ${taskDir}: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
  const agent =
    typeof env['agent'] === 'string' ? String(env['agent']).replace(/[^0-9A-Za-z-]/g, '-') : 'agent'
  let n = 0
  try {
    n = readdirSync(taskDir).filter((f) => f.startsWith(`${agent}-`) && f.endsWith('.json')).length
    // FAIL-OPEN-INTENT: readdirSync on a fresh taskDir for the agent counter — empty dir → 0 is the correct shard index.
  } catch {
    /* empty → 0 */
  }
  const outPath = join(taskDir, `${agent}-${n}.json`)
  try {
    writeFileSync(outPath, `${JSON.stringify(env, null, 2)}\n`)
  } catch (err) {
    process.stderr.write(
      `[record-agent-return] ERROR: cannot write ${outPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
  process.stdout.write(`[record-agent-return] OK — wrote ${outPath}\n`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `[record-agent-return] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  })
