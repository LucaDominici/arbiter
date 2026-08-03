#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — npm-ci lockfile-drift gate (#1684, enforced).
//
// CATALOG: Verifies `npm ci` would succeed UNDER THE PINNED npm (package.json#packageManager) —
// CATALOG: i.e. the committed package-lock.json is in sync with package.json when read by the SAME
// CATALOG: npm MAJOR that CI uses, catching the local/dependabot-npm-11 vs CI-npm-10 lock skew (#1684).
// CATALOG: Rejected fold-in into check-runtime-dep-pins.mjs — that asserts EXACT version specs in
// CATALOG: package.json (static text); this EXECUTES `npm ci --dry-run` under a pinned npm BINARY (a
// CATALOG: different artifact: the lockfile, and a different failure mode: install-time sync, not spec shape).
// CATALOG: Rejected fold-in into check-node-version-ssot.mjs — that pins the Node RUNTIME via .nvmrc;
// CATALOG: this pins the PACKAGE MANAGER and validates lockfile reproducibility, an orthogonal axis.
//
// Why a gate AND a pin: corepack honors `packageManager` only when enabled, and Dependabot may
// rewrite the lock under its own (newer) npm. So the pin is necessary but not sufficient — this gate,
// run under the pinned npm EXPLICITLY (npx npm@<pin>, NOT the ambient `npm` which may be a newer major
// that dedupes peers / records `libc` fields differently and thereby HIDES the skew), is the accepted
// backstop that fails closed pre-merge instead of letting the drift reach `main` and break CI repo-wide.
//
// Exit codes (INV-53):
//   0 — lock in sync under the pinned npm, OR not-applicable (no package.json / no lockfile)
//   1 — drift detected (`npm ci` would fail), OR the packageManager pin is missing/not npm@X.Y.Z
//   2 — invocation error (package.json unreadable/malformed, or the pinned npm could not be run)
//
// Usage:
//   node scripts/check-npm-ci-drift.mjs            # check the current working directory
//   node scripts/check-npm-ci-drift.mjs --root DIR # check an alternate root (used by tests)
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { isMainModule } from './lib/run-helpers.mjs'

/**
 * Parse the pinned npm version from a `packageManager` spec.
 * Accepts only an exact `npm@<version>` pin (e.g. npm@10.9.8, optionally a prerelease) — a
 * range (`npm@^10`) or a non-npm manager (`pnpm@9`) is NOT a reproducible pin and returns null.
 * @param {unknown} packageManager
 * @returns {string | null} the exact version string, or null when not an exact npm pin.
 */
export function parsePinnedNpm(packageManager) {
  if (typeof packageManager !== 'string') return null
  const m = packageManager.trim().match(/^npm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/)
  return m ? m[1] : null
}

/**
 * @typedef {object} DriftProbe
 * @property {boolean} hasPackageJson
 * @property {boolean} hasLock
 * @property {Record<string, unknown> | null} pkg  parsed package.json (null when absent/unparsed)
 * @property {boolean} parseError  true when package.json exists but could not be parsed
 *
 * @typedef {object} DriftPlan
 * @property {'na' | 'check' | 'fail' | 'error'} action
 * @property {string} reason
 * @property {string} [npmVersion]
 */

/**
 * Decide what the gate should do for a probed root — pure, so it is unit-testable without spawning.
 * @param {DriftProbe} probe
 * @returns {DriftPlan}
 */
export function planDriftCheck(probe) {
  if (probe.parseError) {
    return { action: 'error', reason: 'package.json exists but is unreadable or malformed' }
  }
  if (!probe.hasPackageJson) {
    return { action: 'na', reason: 'no package.json — not an npm project' }
  }
  if (!probe.hasLock) {
    return { action: 'na', reason: 'no package-lock.json — nothing to verify' }
  }
  const pin = parsePinnedNpm(probe.pkg == null ? undefined : probe.pkg.packageManager)
  if (pin == null) {
    return {
      action: 'fail',
      reason:
        'packageManager pin missing or not an exact npm@X.Y.Z — ' +
        'add "packageManager": "npm@10.x.x" to package.json so local, CI and Dependabot converge (#1684)',
    }
  }
  return { action: 'check', reason: `pinned npm@${pin}`, npmVersion: pin }
}

