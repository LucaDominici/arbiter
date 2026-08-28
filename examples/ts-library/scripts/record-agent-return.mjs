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
//INV-138 (advisory at land-time per design §0).
// Exit codes (INV-53): 0 written, 1 invalid input (schema/M12 violation — nothing written),
// 2 ERROR (self / IO failure).
//
// Usage:
//   node scripts/record-agent-return.mjs --task '#NNN' [--evidence-dir=<path>]
//                                       [--repo-root=<path>] < return.json
import {
  constants as fsConstants,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateSchema, enforceCitations, loadSchema } from './lib/agent-return-validate.mjs'
import { arg } from './lib/gate-args.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const TASK_ID = arg('task', argv)
const PROVENANCE_VENDOR = arg('provenance-vendor', argv)
const PROVENANCE_CLI = arg('provenance-cli', argv)
const PROVENANCE_CLI_VERSION = arg('provenance-cli-version', argv)
const PROVENANCE_DISPATCH = arg('provenance-dispatch', argv)
const REPO_ROOT = arg('repo-root', argv) ? resolve(arg('repo-root', argv)) : repoDefault
const EVIDENCE_DIR = arg('evidence-dir', argv)
  ? resolve(arg('evidence-dir', argv))
  : join(REPO_ROOT, '.arbiter', 'evidence', 'agent-returns')
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

function stampAgentProvenance() {
  const provenance = {
    vendor: PROVENANCE_VENDOR ?? 'anthropic',
    dispatch: PROVENANCE_DISPATCH ?? 'subagent',
  }
  if (PROVENANCE_CLI !== null) provenance.cli = PROVENANCE_CLI
  if (PROVENANCE_CLI_VERSION !== null) provenance.cliVersion = PROVENANCE_CLI_VERSION
  return provenance
}

function descriptorPath(fd) {
  return `${process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'}/${fd}`
}

function openContainedDirectory(rootDir, childParts) {
  if (process.platform === 'win32') {
    throw new Error('secure agent-return recording is unsupported on Windows')
  }
  const flags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW
  const absoluteRoot = resolve(rootDir)
  let fd = -1
  try {
    fd = openSync('/', flags)
    for (const part of [...absoluteRoot.split('/').filter(Boolean), ...childParts]) {
      const child = join(descriptorPath(fd), part)
      try {
        mkdirSync(child)
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err
      }
      const next = openSync(child, flags)
      closeSync(fd)
      fd = next
    }
    return fd
  } catch (err) {
    if (fd !== -1) closeSync(fd)
    throw err
  }
}

function writeEnvelopeContained(evidenceDir, task, agent, content) {
  let dirFd = -1
  try {
    dirFd = openContainedDirectory(evidenceDir, [task])
    const dirPath = descriptorPath(dirFd)
    let n = 0
    try {
      n = readdirSync(dirPath).filter(
        (f) => f.startsWith(`${agent}-`) && f.endsWith('.json'),
      ).length
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err
      // A freshly opened task directory may be empty; its first shard is zero.
    }
    for (let attempt = 0; attempt < 10_000; attempt++, n++) {
      const filename = `${agent}-${n}.json`
      const path = join(dirPath, filename)
      let fileFd = -1
      try {
        fileFd = openSync(
          path,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          0o600,
        )
        writeFileSync(fileFd, content, 'utf8')
        closeSync(fileFd)
        fileFd = -1
        return join(evidenceDir, task, filename)
      } catch (err) {
        if (fileFd !== -1) {
          try {
            closeSync(fileFd)
            // FAIL-OPEN-INTENT: cleanup close failure must not replace the primary write error.
          } catch {
            // Preserve the primary write error.
          }
        }
        if (err?.code === 'EEXIST') continue
        try {
          unlinkSync(path)
          // FAIL-OPEN-INTENT: best-effort cleanup must not replace the primary write error.
        } catch {
          // Preserve the primary write error.
        }
        throw err
      }
    }
    throw new Error(`too many agent-return shards for ${agent}`)
  } finally {
    if (dirFd !== -1) closeSync(dirFd)
  }
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
  // The agent supplies everything EXCEPT authority fields (branch/sha/ts/provenance). The
  // recorder stamps those itself — never trusted from input — then validates the FULL stamped
  // envelope against the schema before writing. A malformed return fails at hand-back time.
  const stamped = stampProvenance()
  const env = /** @type {Record<string, unknown>} */ (parsed)
  env['branch'] = stamped.branch
  env['sha'] = stamped.sha
  env['ts'] = stamped.ts
  env['provenance'] = stampAgentProvenance()
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
  const agent =
    typeof env['agent'] === 'string' ? String(env['agent']).replace(/[^0-9A-Za-z-]/g, '-') : 'agent'
  try {
    const outPath = writeEnvelopeContained(
      EVIDENCE_DIR,
      sanitizedTask,
      agent,
      `${JSON.stringify(env, null, 2)}\n`,
    )
    process.stdout.write(`[record-agent-return] OK — wrote ${outPath}\n`)
    return 0
  } catch (err) {
    process.stderr.write(
      `[record-agent-return] ERROR: cannot write evidence: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `[record-agent-return] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  })
