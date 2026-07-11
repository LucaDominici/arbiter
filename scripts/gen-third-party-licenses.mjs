#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Third-party attribution generator — enumerates the PRODUCTION
// CATALOG: dependencies from package.json, resolves each in node_modules, and
// CATALOG: emits a deterministic THIRD_PARTY_LICENSES.md (name, version, license
// CATALOG: id, homepage, and the verbatim license text). Wired into `prepack`
// CATALOG: so the file ships in the npm tarball (package.json files[] + NOTICE
// CATALOG: reference it). Stands alone because it produces a shipped legal
// CATALOG: artifact from the dep tree — a concern distinct from the license
// CATALOG: ALLOWLIST gate (check that validates permitted SPDX ids), which
// CATALOG: enforces policy rather than producing attribution.
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
// Determinism: dependencies are sorted; only production deps are included —
// devDependencies never ship in the tarball. The set is the FULL production
// dependency closure a consumer installs (every transitive registry package
// reachable from the root `dependencies`), not merely the direct deps: every
// one of those packages carries an attribution obligation (MIT/BSD/ISC require
// the copyright notice be preserved). Local workspace packages (resolved
// `file:`) are pruned — they are first-party, not redistributed third parties.
// Each entry pulls the installed package's own `package.json` (version,
// license, homepage) and the first matching LICENSE* file text, so the output
// reflects what is actually installed, not a hand-maintained list. The
// generator FAILS CLOSED on any unresolved (`UNKNOWN`) license: a legal
// artifact must never silently omit an obligation.
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  globSync,
  lstatSync,
  realpathSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.cwd()
const OUT_FILE = resolve(ROOT, 'THIRD_PARTY_LICENSES.md')

/**
 * In a git worktree, `node_modules` is (or contains) symlinks into the main
 * repo's `node_modules`. Running `npm ls` from the worktree gives a bloated,
 * incorrect production dependency closure (it sees ALL packages in the shared
 * store, not just those reachable from the CLI's production dep graph). Detect
 * the symlink and resolve to the main repo root so `npm ls` reports the
 * correct closure.
 */
function resolveNpmCwd(dir) {
  try {
    const nmPath = join(dir, 'node_modules')
    const stat = lstatSync(nmPath)
    if (stat.isSymbolicLink()) {
      // node_modules is a symlink → git worktree (whole-dir link). Use the
      // real parent as npm cwd.
      return resolve(realpathSync(nmPath), '..')
    }
    // #1928: `arbiter wt open` links node_modules' individual top-level
    // entries (children), not the whole directory — so node_modules itself
    // is a real directory here. Detect via the first symlinked child and
    // derive the real node_modules root from its target.
    for (const entry of readdirSync(nmPath)) {
      let entryStat
      try {
        entryStat = lstatSync(join(nmPath, entry))
      } catch {
        continue
      }
      if (entryStat.isSymbolicLink()) {
        return resolve(realpathSync(join(nmPath, entry)), '..', '..')
      }
    }
  } catch {
    /* no node_modules or stat failed — use dir as-is */
  }
  return dir
}

const NPM_ROOT = resolveNpmCwd(ROOT)

// --npm-ls-fixture=<path> or --npm-ls-fixture <path>: substitute a JSON file for the
// `npm ls` spawn (testing only). Supports both `=` and space-separated forms.
const _fixtureIdx = process.argv.findIndex(
  (a) => a === '--npm-ls-fixture' || a.startsWith('--npm-ls-fixture='),
)
const _fixturePath =
  _fixtureIdx === -1
    ? null
    : process.argv[_fixtureIdx].startsWith('--npm-ls-fixture=')
      ? process.argv[_fixtureIdx].slice('--npm-ls-fixture='.length)
      : (process.argv[_fixtureIdx + 1] ?? null)

// --license-overrides-fixture=<path> or space form: substitute a JSON file for the
// LICENSE_OVERRIDES map (testing only). The override mechanism is a dormant escape
// hatch (the map is currently empty — see LICENSE_OVERRIDES docstring); this flag
// lets the positive override path + `source` audit trail be exercised by a
// synthetic fixture without depending on a real metadata-less package. Supports
// both `=` and space-separated forms, mirroring `--npm-ls-fixture`.
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
license. It is generated by \`scripts/gen-third-party-licenses.mjs\` from the
installed production dependency tree; do not edit it by hand.

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
 * Collect the `name` fields of all local workspace packages declared in the
 * root `package.json#workspaces` globs. Used to distinguish first-party
 * workspace packages (which carry `file:` resolved paths in `npm ls --long`)
 * from third-party registry packages whose paths happen to be `file:` paths
 * in git worktrees where `node_modules` is a symlink to the main repo.
 */
