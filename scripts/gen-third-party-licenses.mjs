#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Third-party attribution generator — enumerates the PRODUCTION
// CATALOG: dependency closure from package-lock.json, resolves each in
// CATALOG: node_modules, and emits a deterministic THIRD_PARTY_LICENSES.md
// CATALOG: (name, version, license id, homepage, and the verbatim license
// CATALOG: text). Wired into `prepack` so the file ships in the npm tarball
// CATALOG: (package.json files[] + NOTICE reference it). Stands alone because
// CATALOG: it produces a shipped legal artifact from the dep tree — a concern
// CATALOG: distinct from the license ALLOWLIST gate (check that validates
// CATALOG: permitted SPDX ids), which enforces policy rather than producing
// CATALOG: attribution.
//
// Usage:
//   node scripts/gen-third-party-licenses.mjs            # write THIRD_PARTY_LICENSES.md
//   node scripts/gen-third-party-licenses.mjs --check    # fail if the file is stale/missing
//
// #1807: `prepack` invokes this with `--check`, NOT the write form. `npm pack`
// (even `--dry-run`) always runs `prepack`, so a write-mode prepack silently
// regenerated (mutated) this tracked file mid-gate whenever ANY script shelled
// out to `npm pack`/`npm pack --dry-run` without `--ignore-scripts` — the exact
// footgun `check-consumer-audit.mjs` already guards against for its own `npm
// pack` call (see its `packTarball` docstring). `--check` makes `prepack`
// verify-only, matching the ALREADY-mandatory 'third-party licenses' gate
// check below; drift must be fixed and committed via the write form BEFORE a
// publish, never silently patched over by one.
//
// Determinism: the closure is read from package-lock.json — npm's authoritative,
// platform-INDEPENDENT record — NOT from an `npm ls` walk over the physically
// installed `node_modules`. That walk is non-deterministic w.r.t. install state
// (a platform-specific OPTIONAL variant present on one machine but absent on
// another changes the tree) and, worse, leaks dev-only optional+peer packages
// into an `--omit=dev` listing — the exact defect that put six dev-only wasm
// packages (@emnapi/*, @napi-rs/wasm-runtime, @tybys/wasm-util, tslib) into a
// production attribution file they never belonged in. The lockfile's per-entry
// `dev`/`optional`/`license` flags are computed once at resolution time and are
// identical on every machine, so the output is the same regardless of which
// platform variants happen to be installed. The set is the FULL production
// dependency closure a consumer installs (every transitive registry package
// reachable from the root `dependencies`, production `optional` deps included as
// the cross-platform superset), not merely the direct deps: every one of those
// packages carries an attribution obligation (MIT/BSD/ISC require the copyright
// notice be preserved). Local workspace packages (`link:true` / source dirs) are
// pruned — they are first-party, not redistributed third parties. The license id
// comes from the lockfile (install-independent); homepage + verbatim license
// text come from the installed package (production deps are non-optional, hence
// always installed after `npm ci`). The generator FAILS CLOSED on any unresolved
// (`UNKNOWN`) license or uninstalled production dep: a legal artifact must never
// silently omit an obligation.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const OUT_FILE = resolve(ROOT, 'THIRD_PARTY_LICENSES.md')

// Resolved from THIS script's own location, never from ROOT (=process.cwd()): tests run this
// generator with cwd pointed at a throwaway fixture root that has no src/ tree at all
// (__tests__/scripts/gen-third-party-licenses.test.ts). The companion-plugins section (#2428)
// is arbiter's own SSOT data, not part of the fixture-driven npm dependency closure, so it must
// resolve against the real repo regardless of cwd.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SKILLS_MATRIX_PATH = resolve(SCRIPT_DIR, '../src/compatibility/skills-matrix.json')

// --lockfile-fixture=<path> or --lockfile-fixture <path>: substitute a JSON file
// for the repo's package-lock.json (testing only). Supports both `=` and
// space-separated forms.
const _fixtureIdx = process.argv.findIndex(
  (a) => a === '--lockfile-fixture' || a.startsWith('--lockfile-fixture='),
)
const _fixturePath =
  _fixtureIdx === -1
    ? null
    : process.argv[_fixtureIdx].startsWith('--lockfile-fixture=')
      ? process.argv[_fixtureIdx].slice('--lockfile-fixture='.length)
      : (process.argv[_fixtureIdx + 1] ?? null)