// ─── CLI plumbing (impure) ────────────────────────────────────────────────────

function parseRootArg(argv) {
  const i = argv.indexOf('--root')
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : process.cwd()
}

/**
 * Read fs/JSON facts for a root. Any package.json read/parse failure is SURFACED to
 * stderr (never swallowed) and reported as a parse error → exit 2 (fail-closed, INV-96).
 * @param {string} root
 * @returns {DriftProbe}
 */
function probeRoot(root) {
  const pkgPath = join(root, 'package.json')
  const hasPackageJson = existsSync(pkgPath)
  const hasLock = existsSync(join(root, 'package-lock.json'))
  let pkg = null
  let parseError = false
  if (hasPackageJson) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    } catch (err) {
      process.stderr.write(
        `  ERROR npm-ci drift — cannot read ${pkgPath}: ${err instanceof Error ? err.message : String(err)}\n`,
      )
      parseError = true
    }
  }
  return { hasPackageJson, hasLock, pkg, parseError }
}

/**
 * Run `npm ci --dry-run` UNDER THE PINNED npm via npx. Invoking `npm@<version>` explicitly
 * (rather than ambient `npm`) is the whole point: a newer ambient npm major reports the lock as
 * "up to date" while the pinned major rejects it — the skew this gate exists to catch (#1684).
 * @param {string} root
 * @param {string} npmVersion
 */
function runNpmCiDryRun(root, npmVersion) {
  return spawnSync('npx', ['-y', `npm@${npmVersion}`, 'ci', '--dry-run'], {
    cwd: root,
    encoding: 'utf-8',
    shell: false,
  })
}

// Keep only the npm sync-error lines from a noisy npm log so the gate output is actionable.
function summariseNpmError(output) {
  if (typeof output !== 'string' || output.length === 0) return '  (no output from npm)\n'
  const lines = output
    .split('\n')
    .filter((l) => /in sync|Missing:|Invalid:|out of date|Clean install/i.test(l))
  const picked = lines.length > 0 ? lines : output.split('\n').filter(Boolean).slice(-6)
  return picked.map((l) => `    ${l.trim()}`).join('\n') + '\n'
}

/**
 * @param {string[]} argv
 * @returns {number} process exit code (INV-53)
 */
function main(argv) {
  const root = resolve(parseRootArg(argv))
  const plan = planDriftCheck(probeRoot(root))

  if (plan.action === 'na') {
    process.stdout.write(`  OK    npm-ci drift — ${plan.reason} (not applicable)\n`)
    return 0
  }
  if (plan.action === 'error') {
    process.stderr.write(`  ERROR npm-ci drift — ${plan.reason}\n`)
    return 2
  }
  if (plan.action === 'fail') {
    process.stderr.write(`  FAIL  npm-ci drift — ${plan.reason}\n`)
    return 1
  }

  // plan.action === 'check'
  const npmVersion = /** @type {string} */ (plan.npmVersion)
  const r = runNpmCiDryRun(root, npmVersion)
  if (r.error != null) {
    process.stderr.write(
      `  ERROR npm-ci drift — could not invoke the pinned npm@${npmVersion}: ${r.error.message}\n`,
    )
    return 2
  }
  if (r.status === 0) {
    process.stdout.write(
      `  OK    npm-ci drift — package-lock.json in sync under npm@${npmVersion}\n`,
    )
    return 0
  }
  process.stderr.write(
    `  FAIL  npm-ci drift — \`npm ci\` would FAIL under npm@${npmVersion}; ` +
      `package-lock.json is out of sync with package.json:\n`,
  )
  process.stderr.write(summariseNpmError(`${r.stderr ?? ''}\n${r.stdout ?? ''}`))
  process.stderr.write(
    `\n  Fix: relock under the pinned npm, then commit the result:\n` +
      `    npx -y npm@${npmVersion} install --package-lock-only\n`,
  )
  return 1
}

const isMain = isMainModule(import.meta.url)
if (isMain) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    process.stderr.write(
      `  ERROR npm-ci drift — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    )
    process.exit(2)
  }
}
