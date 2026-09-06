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
import { readFileSync } from 'node:fs'
import {
  EXACT_SHA_BRANCH_SETTINGS,
  EXACT_SHA_REPO_SETTINGS,
  resolveLandingContract,
} from './lib/exact-sha-policy.mjs'

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
const REQUIRED_CONTEXTS = ['CI Required']

const PROTECTION_PAYLOAD = {
  required_status_checks: {
    strict: true,
    contexts: REQUIRED_CONTEXTS,
  },
  enforce_admins: false,
  required_pull_request_reviews: null,
  restrictions: null,
  ...EXACT_SHA_BRANCH_SETTINGS,
}

// INV-101: the canonical executable policy is shared with pr-merge-watch.
const REPO_SETTINGS_PAYLOAD = EXACT_SHA_REPO_SETTINGS

// ─── #2150: report the resolved landing arc ──────────────────────────────────
//
// Applying this tuple does NOT by itself buy exact-SHA landing: outside trunk-solo
// nothing is authorised to advance main by CAS, so main still ends up at a tip that
// was never the gated head. The applicator therefore reads the same contract the
// watcher reads and says which arc the repo is actually on, instead of leaving an
// operator in peer-review believing the applied tuple bought them more than it did.

/** One line describing this repo's landing arc, or why it could not be resolved. */
function landingArcLine() {
  let config
  try {
    config = JSON.parse(readFileSync('arbiter.json', 'utf8'))
  } catch (err) {
    return `unresolved (${err.message}) — exact-SHA landing is NOT in effect`
  }
  const decision = resolveLandingContract(config)
  return decision.supported
    ? `${decision.mode} — ${decision.arc.landing}; main == gatedHeadSha`
    : `NOT exact-SHA — ${decision.reason}`
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

// ── Snapshot (both dry-run and live) ─────────────────────────────────────────

// Capture snapshot before any mutation. In dry-run mode the GET is read-only
// and safe; writing the snapshot file in dry-run lets operators verify rollback
// state without committing to the PUT.
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

if (DRY_RUN) {
  if (JSON_MODE) {
    // Emit both payloads as a JSON object — useful for piping / inspection
    process.stdout.write(
      JSON.stringify(
        { branchProtection: PROTECTION_PAYLOAD, repoSettings: REPO_SETTINGS_PAYLOAD },
        null,
        2,
      ) + '\n',
    )
  } else {
    log(`PUT body preview (branch protection):`)
    log(JSON.stringify(PROTECTION_PAYLOAD, null, 2))
    log('')
    log(`PATCH body preview (repo merge settings):`)
    log(JSON.stringify(REPO_SETTINGS_PAYLOAD, null, 2))
    log('')
    log(`Landing arc: ${landingArcLine()}`)
    log('Dry-run complete. Run without --dry-run to apply.')
  }
  process.exit(0)
}

// ── Live mode ────────────────────────────────────────────────────────────────

// Apply branch protection (PUT)
const endpoint = `repos/${REPO}/branches/${BRANCH}/protection`
log(`Applying branch protection via PUT ${endpoint}`)

try {
  ghApi(endpoint, 'PUT', PROTECTION_PAYLOAD)
  log(`Branch protection applied.`)
} catch (err) {
  process.stderr.write(`[apply-branch-protection] FAIL (branch protection): ${err.message}\n`)
  process.exit(1)
}

// Apply repo merge settings (PATCH) — INV-101 exact-SHA compatibility tuple.
const repoEndpoint = `repos/${REPO}`
log(`Applying repo merge settings via PATCH ${repoEndpoint}`)

try {
  ghApi(repoEndpoint, 'PATCH', REPO_SETTINGS_PAYLOAD)
  log('')
  log(`Branch protection and merge settings applied successfully.`)
  log(`  Repository : ${REPO}`)
  log(`  Branch     : ${BRANCH}`)
  log(`  Checks     : ${REQUIRED_CONTEXTS.join(', ')}`)
  log(`  Merge      : exact-SHA CAS (squash=false, rebase=false, force=false)`)
  log(`  Landing    : ${landingArcLine()}`)
  process.exit(0)
} catch (err) {
  process.stderr.write(`[apply-branch-protection] FAIL (repo settings): ${err.message}\n`)
  process.exit(1)
}
