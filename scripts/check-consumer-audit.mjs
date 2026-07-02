#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — consumer-resolution audit gate (#1718, follow-up to #1670 parts 2&3).
//
// CATALOG: Audits what a CONSUMER of the published @arbiter/cli tarball actually
// CATALOG: resolves — npm pack (lifecycle scripts suppressed) -> install into a
// CATALOG: throwaway root with no repo overrides/devDeps -> npm audit --json at a
// CATALOG: moderate floor. Rejected fold-in into check-runtime-dep-pins.mjs — that
// CATALOG: gate is a static package.json spec check, and its own header comment
// CATALOG: explicitly defers this exact transitive-resolution class to a new file.
// CATALOG: Rejected fold-in into check-tarball-contents.mjs — that gate classifies
// CATALOG: the FILE MANIFEST via `npm pack --dry-run` (no tarball produced, never
// CATALOG: installs, never audits); different artifact and different failure mode.
//
// WHY a second audit gate at all: the existing `audit` step in scripts/check-all.mjs
// runs `npm audit --omit=dev --audit-level=high` against the DEV tree, where npm
// `overrides` ARE applied. npm silently drops `overrides` for anyone who installs
// @arbiter/cli as a dependency — the dev-tree audit is structurally blind to that
// class of exposure (the uuid@8 GHSA-w5hq-g745-h8pq vuln that motivated #1670 was
// masked exactly this way, until the runtime dependency itself was replaced). This
// gate audits the CONSUMER view instead: no repo overrides, no devDependencies, and
// a `moderate` floor — stricter than the dev-tree gate's `high` floor — so a masked
// transitive vuln in any runtime dep (@clack/prompts, commander, ejs, prettier, zod)
// resurfaces here even when the dev tree stays green.
//
// Exit codes (INV-53):
//   0 — clean (consumer-resolved tree has no unsuppressed vuln >= moderate)
//   1 — an unsuppressed vulnerability >= moderate was found in the consumer-resolved tree
//   2 — invocation/IO error (npm pack/install/audit could not run — including a
//       network-unreachable registry — or produced unparseable/malformed output).
//       Fail-closed everywhere, local AND CI (INV-96): this is a SECURITY gate, so it
//       follows the sibling dev-tree `npm audit` step's fail-closed precedent, never
//       a graceful offline skip. A genuinely offline developer uses the documented
//       gate-bypass env (conscious, logged) — never a silent PASS.
//
// Usage:
//   node scripts/check-consumer-audit.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePinnedNpm } from './check-npm-ci-drift.mjs'

/** Severity floor: MODERATE and above — stricter than the dev-tree audit's `high` floor. */
export const SEVERITY_FLOOR = new Set(['moderate', 'high', 'critical'])

const GHSA_URL_RE = /\/advisories\/(GHSA-[A-Za-z0-9-]+)/

/**
 * Derive every stable suppression-scope id a vulnerability entry can be matched by:
 * its own package name, every GHSA id / numeric advisory `source` found in a `via[]`
 * object entry, and every upstream package name named by a `via[]` STRING entry
 * (npm v7+ schema's representation of "transitive through another vulnerable package").
 * @param {string} packageName
 * @param {unknown} via
 * @returns {Set<string>}
 */
function deriveScopeIds(packageName, via) {
  const ids = new Set([packageName])
  if (!Array.isArray(via)) return ids
  for (const entry of via) {
    if (typeof entry === 'string') {
      ids.add(entry)
      continue
    }
    if (entry !== null && typeof entry === 'object') {
      const rec = /** @type {Record<string, unknown>} */ (entry)
      if (typeof rec.url === 'string') {
        const m = rec.url.match(GHSA_URL_RE)
        if (m) ids.add(m[1])
      }
      if (typeof rec.source === 'number') ids.add(String(rec.source))
      if (typeof rec.name === 'string') ids.add(rec.name)
    }
  }
  return ids
}

/**
 * True when a non-expired allowlist entry's `scope` matches one of the derived ids.
 * An EXPIRED entry never suppresses — the vulnerability resurfaces (disposition
 * allowlists are dated, not permanent, per this repo's suppression model).
 * @param {Set<string>} ids
 * @param {Array<Record<string, unknown>>} allowlist
 * @param {Date} now
 */
function isSuppressed(ids, allowlist, now) {
  for (const entry of allowlist) {
    if (typeof entry?.scope !== 'string' || !ids.has(entry.scope)) continue
    const expiry = new Date(/** @type {string} */ (entry.expiresAt))
    if (!isNaN(expiry.getTime()) && expiry.getTime() > now.getTime()) return true
  }
  return false
}