// --license-overrides-fixture=<path> or space form: substitute a JSON file for the
// LICENSE_OVERRIDES map (testing only). The override mechanism is a dormant escape
// hatch (the map is currently empty — see LICENSE_OVERRIDES docstring); this flag
// lets the positive override path + `source` audit trail be exercised by a
// synthetic fixture without depending on a real metadata-less package. Supports
// both `=` and space-separated forms, mirroring `--lockfile-fixture`.
const _overridesIdx = process.argv.findIndex(
  (a) => a === '--license-overrides-fixture' || a.startsWith('--license-overrides-fixture='),
)
const _overridesPath =
  _overridesIdx === -1
    ? null
    : process.argv[_overridesIdx].startsWith('--license-overrides-fixture=')
      ? process.argv[_overridesIdx].slice('--license-overrides-fixture='.length)
      : (process.argv[_overridesIdx + 1] ?? null)
const HEADER = `# Third-Party Licenses

arbiter (\`@arbiter/cli\`) is distributed under the Apache License 2.0. This file
lists the full production dependency closure a consumer installs with
\`@arbiter/cli\` — every transitive runtime dependency — together with its
license. It is generated by \`scripts/gen-third-party-licenses.mjs\` from
\`package-lock.json\`; do not edit it by hand.

`

/**
 * Curated attribution overrides for packages whose published metadata omits a
 * `license` field but whose license is publicly verifiable. The generator fails
 * closed on UNKNOWN; this map is the ONLY sanctioned escape hatch, and each
 * entry must carry a `source` documenting how the license was established. Keyed
 * by `name@version` so an override never silently leaks to a future version.
 *
 * The map is currently empty: the previous `buffers@0.1.1` override was the only
 * entry, and it existed solely for `exceljs → unzipper → binary → buffers`. The
 * exceljs runtime dependency was removed (#1670, replaced by a native zero-dep
 * xlsx writer), so `buffers` is no longer in the production closure and the
 * override is inert. The mechanism is retained — a future metadata-less
 * transitive dep can be attributed here without code changes — and is exercised
 * by `__tests__/scripts/gen-third-party-licenses.test.ts` via the
 * `--license-overrides-fixture` flag below.
 */
const LICENSE_OVERRIDES = {}

// Effective override map: the fixture (when `--license-overrides-fixture` is
// passed) replaces the hardcoded map, so the positive override path is testable
// without a real metadata-less package. Declared AFTER `LICENSE_OVERRIDES` (the
// fixture falls back to it) to respect the const TDZ.
const EFFECTIVE_OVERRIDES = _overridesPath
  ? JSON.parse(readFileSync(_overridesPath, 'utf8'))
  : LICENSE_OVERRIDES

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Curated license map for companion Claude Code skill suites (#2428) — arbiter DETECTS these at
 * runtime and REFERENCES them (see docs/INTEGRATIONS.md's detect-and-reference policy); it never
 * vendors, ships, or bundles their skill text. Keyed by `pluginOwner` from
 * src/compatibility/skills-matrix.json, mirroring the LICENSE_OVERRIDES escape-hatch pattern
 * above: license identity for a companion cannot be derived from the matrix's `role`/`replaces`
 * fields, so it is curated by hand here rather than invented. Unlisted owners fall back to the
 * "See plugin repo" phrasing docs/INTEGRATIONS.md's own License references table already uses.
 */
const COMPANION_LICENSES = {
  superpowers: 'MIT',
  ponytail: 'MIT',
}

/**
 * Render the "Companion plugins" section from src/compatibility/skills-matrix.json — the SAME
 * SSOT `referenceUrl` fixed by #2428, so a future stale-URL bug fixed there is reflected here
 * automatically instead of drifting a second hardcoded copy. One row per distinct `pluginOwner`
 * (first `referenceUrl` seen wins — every current owner is consistent across its entries).
 */
function renderCompanionSection() {
  const matrix = readJson(SKILLS_MATRIX_PATH)
  const owners = new Map()
  for (const skill of matrix.skills ?? []) {
    if (!owners.has(skill.pluginOwner)) owners.set(skill.pluginOwner, skill.referenceUrl)
  }
  const rows = [...owners.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owner, url]) => {
      const license = COMPANION_LICENSES[owner] ?? 'See plugin repo'
      return `- **${owner}** — ${license}${url ? ` — ${url}` : ''}\n`
    })
  return (
    '## Companion plugins — detected at runtime, never bundled\n\n' +
    "arbiter's skill-detector recognises external Claude Code skill suites already installed " +
    "in the user's environment (see `docs/INTEGRATIONS.md`) and references them instead of " +
    'duplicating equivalent content — arbiter ships no third-party skill text.\n\n' +
    rows.join('')
  )
}

