// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync, execSync } from 'node:child_process'
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  globSync,
  lstatSync,
  realpathSync,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/gen-third-party-licenses.mjs')
const OUT = resolve('THIRD_PARTY_LICENSES.md')

/**
 * When `node_modules` is a symlink (git worktree), `npm ls` must run from the
 * real main repo root to report the correct production closure. Otherwise it
 * sees the entire shared node_modules and reports all packages as candidates.
 */
function resolveNpmCwd(): string {
  const cwd = resolve('.')
  try {
    const nmPath = join(cwd, 'node_modules')
    const stat = lstatSync(nmPath)
    if (stat.isSymbolicLink()) {
      return resolve(realpathSync(nmPath), '..')
    }
  } catch {
    /* no node_modules or stat failed — use cwd */
  }
  return cwd
}

const NPM_CWD = resolveNpmCwd()

/**
 * Collect the names of all local workspace packages declared in the root
 * package.json#workspaces globs. Reads from NPM_CWD (main repo root in
 * worktrees) to resolve workspace dirs correctly.
 */
function workspaceNames(): Set<string> {
  const pkg = JSON.parse(readFileSync(join(NPM_CWD, 'package.json'), 'utf8')) as {
    workspaces?: string[]
  }
  const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : []
  const names = new Set<string>()
  for (const pattern of patterns) {
    const dirs = globSync(pattern, { cwd: NPM_CWD })
    for (const dir of dirs) {
      try {
        const ws = JSON.parse(readFileSync(join(NPM_CWD, dir, 'package.json'), 'utf8')) as {
          name?: string
        }
        if (ws.name) names.add(ws.name)
      } catch {
        /* missing package.json — skip */
      }
    }
  }
  return names
}

/**
 * The true production dependency closure a consumer installs with
 * `npm install @arbiter/cli` — every registry package reachable from the
 * root `dependencies`, pruning local workspace packages (resolved `file:`
 * AND name in the workspace set) whose own subtrees are not part of
 * arbiter's runtime. This is what the attribution file must cover, not
 * merely the 5 direct deps.
 */