/**
 * Pure classifier over an `npm audit --json` payload (npm v7+ schema: `vulnerabilities`
 * is an OBJECT keyed by package name, not an array) plus a disposition allowlist.
 * Side-effect-free and unit-testable without spawning npm.
 *
 * @param {unknown} auditJson
 * @param {Array<Record<string, unknown>>} allowlist
 * @param {Date} now
 * @returns {{ unsuppressed: Array<{ package: string, severity: string, ids: string[] }>, errored: boolean }}
 */
export function classifyConsumerAudit(auditJson, allowlist, now) {
  if (auditJson === null || typeof auditJson !== 'object') {
    return { unsuppressed: [], errored: true }
  }
  const obj = /** @type {Record<string, unknown>} */ (auditJson)
  // A valid clean audit is `{ vulnerabilities: {}, metadata: {...} }` — an empty
  // vulnerabilities object is CLEAN, not errored. Only a payload lacking BOTH keys
  // (unrecognised schema) is treated as malformed / errored (fail-closed, never silent-pass).
  if (!('vulnerabilities' in obj) && !('metadata' in obj)) {
    return { unsuppressed: [], errored: true }
  }
  const vulnerabilities =
    obj.vulnerabilities !== null && typeof obj.vulnerabilities === 'object'
      ? /** @type {Record<string, unknown>} */ (obj.vulnerabilities)
      : {}

  const unsuppressed = []
  for (const [pkgKey, raw] of Object.entries(vulnerabilities)) {
    const vuln = /** @type {Record<string, unknown>} */ (raw)
    const severity = typeof vuln?.severity === 'string' ? vuln.severity : ''
    if (!SEVERITY_FLOOR.has(severity)) continue
    const name = typeof vuln?.name === 'string' ? vuln.name : pkgKey
    const ids = deriveScopeIds(name, vuln?.via)
    if (isSuppressed(ids, allowlist, now)) continue
    unsuppressed.push({ package: name, severity, ids: [...ids] })
  }
  return { unsuppressed, errored: false }
}

// ─── Impure runner (npm pack -> install -> audit) ─────────────────────────────

const MAX_BUFFER = 10 * 1024 * 1024

/**
 * Resolve the npm invocation as `[command, ...prefixArgs]` — the pinned npm via
 * `npx -y npm@<pin>` when package.json declares an exact `npm@X.Y.Z` packageManager
 * (guarantees the v7+ `auditReportVersion:2` JSON schema this gate parses regardless
 * of the ambient npm — e.g. the npm 10-CI vs npm 11-local skew already seen in this
 * repo, #1684) — or the ambient `npm` when no exact pin is declared. Mirrors
 * check-npm-ci-drift.mjs's pinned-npm invocation form (imports parsePinnedNpm rather
 * than re-deriving it, per CANON-22).
 * @param {string} repoRoot
 * @returns {string[]}
 */
function resolveNpmCommand(repoRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'))
    const pin = parsePinnedNpm(/** @type {Record<string, unknown>} */ (pkg)?.packageManager)
    if (pin) return ['npx', '-y', `npm@${pin}`]
    // FAIL-OPEN-INTENT: no exact `npm@X.Y.Z` pin declared (range/non-npm-manager/absent field) — deliberately falls through to the ambient npm below; an intentional default, not a swallowed error.
  } catch {
    // package.json unreadable/malformed here degrades to the ambient npm, never silently: the
    // pack step below reads the SAME file and will surface (and exit 2) on the identical failure.
  }
  return ['npm']
}

/**
 * @param {string} repoRoot
 * @returns {Array<Record<string, unknown>>}
 */
function loadAllowlist(repoRoot) {
  const path = join(repoRoot, 'suppressions', 'consumer-audit-allowlist.json')
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    // Malformed allowlist degrades to "no suppressions" — the SAFE direction (more
    // vulns surface, never fewer) — but the parse failure is still surfaced, never silent.
    process.stderr.write(
      `check-consumer-audit: WARN — could not parse consumer-audit-allowlist.json (treating as empty): ${err?.message ?? err}\n`,
    )
    return []
  }
}

/**
 * @param {string} repoRoot
 * @returns {number} exit code (INV-53)
 */
