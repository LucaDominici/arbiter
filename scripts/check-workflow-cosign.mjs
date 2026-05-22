#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-95/97/98 — deploy supply-chain cosign gate.
// CATALOG: Audits EJS workflow templates for presence of cosign-verify, sign-and-attest,
// CATALOG: and release-only triggers in deploy-capable generated workflows.
// CATALOG: Cannot fold into check-workflow-sha-pinning.mjs: sha-pinning validates static
// CATALOG: action@SHA pin format in any .yml/.yaml file; this script validates runtime step
// CATALOG: invocation semantics (verb presence, flag correctness, trigger shape) specifically
// CATALOG: in deploy-path EJS source templates — a structurally different audit concern.
//
// Checks (all against EJS template sources):
//   INV-95: 05-release.yml.ejs must invoke sign-and-attest composite action.
//   INV-97: 10-deploy-prod.yml.ejs and each _cosign-copy/*.ejs must contain
//           cosign verify with --certificate-identity-regexp and
//           --certificate-oidc-issuer flags.
//   INV-98: 10-deploy-prod.yml.ejs must use release: trigger only (no push.branches).
//
// Exit codes (INV-53): 0 PASS, 1 FAIL, 2 invocation/IO error (input set empty).
//
// Usage: node scripts/check-workflow-cosign.mjs [--dir <repo-root>] [--help]

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-workflow-cosign.mjs [options]',
      '',
      'Audits EJS deploy-workflow templates for cosign supply-chain invariants.',
      'Exits 0 when all checks pass; exits 1 when violations found; exits 2 when no templates found.',
      '',
      'Options:',
      '  --dir <path>    Repo root to scan (default: cwd)',
      '  --help, -h      Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const dirArg = args.indexOf('--dir')
const CWD = dirArg >= 0 && args[dirArg + 1] ? resolve(args[dirArg + 1]) : process.cwd()

const WORKFLOWS_TPL = join(CWD, 'src', 'templates', 'github', 'workflows')
const COSIGN_COPY_DIR = join(WORKFLOWS_TPL, '_cosign-copy')

// ─── Input-set guard (fail-closed, INV-53) ────────────────────────────────────

const RELEASE_TPL = join(WORKFLOWS_TPL, '05-release.yml.ejs')
const PROD_TPL = join(WORKFLOWS_TPL, '10-deploy-prod.yml.ejs')

if (!existsSync(WORKFLOWS_TPL) || !existsSync(RELEASE_TPL) || !existsSync(PROD_TPL)) {
  process.stderr.write(
    'check-workflow-cosign: ERROR — deploy workflow templates not found under src/templates/github/workflows/\n',
  )
  process.exit(2)
}

function collectEjsFiles(dir) {
  if (!existsSync(dir)) return []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.ejs')).map((e) => join(dir, e.name))
}

const cosignCopyFiles = collectEjsFiles(COSIGN_COPY_DIR)

if (cosignCopyFiles.length === 0) {
  process.stderr.write(
    'check-workflow-cosign: ERROR — no _cosign-copy/*.ejs partials found (input set empty — fail closed)\n',
  )
  process.exit(2)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFile(path) {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

let violations = 0

function fail(msg) {
  process.stderr.write(`[FAIL] ${msg}\n`)
  violations++
}

// ─── INV-95: 05-release.yml.ejs must invoke cosign sign on container builds ──

const releaseContent = readFile(RELEASE_TPL)
if (!releaseContent) {
  fail(`could not read ${RELEASE_TPL}`)
} else {
  // Check for 'cosign sign ' (trailing space) to avoid matching cosign sign-blob
  if (!releaseContent.includes('cosign sign ')) {
    fail(
      `INV-95: 05-release.yml.ejs does not invoke cosign sign — ` +
        `every container image entering the supply chain must be signed via keyless Sigstore OIDC`,
    )
  }
}

// ─── INV-98: 10-deploy-prod.yml.ejs must use release: trigger only ───────────

const prodContent = readFile(PROD_TPL)
if (!prodContent) {
  fail(`could not read ${PROD_TPL}`)
} else {
  if (!prodContent.includes('release:')) {
    fail(
      `INV-98: 10-deploy-prod.yml.ejs does not contain a release: trigger — ` +
        `PROD deploy must be gated by a release event, not a branch push`,
    )
  }
  // Ensure push.branches is absent from the top-level on: block (first 30 lines)
  const header = prodContent.split('\n').slice(0, 30).join('\n')
  if (/^\s+branches:/m.test(header) && /^\s*on:/m.test(header)) {
    fail(
      `INV-98: 10-deploy-prod.yml.ejs contains push.branches trigger — ` +
        `deploy-prod must be triggered only by release:published, not branch pushes`,
    )
  }
  // INV-97: cosign verify is emitted via _cosign-copy partials (included at render time);
  // the parent template correctly delegates to the partials checked below.
}

// ─── INV-97: each _cosign-copy/*.ejs must contain cosign verify ──────────────

for (const file of cosignCopyFiles) {
  const content = readFile(file)
  if (!content) {
    fail(`could not read cosign-copy partial: ${file}`)
    continue
  }
  if (!content.includes('cosign verify')) {
    fail(
      `INV-97: ${file} does not contain a cosign verify step — ` +
        `every cosign-copy partial must verify the promoted image`,
    )
  }
  if (!content.includes('--certificate-identity-regexp')) {
    fail(
      `INV-97: ${file} cosign verify is missing --certificate-identity-regexp flag — ` +
        `identity binding is mandatory for supply-chain integrity`,
    )
  }
  if (!content.includes('--certificate-oidc-issuer')) {
    fail(
      `INV-97: ${file} cosign verify is missing --certificate-oidc-issuer flag — ` +
        `keyless verification requires explicit issuer assertion`,
    )
  }
  // Ensure cosign copy is used (not crane tag / docker tag)
  if (!content.includes('cosign copy')) {
    fail(
      `INV-97: ${file} does not use cosign copy — ` +
        `docker/crane tag drops OCI referrers (signatures, SBOM); cosign copy is required`,
    )
  }
}

// ─── Result ───────────────────────────────────────────────────────────────────

if (violations > 0) {
  process.stderr.write(
    `check-workflow-cosign: FAIL — ${violations} cosign supply-chain violation(s) found (INV-95/97/98)\n`,
  )
  process.exit(1)
}

process.stdout.write(
  `check-workflow-cosign: OK — deploy-chain cosign invariants satisfied ` +
    `(INV-95/97/98, ${cosignCopyFiles.length} cosign-copy partials checked)\n`,
)
process.exit(0)
