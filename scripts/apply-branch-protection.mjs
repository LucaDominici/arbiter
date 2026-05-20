#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// apply-branch-protection.mjs — idempotent branch protection configurator for arbiter.
//
// Usage:
//   node scripts/apply-branch-protection.mjs [options]
//
// Options:
//   --repo <owner/repo>     Target repository (default: GITHUB_REPOSITORY env)
//   --branch <name>         Branch to protect (default: main)
//   --dry-run               Preview the PUT body without calling the API (default: false)
//   --json                  In dry-run mode: emit only the JSON body to stdout
//   --snapshot <path>       Path to write the pre-change protection snapshot (optional)
//
// Exit codes (INV-53):
//   0  PASS — protection applied (or dry-run completed)
//   1  FAIL — API call failed or protection not applied
//   2  ERROR — invocation error (bad args, missing required inputs)
//
// Auth: requires GH_TOKEN env var with repo admin scope.
// Idempotent: safe to run multiple times.
import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// ─── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function flag(name) {
  return args.includes(name)
}

function option(name) {
  const idx = args.indexOf(name)
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null
}

const DRY_RUN = flag('--dry-run')
const JSON_MODE = flag('--json')
const BRANCH = option('--branch') ?? 'main'
const SNAPSHOT_PATH = option('--snapshot')

// Resolve repo: --repo flag > GITHUB_REPOSITORY env > auto-detect via gh
let REPO = option('--repo') ?? process.env.GITHUB_REPOSITORY ?? null
if (!REPO) {
  // Try to auto-detect from gh CLI
  try {
    REPO = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
      encoding: 'utf-8',
    }).trim()
  } catch {
    // gh not available or not in a repo
  }
}

if (!REPO) {
  process.stderr.write(
    '[apply-branch-protection] ERROR: --repo <owner/repo> is required\n' +
      'Usage: node scripts/apply-branch-protection.mjs --repo owner/repo [--branch main] [--dry-run]\n',
  )
  process.exit(2)
}

// ─── Protection payload ───────────────────────────────────────────────────────

// Required status checks to enforce on the protected branch.
// These are the GitHub check run NAMES (from the job `name:` field, not the job ID)
// as reported by GitHub API and visible in the PR Checks UI.
// Source: .github/workflows/01-pr-fast.yml
//   job ci-required            → name: "CI Required"
//   job human-approval-required → name: "Human Approval Required (INV-74)"
// Verified via: gh api repos/LucaDominici/arbiter/commits/main/check-runs --jq '.check_runs[].name'
const REQUIRED_CONTEXTS = ['CI Required', 'Human Approval Required (INV-74)']

const PROTECTION_PAYLOAD = {
  required_status_checks: {
    strict: true,
    contexts: REQUIRED_CONTEXTS,
  },
  enforce_admins: false,
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
  },
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  if (!JSON_MODE) {
    process.stdout.write((DRY_RUN ? `[DRY-RUN] ${msg}` : msg) + '\n')
  }
}

function ghApi(endpoint, method, body) {
  const input = JSON.stringify(body)
  const result = spawnSync('gh', ['api', endpoint, '--method', method, '--input', '-'], {
    encoding: 'utf-8',
    input,
    env: process.env,
  })
  if (result.status !== 0) {
    const errMsg = result.stderr || result.stdout || 'unknown error'
    throw new Error(`gh api ${method} ${endpoint} failed (exit ${result.status}): ${errMsg}`)
  }
  return result.stdout ? JSON.parse(result.stdout) : null
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

function snapshotCurrentProtection() {
  const endpoint = `repos/${REPO}/branches/${BRANCH}/protection`
  const result = spawnSync('gh', ['api', endpoint], {
    encoding: 'utf-8',
    env: process.env,
  })
  if (result.status !== 0) {
    // 404 = no protection yet — that's fine
    if (result.stderr && result.stderr.includes('404')) {
      return null
    }
    process.stderr.write(
      `[apply-branch-protection] WARN: could not fetch current protection: ${result.stderr}\n`,
    )
    return null
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

log(`Configuring branch protection on ${REPO}/${BRANCH}`)
log(`Required status checks: ${REQUIRED_CONTEXTS.join(', ')}`)

if (DRY_RUN) {
  if (JSON_MODE) {
    // Emit only the payload JSON — useful for piping / inspection
    process.stdout.write(JSON.stringify(PROTECTION_PAYLOAD, null, 2) + '\n')
  } else {
    log(`PUT body preview:`)
    log(JSON.stringify(PROTECTION_PAYLOAD, null, 2))
    log('')
    log('Dry-run complete. Run without --dry-run to apply.')
  }
  process.exit(0)
}

// ── Live mode ────────────────────────────────────────────────────────────────

// 1. Snapshot pre-change state if requested
if (SNAPSHOT_PATH) {
  log(`Snapshotting current protection to ${SNAPSHOT_PATH}`)
  const snapshot = snapshotCurrentProtection()
  const snapshotData = {
    timestamp: new Date().toISOString(),
    repo: REPO,
    branch: BRANCH,
    protection: snapshot,
  }
  try {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshotData, null, 2) + '\n', 'utf-8')
    log(`Snapshot written to ${SNAPSHOT_PATH}`)
  } catch (err) {
    process.stderr.write(
      `[apply-branch-protection] WARN: could not write snapshot: ${err.message}\n`,
    )
  }
}

// 2. Apply protection
const endpoint = `repos/${REPO}/branches/${BRANCH}/protection`
log(`Applying branch protection via PUT ${endpoint}`)

try {
  ghApi(endpoint, 'PUT', PROTECTION_PAYLOAD)
  log('')
  log(`Branch protection applied successfully.`)
  log(`  Repository : ${REPO}`)
  log(`  Branch     : ${BRANCH}`)
  log(`  Checks     : ${REQUIRED_CONTEXTS.join(', ')}`)
  process.exit(0)
} catch (err) {
  process.stderr.write(`[apply-branch-protection] FAIL: ${err.message}\n`)
  process.exit(1)
}