function findLicenseText(pkgDir) {
  let entries
  try {
    entries = readdirSync(pkgDir)
  } catch {
    return null
  }
  // Match LICENSE / LICENCE / LICENSE.md / LICENSE-MIT etc., case-insensitive.
  const candidates = entries
    .filter((f) => /^licen[cs]e/i.test(f))
    .sort((a, b) => a.localeCompare(b))
  if (candidates.length === 0) return null
  try {
    // Normalize line endings and strip per-line trailing whitespace. Some
    // bundled license texts ship CRLF (the repo enforces `eol: lf`) and/or
    // trailing spaces (which prettier strips, even inside fenced blocks).
    // Without this the committed file diverges from a fresh regeneration,
    // breaking both the `--check` gate and the format gate in a clean checkout.
    return readFileSync(join(pkgDir, candidates[0]), 'utf8')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .trim()
  } catch {
    return null
  }
}

function licenseId(pkgJson) {
  if (typeof pkgJson.license === 'string') return pkgJson.license
  if (pkgJson.license && typeof pkgJson.license === 'object' && pkgJson.license.type) {
    return pkgJson.license.type
  }
  if (Array.isArray(pkgJson.licenses)) {
    return pkgJson.licenses
      .map((l) => l.type)
      .filter(Boolean)
      .join(' / ')
  }
  return 'UNKNOWN'
}

function homepageOf(pkgJson) {
  if (typeof pkgJson.homepage === 'string') return pkgJson.homepage
  const repo = pkgJson.repository
  if (typeof repo === 'string') return repo
  if (repo && typeof repo.url === 'string')
    return repo.url.replace(/^git\+/, '').replace(/\.git$/, '')
  return null
}

/**
 * Resolve the full PRODUCTION dependency closure from package-lock.json — npm's
 * authoritative, platform-INDEPENDENT record. Every entry in the lockfile's
 * `packages` map carries npm's own `dev`/`optional`/`license` classification,
 * computed once at resolution time and identical on every machine regardless of
 * which platform-specific OPTIONAL variants happen to be physically installed.
 *
 * An entry is in the production closure iff npm did NOT mark it `dev` — i.e. it
 * is reachable from the root `dependencies`, not solely from devDependencies.
 * Production `optional` deps (dev:false, optional:true) ARE kept: the superset
 * across all platforms, so attribution is complete regardless of this machine's
 * platform. Workspace links (`link:true`) and root/workspace source entries
 * (keys without a `node_modules/` segment) are first-party and pruned. Each kept
 * entry returns its lockfile version + license id and its on-disk `path`
 * (ROOT-relative lockfile key; symlinks in worktrees are followed transparently
 * by the fs when the license text is read). Deduped by name@version, sorted.
 */