function readWorkspaceNames() {
  const pkg = JSON.parse(readFileSync(join(NPM_ROOT, 'package.json'), 'utf8'))
  const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : []
  const names = new Set()
  for (const pattern of patterns) {
    const dirs = globSync(pattern, { cwd: NPM_ROOT })
    for (const dir of dirs) {
      try {
        const ws = JSON.parse(readFileSync(join(NPM_ROOT, dir, 'package.json'), 'utf8'))
        if (ws.name) names.add(ws.name)
      } catch {
        /* missing package.json — skip */
      }
    }
  }
  return names
}

/**
 * Resolve the full production dependency closure via `npm ls`. Returns one
 * entry per distinct package@version actually installed, with its on-disk
 * `path` (transitive deps may be nested under a parent or installed at several
 * versions — the path from `npm ls --long` is the only reliable resolver).
 * Local workspace packages (resolved `file:` AND name in workspaces set) are
 * pruned: they are first-party, not redistributed third parties. Third-party
 * packages with `file:` resolved paths (as seen in git worktrees where
 * node_modules is a symlink) are retained. Entries are sorted name-then-version.
 */
function productionClosure() {
  let raw
  if (_fixturePath) {
    raw = readFileSync(_fixturePath, 'utf8')
  } else {
    try {
      raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], {
        // Use NPM_ROOT (main repo root in worktrees) so `npm ls` reports the
        // correct production closure rather than the entire shared node_modules.
        cwd: NPM_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        // `npm ls` exits non-zero on benign peer-dep warnings; we only need the
        // JSON tree it always prints, so capture stdout regardless of exit code.
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch (err) {
      // execFileSync throws on non-zero exit but still attaches captured stdout.
      raw = err && typeof err.stdout === 'string' ? err.stdout : ''
      if (!raw) {
        throw new Error(
          `Cannot enumerate production dependency closure: ${err instanceof Error ? err.message : String(err)}. Run \`npm ci\` first.`,
        )
      }
    }
  }
  const tree = JSON.parse(raw)
  const workspaceNames = readWorkspaceNames()
  const byKey = new Map()
  const walk = (node) => {
    const deps = node && node.dependencies ? node.dependencies : {}
    for (const [name, child] of Object.entries(deps)) {
      if (child && child.missing) continue // peer dep listed but not installed — skip
      const resolved = (child && child.resolved) || ''
      if (resolved.startsWith('file:') && workspaceNames.has(name)) continue // first-party workspace — prune
      const version = (child && child.version) || '0.0.0'
      const key = `${name}@${version}`
      if (!byKey.has(key)) {
        byKey.set(key, {
          name,
          version,
          path: (child && child.path) || resolve(NPM_ROOT, 'node_modules', name),
        })
        walk(child)
      }
    }
  }
  walk(tree)
  return [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  )
}

function generate() {
  const deps = productionClosure()

  if (deps.length === 0) {
    return HEADER + '_No production dependencies._\n'
  }

  const sections = []
  const missing = []
  const unresolved = []
  for (const { name, path: pkgDir } of deps) {
    let pkgJson
    try {
      pkgJson = readJson(join(pkgDir, 'package.json'))
    } catch {
      missing.push(name)
      continue
    }
    let id = licenseId(pkgJson)
    const override = EFFECTIVE_OVERRIDES[`${name}@${pkgJson.version}`]
    if (id === 'UNKNOWN' && override) {
      id = override.id
    }
    if (id === 'UNKNOWN') {
      unresolved.push(`${name}@${pkgJson.version}`)
      continue
    }
    const homepage = homepageOf(pkgJson)
    const text = findLicenseText(pkgDir)

    let section = `## ${name}@${pkgJson.version}\n\n`
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

  return HEADER + sections.join('\n')
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
    const sectionCount = (content.match(/^## /gm) ?? []).length
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