function productionClosure(): string[] {
  const raw = execSync('npm ls --omit=dev --all --json', {
    cwd: NPM_CWD,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const tree = JSON.parse(raw) as {
    dependencies?: Record<
      string,
      { resolved?: string; missing?: boolean; version?: string; dependencies?: unknown }
    >
  }
  const wsNames = workspaceNames()
  const acc: Record<string, true> = {}
  const walk = (node: { dependencies?: Record<string, unknown> }): void => {
    const deps = (node.dependencies ?? {}) as Record<
      string,
      { resolved?: string; missing?: boolean; dependencies?: unknown }
    >
    for (const [name, child] of Object.entries(deps)) {
      if (child.missing) continue // peer dep listed but not installed — skip
      const resolved = child.resolved ?? ''
      if (resolved.startsWith('file:') && wsNames.has(name)) continue // prune local workspace subtree
      if (!acc[name]) {
        acc[name] = true
        walk(child as { dependencies?: Record<string, unknown> })
      }
    }
  }
  walk(tree)
  return Object.keys(acc).sort((a, b) => a.localeCompare(b))
}

function run(args: string[]) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('gen-third-party-licenses.mjs', () => {
  it('committed THIRD_PARTY_LICENSES.md is up to date (--check passes)', () => {
    const result = run(['--check'])
    expect(result.status).toBe(0)
    // Info is on stderr so stdout stays clean for `npm pack --json` consumers.
    expect(result.stderr).toContain('up to date')
    expect(result.stdout).toBe('')
  })

  it('write mode keeps stdout clean (prepack runs under `npm pack --json`)', () => {
    // Regenerating must not print to stdout, or it corrupts the JSON that
    // `npm pack --dry-run --json` emits when prepack runs this generator.
    const result = run([])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('wrote THIRD_PARTY_LICENSES.md')
  })

  it('the committed file exists and lists every production dependency', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    const deps = Object.keys(pkg.dependencies ?? {})
    expect(deps.length).toBeGreaterThan(0)
    const content = readFileSync(OUT, 'utf8')
    for (const dep of deps) {
      // Each dependency gets a `## <name>@<version>` section.
      expect(content).toContain(`## ${dep}@`)
    }
  })

  it('attributes the FULL production dependency closure, not just direct deps', () => {
    // A consumer of `@arbiter/cli` installs the entire transitive production
    // tree; every one of those packages carries an attribution obligation
    // (MIT/BSD/ISC require the copyright notice be preserved). Listing only
    // the 5 direct deps while shipping ~90 transitive ones is a legal gap.
    const closure = productionClosure()
    // Sanity: the closure is materially larger than the direct deps.
    const directCount = Object.keys(
      JSON.parse(readFileSync(resolve('package.json'), 'utf8')).dependencies ?? {},
    ).length
    expect(closure.length).toBeGreaterThan(directCount)
    const content = readFileSync(OUT, 'utf8')
    const missing = closure.filter((dep) => !content.includes(`## ${dep}@`))
    expect(missing, `unattributed production deps: ${missing.join(', ')}`).toEqual([])
  })

  it('applies a sourced override to a metadata-less dependency (positive path, #1670)', () => {
    // After removing exceljs (#1670), the LICENSE_OVERRIDES map is empty — but the
    // override MECHANISM is retained as a dormant escape hatch and must still work
    // for a future metadata-less transitive dep. Build a throwaway package with no
    // license field, a fixture closure pointing at it, and a fixture override
    // attributing it MIT; the generator must emit the section + the `source` audit
    // trail (not fail-closed on UNKNOWN). Uses --license-overrides-fixture so the
    // positive path is covered without depending on a real metadata-less package.
    const root = mkdtempSync(join(tmpdir(), 'tpl-override-'))
    const closureFixture = join(tmpdir(), `tpl-override-closure-${process.pid}.json`)
    const overridesFixture = join(tmpdir(), `tpl-override-overrides-${process.pid}.json`)
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'tpl-override-fixture',
          version: '0.0.0',
          private: true,
          dependencies: { 'nolicense-pkg': '1.0.0' },
        }),
      )
      const pkgDir = join(root, 'node_modules', 'nolicense-pkg')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'nolicense-pkg', version: '1.0.0' }),
      )
      writeFileSync(
        closureFixture,
        JSON.stringify({
          name: 'tpl-override-fixture',
          version: '0.0.0',
          dependencies: { 'nolicense-pkg': { version: '1.0.0', path: pkgDir, dependencies: {} } },
        }),
      )
      writeFileSync(
        overridesFixture,
        JSON.stringify({
          'nolicense-pkg@1.0.0': { id: 'MIT', source: 'synthetic test override' },
        }),
      )
      const result = spawnSync(
        'node',
        [
          SCRIPT,
          '--npm-ls-fixture',
          closureFixture,
          '--license-overrides-fixture',
          overridesFixture,
        ],
        { encoding: 'utf-8', cwd: root },
      )
      expect(result.status).toBe(0)
      const out = readFileSync(join(root, 'THIRD_PARTY_LICENSES.md'), 'utf8')
      expect(out).toContain('## nolicense-pkg@1.0.0')
      expect(out).toContain('- License: MIT')
      // The escape hatch must be auditable — it records WHY the license was set.
      expect(out).toContain('- Attribution source: synthetic test override')
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(closureFixture, { force: true })
      rmSync(overridesFixture, { force: true })
    }
  })

  it('does NOT attribute local workspace packages (resolved file:)', () => {
    // `@arbiter/website` is a sibling workspace (resolved `file:../../website`),
    // not a redistributed third party — it must never appear in attribution.
    const content = readFileSync(OUT, 'utf8')
    expect(content).not.toContain('@arbiter/website')
  })

  it('fails closed on an UNKNOWN license (no silent attribution gap)', () => {
    // A legal artifact must never silently emit `UNKNOWN`. Build a throwaway
    // project whose sole dependency has no license field and run the generator
    // there: it must exit non-zero rather than producing an UNKNOWN section.
    // The fixture is created at runtime (its `node_modules/` is gitignored, so
    // it cannot be committed) and torn down afterwards.
    const root = mkdtempSync(join(tmpdir(), 'tpl-unknown-'))
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'tpl-unknown-fixture',
          version: '0.0.0',
          private: true,
          dependencies: { 'nolicense-pkg': '1.0.0' },
        }),
      )
      const pkgDir = join(root, 'node_modules', 'nolicense-pkg')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'nolicense-pkg', version: '1.0.0' }),
      )
      const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: root })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/UNKNOWN|no resolvable license|unresolved/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('emits a license id and verbatim license text for each dependency', () => {
    const content = readFileSync(OUT, 'utf8')
    // At least one MIT and the Apache-2.0 (ejs) dep are present and have a
    // fenced license block.
    expect(content).toContain('- License: MIT')
    expect(content).toContain('- License: Apache-2.0')
    expect(content).toMatch(/```[\s\S]*?Permission is hereby granted[\s\S]*?```/)
  })

  it('NOTICE references the same .md filename (no extension mismatch)', () => {
    const notice = readFileSync(resolve('NOTICE'), 'utf8')
    expect(notice).toContain('THIRD_PARTY_LICENSES.md')
    expect(notice).not.toContain('THIRD_PARTY_LICENSES.txt')
  })

  it('package.json files[] ships THIRD_PARTY_LICENSES.md', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    expect(pkg.files).toContain('THIRD_PARTY_LICENSES.md')
  })

  it('includes registry packages with file: paths when not in workspaces (#1695)', () => {
    // In git worktrees, `npm ls --long` resolves ALL packages through the
    // node_modules symlink, yielding `file:` resolved paths for every package
    // — including real registry deps. The old filter pruned ALL `file:` paths,
    // yielding 0 deps. The fix prunes only packages whose name is in the local
    // workspace set. This test builds a fixture dynamically (paths must point to
    // packages actually installed on this machine — machine-agnostic) that
    // simulates the worktree output and verifies both packages appear in the
    // generated attribution.
    const nmDir = join(NPM_CWD, 'node_modules')
    const semverVersion = (
      JSON.parse(readFileSync(join(nmDir, 'semver', 'package.json'), 'utf8')) as {
        version: string
      }
    ).version
    const ejsVersion = (
      JSON.parse(readFileSync(join(nmDir, 'ejs', 'package.json'), 'utf8')) as { version: string }
    ).version
    const fixtureData = JSON.stringify({
      name: '@arbiter/cli',
      version: '0.0.0',
      dependencies: {
        semver: {
          version: semverVersion,
          resolved: 'file:../../../../arbiter/node_modules/semver',
          path: join(nmDir, 'semver'),
          dependencies: {},
        },
        ejs: {
          version: ejsVersion,
          resolved: 'file:../../../../arbiter/node_modules/ejs',
          path: join(nmDir, 'ejs'),
          dependencies: {},
        },
      },
    })
    const tempFixture = join(tmpdir(), `npm-ls-worktree-${process.pid}.json`)
    writeFileSync(tempFixture, fixtureData)
    const original = readFileSync(OUT, 'utf8')
    try {
      const result = run(['--npm-ls-fixture', tempFixture])
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('wrote THIRD_PARTY_LICENSES.md')
      const written = readFileSync(OUT, 'utf8')
      expect(written).toContain('## semver@')
      expect(written).toContain('## ejs@')
    } finally {
      writeFileSync(OUT, original)
      rmSync(tempFixture, { force: true })
    }
  })
})