function productionClosure() {
  const lockPath = _fixturePath ?? resolve(ROOT, 'package-lock.json')
  let lock
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch (err) {
    throw new Error(
      `Cannot read ${lockPath}: ${err instanceof Error ? err.message : String(err)}. Run \`npm ci\` first.`,
    )
  }
  const packages = lock.packages ?? {}
  const NM = 'node_modules/'
  const byKey = new Map()
  for (const [pkgPath, entry] of Object.entries(packages)) {
    if (!entry || entry.dev || entry.link) continue // dev-only or workspace symlink — prune
    const nmIdx = pkgPath.lastIndexOf(NM)
    if (nmIdx === -1) continue // root "" or workspace source dir — first-party, prune
    const name = pkgPath.slice(nmIdx + NM.length)
    const version = entry.version ?? '0.0.0'
    const key = `${name}@${version}`
    if (!byKey.has(key)) {
      byKey.set(key, {
        name,
        version,
        // license id straight from the lockfile is install-independent; string
        // or object (`{ type }`) forms are normalized by licenseId() at use.
        lockLicense: entry.license ?? null,
        path: resolve(ROOT, pkgPath),
      })
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  )
}

function generate() {
  const deps = productionClosure()

  if (deps.length === 0) {
    return HEADER + '_No production dependencies._\n\n' + renderCompanionSection()
  }

  const sections = []
  const missing = []
  const unresolved = []
  for (const { name, version, lockLicense, path: pkgDir } of deps) {
    // Production deps are non-optional, hence always installed after `npm ci`;
    // an unreadable package.json means a broken install → fail closed (below),
    // never a silently install-dependent output.
    let pkgJson
    try {
      pkgJson = readJson(join(pkgDir, 'package.json'))
    } catch {
      missing.push(name)
      continue
    }
    // License id from the lockfile first (install-independent); fall back to the
    // installed package.json, then a curated override, before failing closed.
    let id = licenseId({ license: lockLicense })
    if (id === 'UNKNOWN') id = licenseId(pkgJson)
    const override = EFFECTIVE_OVERRIDES[`${name}@${version}`]
    if (id === 'UNKNOWN' && override) {
      id = override.id
    }
    if (id === 'UNKNOWN') {
      unresolved.push(`${name}@${version}`)
      continue
    }
    const homepage = homepageOf(pkgJson)
    // ponytail: verbatim text is read from the installed package — deterministic
    // today because every production dep is non-optional (always installed). If a
    // production `optional` platform dep is ever added, its text would vary by
    // install state; attribute it via LICENSE_OVERRIDES or vendor the text then.
    const text = findLicenseText(pkgDir)

    let section = `## ${name}@${version}\n\n`
    section += `- License: ${id}\n`
    if (override) section += `- Attribution source: ${override.source}\n`
    if (homepage) section += `- Homepage: ${homepage}\n`
    section += '\n'
    if (text) {
      section += '```\n' + text + '\n```\n'
    } else {
      section += `_License text not bundled with the package; see ${id}._\n`
    }
    sections.push(section)
  }

  if (missing.length > 0) {
    throw new Error(
      `Cannot generate attribution — these production deps are not installed: ${missing.join(', ')}. Run \`npm ci\` first.`,
    )
  }

  if (unresolved.length > 0) {
    throw new Error(
      `Refusing to emit attribution with an UNKNOWN license — every redistributed dependency must declare one. Unresolved: ${unresolved.join(', ')}. Fix the dependency's metadata or add an explicit attribution.`,
    )
  }

  return HEADER + sections.join('\n') + '\n' + renderCompanionSection()
}

const isCheck = process.argv.includes('--check')

try {
  const content = generate()
  if (isCheck) {
    let current = null
    try {
      current = readFileSync(OUT_FILE, 'utf8')
    } catch {
      current = null
    }
    if (current === null) {
      console.error(
        '[gen-third-party-licenses] FAIL — THIRD_PARTY_LICENSES.md is missing. Run: node scripts/gen-third-party-licenses.mjs',
      )
      process.exit(1)
    }
    if (current !== content) {
      console.error(
        '[gen-third-party-licenses] FAIL — THIRD_PARTY_LICENSES.md is stale. Run: node scripts/gen-third-party-licenses.mjs',
      )
      process.exit(1)
    }
    // Info to stderr so the script never pollutes stdout: `npm pack --json`
    // runs this via prepack and parses stdout as JSON.
    process.stderr.write('[gen-third-party-licenses] OK — THIRD_PARTY_LICENSES.md is up to date\n')
  } else {
    writeFileSync(OUT_FILE, content)
    // Only `## <name>@<version>` headings count as production deps — the `## Companion
    // plugins…` heading (#2428) has no `@version` and must never inflate this count.
    const sectionCount = (content.match(/^## .+@[^@\n]+$/gm) ?? []).length
    process.stderr.write(
      `[gen-third-party-licenses] wrote THIRD_PARTY_LICENSES.md (${sectionCount} production deps, full closure)\n`,
    )
  }
} catch (err) {
  process.stderr.write(
    `[gen-third-party-licenses] error: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
