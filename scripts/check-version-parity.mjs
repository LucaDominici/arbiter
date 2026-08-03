#!/usr/bin/env node
// CATALOG: three-way version agreement — package.json == dist/cli.js --version == CHANGELOG.md top released entry (#1838, closes the #1837 drift class).
// CATALOG: rejected fold-in into check-node-version-ssot.mjs (Node RUNTIME version pins across configs, not the package's own semver).
// CATALOG: rejected fold-in into sync-changelog.mjs (mutating changelog sync tool, not a read-only parity gate; a gate must never write).
//
// Gate (F2 #1838, item 5): package.json version, the compiled CLI's runtime
// `--version` output, and CHANGELOG.md's top released entry must all agree.
//
// This closes the version-drift class of bug fixed once already in F1
// (#1837): `--version` was hardcoded to 0.3.0 while package.json had already
// moved to 0.4.0. That fix made cli.ts read the version from package.json at
// runtime — but nothing stops a FUTURE stale build, a broken require path
// (silently falling back to 'unknown'), or a CHANGELOG entry that never got
// bumped alongside package.json. This gate makes the three-way agreement a
// permanent, wired check instead of a one-off fix.
//
// Usage:
//   node scripts/check-version-parity.mjs
//   node scripts/check-version-parity.mjs --pkg=path --changelog=path --cli=path  (fixtures)
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { isMainModule } from './lib/run-helpers.mjs'

function argPath(flag, fallback) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? resolve(arg.split('=')[1]) : fallback
}

const PKG_PATH = argPath('pkg', resolve('package.json'))
const CHANGELOG_PATH = argPath('changelog', resolve('CHANGELOG.md'))
const CLI_PATH = argPath('cli', resolve('dist', 'cli.js'))

/** Read and validate the `version` field out of a package.json's raw text. */
export function readPackageVersion(pkgJsonRaw) {
  const pkg = JSON.parse(pkgJsonRaw)
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error('package.json has no version field')
  }
  return pkg.version
}

/**
 * Return the first RELEASED version heading in a CHANGELOG.md's raw text,
 * i.e. the first `## [X.Y.Z]` line — skipping `## [Unreleased]`, which has
 * no version yet. Returns null when no released heading exists.
 */
export function readChangelogTopVersion(changelogRaw) {
  const headingRe = /^##\s*\[([^\]]+)\]/gm
  for (const m of changelogRaw.matchAll(headingRe)) {
    if (m[1].trim().toLowerCase() === 'unreleased') continue
    return m[1].trim()
  }
  return null
}

/** Compare the three sources; returns a list of human-readable violation strings. */
export function diffVersionParity(pkgVersion, cliVersion, changelogVersion) {
  const violations = []
  if (cliVersion !== pkgVersion) {
    violations.push(`--version reports "${cliVersion}" but package.json says "${pkgVersion}"`)
  }
  if (changelogVersion === null) {
    violations.push('CHANGELOG.md has no released version heading (## [X.Y.Z])')
  } else if (changelogVersion !== pkgVersion) {
    violations.push(
      `CHANGELOG.md top entry is "[${changelogVersion}]" but package.json says "${pkgVersion}"`,
    )
  }
  return violations
}

function main() {
  const pkgVersion = readPackageVersion(readFileSync(PKG_PATH, 'utf-8'))
  const changelogVersion = readChangelogTopVersion(readFileSync(CHANGELOG_PATH, 'utf-8'))

  if (!existsSync(CLI_PATH)) {
    process.stdout.write(
      `[check-version-parity] ERROR: ${CLI_PATH} not found — run "npm run build" before this gate\n`,
    )
    process.exit(2)
  }
  const cliVersion = execFileSync(process.execPath, [CLI_PATH, '--version'], {
    encoding: 'utf-8',
  }).trim()

  const violations = diffVersionParity(pkgVersion, cliVersion, changelogVersion)

  if (violations.length > 0) {
    for (const v of violations) process.stdout.write(`  DRIFT: ${v}\n`)
    process.stdout.write(
      `[check-version-parity] FAIL: ${violations.length} version-parity violation(s)\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `[check-version-parity] OK — package.json, --version, and CHANGELOG.md all agree on ${pkgVersion}\n`,
  )
}

const isMain = isMainModule(import.meta.url)
if (isMain) {
  try {
    main()
  } catch (err) {
    process.stderr.write(
      `[check-version-parity] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}
