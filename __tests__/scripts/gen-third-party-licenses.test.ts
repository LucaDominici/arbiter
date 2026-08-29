// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/gen-third-party-licenses.mjs')
const OUT = resolve('THIRD_PARTY_LICENSES.md')

/**
 * The true production dependency closure a consumer installs with
 * `npm install @arbiter/cli`, read from package-lock.json — the SAME
 * authoritative source the generator uses, so this oracle is deterministic and
 * install-independent. An entry is production iff npm did NOT mark it `dev`;
 * production `optional` deps stay (cross-platform superset). Workspace links
 * (`link:true`) and the root/workspace source entries (keys without a
 * `node_modules/` segment) are first-party and pruned. Returns distinct package
 * names, sorted. This must cover the full transitive closure, not just the
 * direct deps.
 */
function productionClosure(): string[] {
  const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string; dev?: boolean; link?: boolean }>
  }
  const NM = 'node_modules/'
  const names = new Set<string>()
  for (const [pkgPath, entry] of Object.entries(lock.packages)) {
    if (!entry || entry.dev || entry.link) continue
    const nmIdx = pkgPath.lastIndexOf(NM)
    if (nmIdx === -1) continue
    names.add(pkgPath.slice(nmIdx + NM.length))
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/** Names of the `## <name>@<version>` sections in the attribution file. */
function attributedNames(content: string): string[] {
  return [...content.matchAll(/^## (.+?)@[^@\n]+$/gm)].map((m) => m[1]).sort()
}

function run(args: string[]) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Build a throwaway root whose sole dependency `nolicense-pkg@1.0.0` ships no
 * `license` field — the shared setup for the UNKNOWN-fail-closed test and the
 * override-positive-path test. Returns the root + the on-disk package dir.
 * Caller owns cleanup (`rmSync(root, { recursive: true, force: true })`).
 */
function makeNoLicensePkgRoot(prefix: string): { root: string; pkgDir: string } {
  const root = mkdtempSync(join(tmpdir(), prefix))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: `${prefix}-fixture`,
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
  return { root, pkgDir }
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

  it('attributes EXACTLY the production closure from the lockfile — no dev-only leakage', () => {
    // A consumer of `@arbiter/cli` installs the entire transitive production
    // tree; every one of those packages carries an attribution obligation
    // (MIT/BSD/ISC require the copyright notice be preserved), and NOTHING a
    // consumer never receives (devDependencies and their optional platform
    // variants) may appear. The old generator derived the closure from an
    // `npm ls --omit=dev` walk over physically-installed node_modules, which is
    // install-dependent AND leaked six dev-only optional+peer wasm packages
    // (@emnapi/*, @napi-rs/wasm-runtime, @tybys/wasm-util, tslib) whenever the
    // wasm32-wasi variant happened to be installed. This asserts EXACT set
    // equality against the lockfile's own dev classification, so both a missing
    // production dep AND an extra dev-only leak fail the gate.
    const closure = productionClosure()
    const directCount = Object.keys(
      JSON.parse(readFileSync(resolve('package.json'), 'utf8')).dependencies ?? {},
    ).length
    expect(closure.length).toBeGreaterThan(directCount) // transitive, not just direct
    const attributed = attributedNames(readFileSync(OUT, 'utf8'))
    expect(new Set(attributed)).toEqual(new Set(closure))
    // Explicit regression guard for the exact packages that leaked (#license-gen).
    for (const devOnly of ['@emnapi/core', '@napi-rs/wasm-runtime', '@tybys/wasm-util', 'tslib']) {
      expect(attributed).not.toContain(devOnly)
    }
  })

  it('applies a sourced override to a metadata-less dependency (positive path, #1670)', () => {
    // After removing exceljs (#1670), the LICENSE_OVERRIDES map is empty — but the
    // override MECHANISM is retained as a dormant escape hatch and must still work
    // for a future metadata-less transitive dep. Build a throwaway package with no
    // license field, a fixture closure pointing at it, and a fixture override
    // attributing it MIT; the generator must emit the section + the `source` audit
    // trail (not fail-closed on UNKNOWN). Uses --license-overrides-fixture so the
    // positive path is covered without depending on a real metadata-less package.
    const { root } = makeNoLicensePkgRoot('tpl-override')
    const lockFixture = join(tmpdir(), `tpl-override-lock-${process.pid}.json`)
    const overridesFixture = join(tmpdir(), `tpl-override-overrides-${process.pid}.json`)
    try {
      // A lockfile whose sole production entry (nolicense-pkg) carries NO
      // `license` field → licenseId falls to UNKNOWN → the override supplies it.
      // path resolves ROOT-relative to root/node_modules/nolicense-pkg, created
      // by makeNoLicensePkgRoot (also license-less), so the installed-pkg.json
      // fallback stays UNKNOWN too.
      writeFileSync(
        lockFixture,
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            '': {},
            'node_modules/nolicense-pkg': {
              version: '1.0.0',
              resolved: 'https://registry.npmjs.org/nolicense-pkg/-/nolicense-pkg-1.0.0.tgz',
            },
          },
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
          '--lockfile-fixture',
          lockFixture,
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
      rmSync(lockFixture, { force: true })
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
    // project whose sole production dependency has no license field — in the
    // lockfile AND in the installed package.json — and run the generator there:
    // it must exit non-zero rather than producing an UNKNOWN section. The
    // fixtures are created at runtime and torn down afterwards.
    const { root } = makeNoLicensePkgRoot('tpl-unknown')
    const lockFixture = join(tmpdir(), `tpl-unknown-lock-${process.pid}.json`)
    try {
      writeFileSync(
        lockFixture,
        JSON.stringify({
          lockfileVersion: 3,
          packages: { '': {}, 'node_modules/nolicense-pkg': { version: '1.0.0' } },
        }),
      )
      const result = spawnSync('node', [SCRIPT, '--lockfile-fixture', lockFixture], {
        encoding: 'utf-8',
        cwd: root,
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/UNKNOWN|no resolvable license|unresolved/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(lockFixture, { force: true })
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

  describe('companion plugins section (#2428)', () => {
    it('THIRD_PARTY_LICENSES.md names Superpowers and ponytail, detected-never-bundled', () => {
      const content = readFileSync(OUT, 'utf8')
      expect(content).toContain('## Companion plugins')
      expect(content).toContain('https://github.com/obra/superpowers')
      expect(content).toContain('https://github.com/DietrichGebert/ponytail')
      expect(content).toMatch(/superpowers/i)
      expect(content).toMatch(/ponytail/i)
      expect(content).toContain('MIT')
      expect(content).toMatch(/never ship|ships no third-party skill text/i)
    })

    it('write-mode log line counts only production-dependency sections, not the companion heading', () => {
      const result = run([])
      expect(result.status).toBe(0)
      const content = readFileSync(OUT, 'utf8')
      const depSections = [...content.matchAll(/^## (.+?)@[^@\n]+$/gm)].length
      const match = /\((\d+) production deps, full closure\)/.exec(result.stderr)
      expect(match).not.toBeNull()
      expect(Number(match?.[1])).toBe(depSections)
    })

    it('NOTICE carries the same detected-never-bundled policy sentence', () => {
      const notice = readFileSync(resolve('NOTICE'), 'utf8')
      expect(notice).toMatch(/companion plugin/i)
      expect(notice).toMatch(/superpowers/i)
      expect(notice).toMatch(/ponytail/i)
      expect(notice).toMatch(/never ship|ships no third-party skill text/i)
    })

    it('docs/INTEGRATIONS.md links to the THIRD_PARTY_LICENSES.md companion section', () => {
      const integrations = readFileSync(resolve('docs/INTEGRATIONS.md'), 'utf8')
      expect(integrations).toMatch(/THIRD_PARTY_LICENSES\.md#companion-plugins/)
      expect(integrations).toMatch(/NOTICE/)
    })
  })

  it('package.json files[] ships THIRD_PARTY_LICENSES.md', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    expect(pkg.files).toContain('THIRD_PARTY_LICENSES.md')
  })

  it('closure is derived from the lockfile dev flag, independent of install state', () => {
    // The core determinism guarantee: a package's membership follows npm's
    // lockfile `dev` classification, NOT whether it is physically installed.
    // Two lockfile fixtures with the SAME production entry but DIFFERENT
    // dev-only siblings (one present, one absent — simulating a platform where
    // an optional dev variant did vs did not install) must yield the SAME
    // attribution. This is exactly the axis the old `npm ls` walk got wrong.
    const { root } = makeNoLicensePkgRoot('tpl-determinism')
    // Give the installed package an MIT license so it resolves without override.
    writeFileSync(
      join(root, 'node_modules', 'nolicense-pkg', 'package.json'),
      JSON.stringify({ name: 'nolicense-pkg', version: '1.0.0', license: 'MIT' }),
    )
    const withDev = join(tmpdir(), `tpl-det-withdev-${process.pid}.json`)
    const withoutDev = join(tmpdir(), `tpl-det-nodev-${process.pid}.json`)
    try {
      const prodEntry = {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/nolicense-pkg/-/nolicense-pkg-1.0.0.tgz',
        license: 'MIT',
      }
      // Same production dep; the dev-only optional sibling exists in one lockfile
      // and not the other — attribution must ignore it in BOTH.
      writeFileSync(
        withDev,
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            '': {},
            'node_modules/nolicense-pkg': prodEntry,
            'node_modules/@emnapi/core': {
              version: '1.11.1',
              license: 'MIT',
              dev: true,
              optional: true,
            },
          },
        }),
      )
      writeFileSync(
        withoutDev,
        JSON.stringify({
          lockfileVersion: 3,
          packages: { '': {}, 'node_modules/nolicense-pkg': prodEntry },
        }),
      )
      const a = spawnSync('node', [SCRIPT, '--lockfile-fixture', withDev], {
        encoding: 'utf-8',
        cwd: root,
      })
      const outA = readFileSync(join(root, 'THIRD_PARTY_LICENSES.md'), 'utf8')
      const b = spawnSync('node', [SCRIPT, '--lockfile-fixture', withoutDev], {
        encoding: 'utf-8',
        cwd: root,
      })
      const outB = readFileSync(join(root, 'THIRD_PARTY_LICENSES.md'), 'utf8')
      expect(a.status).toBe(0)
      expect(b.status).toBe(0)
      expect(outA).toBe(outB) // dev-only sibling's install state changed nothing
      expect(outA).toContain('## nolicense-pkg@1.0.0')
      expect(outA).not.toContain('@emnapi/core') // dev-only never attributed
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(withDev, { force: true })
      rmSync(withoutDev, { force: true })
    }
  })
})