function main(repoRoot) {
  const packDir = mkdtempSync(join(tmpdir(), 'arbiter-consumer-audit-pack-'))
  const installRoot = mkdtempSync(join(tmpdir(), 'arbiter-consumer-audit-install-'))
  const npmCmd = resolveNpmCommand(repoRoot)
  const runNpm = (/** @type {string[]} */ args, /** @type {object} */ opts) =>
    spawnSync(npmCmd[0], [...npmCmd.slice(1), ...args], opts)
  try {
    // 1. Pack the publishable tarball WITHOUT running lifecycle scripts. A bare `npm
    // pack` triggers `prepack` (`rm -rf dist && tsc && gen-third-party-licenses`),
    // which would delete/rebuild dist/ and rewrite a tracked file MID-GATE — the
    // destructive footgun this gate must never reintroduce. `--pack-destination`
    // keeps the tarball out of the repo tree so the gate leaves the tree clean.
    const pack = runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: MAX_BUFFER,
    })
    if (pack.error) {
      process.stderr.write(
        `check-consumer-audit: npm pack failed to invoke — ${pack.error.message}\n`,
      )
      return 2
    }
    if (pack.status !== 0) {
      process.stderr.write(`check-consumer-audit: npm pack failed\n${pack.stderr ?? ''}\n`)
      return 2
    }
    let packed
    try {
      packed = JSON.parse(pack.stdout)
    } catch (err) {
      process.stderr.write(
        `check-consumer-audit: could not parse npm pack --json output — ${err?.message ?? err}\n`,
      )
      return 2
    }
    const filename = packed?.[0]?.filename
    if (typeof filename !== 'string' || filename.length === 0) {
      process.stderr.write('check-consumer-audit: npm pack output missing tarball filename\n')
      return 2
    }
    const tarballPath = join(packDir, filename)

    // 2. Install the tarball into a throwaway root: no repo `overrides` apply (npm
    // only honours overrides for the root project being installed), no devDeps
    // (never installed for a dependency), and no repo .npmrc (installRoot lives
    // under os.tmpdir(), outside the repo's cwd-walk) — the actual consumer view.
    writeFileSync(
      join(installRoot, 'package.json'),
      JSON.stringify({ name: 'consumer-probe', private: true, version: '0.0.0' }, null, 2),
    )
    const install = runNpm(
      ['install', tarballPath, '--no-audit', '--no-fund', '--ignore-scripts'],
      { cwd: installRoot, encoding: 'utf-8', maxBuffer: MAX_BUFFER },
    )
    if (install.error) {
      process.stderr.write(
        `check-consumer-audit: npm install failed to invoke — ${install.error.message}\n`,
      )
      return 2
    }
    if (install.status !== 0) {
      const combined = `${install.stderr ?? ''}\n${install.stdout ?? ''}`
      process.stderr.write(`check-consumer-audit: npm install failed\n${combined}\n`)
      return 2
    }

    // 3. Audit the resolved consumer tree. Never trust the exit code — `npm audit`
    // exits non-zero whenever ANY vuln exists; this gate's own policy (moderate
    // floor + dated disposition allowlist) decides pass/fail, not npm's default.
    const audit = runNpm(['audit', '--json'], {
      cwd: installRoot,
      encoding: 'utf-8',
      maxBuffer: MAX_BUFFER,
    })
    if (audit.error) {
      process.stderr.write(
        `check-consumer-audit: npm audit failed to invoke — ${audit.error.message}\n`,
      )
      return 2
    }
    let auditJson
    try {
      auditJson = JSON.parse(audit.stdout)
    } catch (err) {
      process.stderr.write(
        `check-consumer-audit: could not parse npm audit --json output — ${err?.message ?? err}\n`,
      )
      return 2
    }

    const allowlist = loadAllowlist(repoRoot)
    const { unsuppressed, errored } = classifyConsumerAudit(auditJson, allowlist, new Date())
    if (errored) {
      process.stderr.write(
        'check-consumer-audit: malformed npm audit payload (neither vulnerabilities nor metadata present)\n',
      )
      return 2
    }
    if (unsuppressed.length > 0) {
      process.stderr.write(
        `check-consumer-audit: FAIL — ${unsuppressed.length} unsuppressed consumer-facing vulnerabilit${
          unsuppressed.length === 1 ? 'y' : 'ies'
        } >= moderate:\n`,
      )
      for (const v of unsuppressed) {
        process.stderr.write(`  ${v.package}  [${v.severity}]  ids: ${v.ids.join(', ')}\n`)
      }
      process.stderr.write(
        '\nRemediate at source (bump/replace the dependency), or add a dated disposition to\n' +
          'suppressions/consumer-audit-allowlist.json (reason + owner + expiresAt + scope)\n' +
          'referencing a tracking issue. Never lower the moderate floor.\n',
      )
      return 1
    }

    process.stdout.write(
      'check-consumer-audit: OK (consumer-resolved tree clean at moderate floor)\n',
    )
    return 0
  } finally {
    rmSync(packDir, { recursive: true, force: true })
    rmSync(installRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main(process.cwd()))
  } catch (err) {
    process.stderr.write(`check-consumer-audit: ${err?.message ?? err}\n`)
    process.exit(2)
  }
}
