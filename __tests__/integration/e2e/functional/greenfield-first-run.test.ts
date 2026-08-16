// SPDX-License-Identifier: Apache-2.0
// Wave 1 A1 (#1491-B4 smoking gun) — "generated-project gate GREEN on first run,
// through the REAL packaged entry point". This is the test-pyramid level-4 case
// the audit found missing.
//
// Why the existing bake/functional fixtures never caught #1491-B4: EVERY fixture
// under __tests__/fixtures/real-projects ships its OWN pre-existing .prettierrc /
// .prettierignore (see ts-library, ts-backend-web-db, ts-codex-only, ...). That
// happens to mask two real generator bugs discovered while fixing this: (a) the
// generated .prettierignore was missing `.agents/` (the codex-tool track's own
// governance dir — `.claude/`, `.codex/`, `.cursor/` were already ignored, `.agents/`
// was not), and (b) some generators call formatContent() before
// `.prettierrc.json` exists on disk in the SAME init run (generator-registry
// ordering), so they format against prettier's built-in defaults instead of the
// target's real style. A fixture that already has a prettier config on disk
// before `init` runs never exercises either path — `resolvePrettierInvocation`
// finds a config immediately either way. This harness starts from a truly bare
// skeleton (no prettier config at all — arbiter must generate one, including the
// generator-ordering-sensitive path) and drives `arbiter init` through the
// PACKAGED dist/cli.js binary (not the in-process runInit()), matching how every
// real consumer invokes it.
//
// Also closes the "green-only" half of the gap (FP-1/FP-5 in FRAMEWORK_AUDIT.md):
// the seeded-violation describe block below asserts the SAME gate exits non-zero
// on a real violation, so this harness cannot be satisfied by a gate that always
// exits 0 (Terraform-acceptance: green on clean AND red on a seeded violation).
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { missingBinaries } from '../helpers.js'

const L2 = process.env.VITEST_L2 === '1'
const REPO_ROOT = process.cwd()
const CLI_MISSING_REASON = 'dist/cli.js not built (run `npm run build` first)'

// Isolate this file's dist/cli.js from a genuine hazard: packaged-artifact.test.ts
// runs `npm pack`, which triggers the `prepack` lifecycle script (`npm run build`
// → `rm -rf dist && …`). vitest runs integration test FILES concurrently (forks
// pool), so that rebuild can delete/recreate the repo's shared dist/ WHILE this
// file's spawned `node dist/cli.js` calls are mid-flight, MODULE_NOT_FOUND-ing
// them. No other file depended on dist/cli.js directly (the rest use in-process
// runInit()), so the hazard was latent until this file — the one the task
// specifically requires to go through the REAL packaged entry point. Fix: copy
// dist/ once into a process-private dir this file owns exclusively. Must stay
// INSIDE the repo tree (under .arbiter/, already gitignored wholesale) rather
// than os.tmpdir() — cli.js's bare imports (commander, ejs, …) resolve via
// Node's standard upward node_modules walk, which only finds REPO_ROOT's
// node_modules if the copy has REPO_ROOT as an ancestor.
const distSourceMissing = !existsSync(join(REPO_ROOT, 'dist', 'cli.js'))
let privateDistDir: string | null = null
let CLI = join(REPO_ROOT, 'dist', 'cli.js')
if (!distSourceMissing) {
  const arbiterDir = join(REPO_ROOT, '.arbiter')
  mkdirSync(arbiterDir, { recursive: true })
  // #1986: self-heal from a prior run killed before afterAll ran (timeout,
  // host contention, SIGKILL, operator abort). mkdtempSync names are unique
  // per-run, so a sibling greenfield-dist-* here is always stale — sweep it
  // before creating this run's own copy, rather than relying on afterAll
  // alone. Leftovers otherwise persist and can be scanned by unrelated
  // checks that walk the repo tree.
  for (const entry of readdirSync(arbiterDir)) {
    if (entry.startsWith('greenfield-dist-')) {
      rmSync(join(arbiterDir, entry), { recursive: true, force: true })
    }
  }
  privateDistDir = mkdtempSync(join(arbiterDir, 'greenfield-dist-'))
  cpSync(join(REPO_ROOT, 'dist'), privateDistDir, { recursive: true })
  CLI = join(privateDistDir, 'cli.js')
}

afterAll(() => {
  if (privateDistDir != null) rmSync(privateDistDir, { recursive: true, force: true })
})

function initGit(dir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  // arbiter-suppress(INV-12, until=2099-01-01, reason="fixture email for git config in E2E harness", owner=@luca)
  execFileSync('git', ['config', 'user.email', 'e2e@arbiter.test'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Arbiter E2E'], { cwd: dir, stdio: 'ignore' })
}

function commitAll(dir: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', message, '--no-verify'], { cwd: dir, stdio: 'ignore' })
}

// A bare TS skeleton with NO .prettierrc/.prettierignore/tsconfig.json of its
// own — arbiter must generate its own prettier config AND tsconfig from
// scratch, which is exactly the scenario every existing fixture (by shipping
// its own copies) never exercises.
function scaffoldBareTsSkeleton(dir: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'greenfield-fixture', version: '1.0.0', private: true }, null, 2) + '\n',
  )
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'src', 'index.ts'),
    "export function hello(): string {\n  return 'hello'\n}\n",
  )
}

function scaffoldBareCargoSkeleton(dir: string): void {
  execFileSync('cargo', ['init', '--name', 'greenfield_fixture', '-q', '.'], {
    cwd: dir,
    stdio: 'ignore',
  })
  // Pin edition 2021 explicitly — `cargo init`'s default tracks the HOST's
  // installed rustc/cargo version (2024 on a recent toolchain), and rustfmt's
  // import-sort order is edition-style dependent (case-sensitive ASCII sort in
  // the 2024 style vs case-insensitive in 2021). arbiter's own generated
  // rustfmt.toml (static-analysis/rustfmt.toml.ejs) pins edition = "2021" —
  // same as every real-projects/rust-* fixture — so the skeleton must match
  // that, or this cell's rustfmt expectation drifts with whatever cargo
  // version happens to run the suite instead of testing arbiter's own target.
  const cargoToml = join(dir, 'Cargo.toml')
  writeFileSync(
    cargoToml,
    readFileSync(cargoToml, 'utf-8').replace(/edition = "\d+"/, 'edition = "2021"'),
  )
}

function runCli(dir: string, args: string[]): { status: number; output: string } {
  const r = spawnSync('node', [CLI, ...args], { cwd: dir, encoding: 'utf-8', timeout: 120_000 })
  return { status: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') }
}

// 'gate' is the real subcommand alias cited in the release-readiness verdict
// (`check-all.mjs gate`) — it maps to L2 inside the generated script's own
// _SUBCOMMAND_LEVEL table, same as omitting the argument entirely.
function runGate(
  dir: string,
  level: 'L1' | 'L2' | 'L3' | 'gate',
  gateId?: string,
): { status: number; output: string } {
  const scriptPath = join(dir, 'scripts', 'check-all.mjs')
  if (!existsSync(scriptPath)) {
    return { status: 127, output: `check-all.mjs not generated at ${scriptPath}` }
  }
  const r = spawnSync('node', [scriptPath, level, ...(gateId ? ['--gate', gateId] : [])], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, CI: 'true' },
  })
  return { status: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') }
}

// #2257 AC-3 / CANON-23: read the NAMED gate's own status line out of the gate
// output. Every cell below asserts THIS, never the process exit code — a gate
// that SKIPs (missing binary, absent config file, unset env var) exits 0 exactly
// like a gate that ran and passed, so an exit-code assertion is satisfied by a
// gate that never executed. That false-covered signal is the precise fiction
// #2244 exists to remove from the RTM, so it must not be re-introduced by the
// very tests that close its rows.
function gateStatus(output: string, gateName: string): string | null {
  const escaped = gateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\[CHECK\\] ${escaped} \\.\\.\\. (\\w+)`, 'm').exec(output)?.[1] ?? null
}

// The gate manifest (`--dry-run`) lists the gates the generator actually EMITTED
// into this project, independent of whether they would pass. Used to prove
// emission survives a config round-trip.
function emittedGateIds(dir: string): string[] {
  const r = spawnSync('node', [join(dir, 'scripts', 'check-all.mjs'), 'L3', '--dry-run'], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, CI: 'true' },
  })
  return ((r.stdout ?? '') + (r.stderr ?? '')).split('\n').flatMap((l) => {
    const m = /^ {2}L[123] {2}(\S+) {2}/.exec(l)
    return m?.[1] != null ? [m[1]] : []
  })
}

interface Cell {
  name: string
  language: 'typescript' | 'rust'
  archetype: string
  tools: string
  binaries: readonly string[]
}

const CELLS: Cell[] = [
  // The exact #1491-B4 smoking gun: the codex tool track. Every existing
  // bake/functional fixture defaults `tools` to 'claude' (see helpers.ts
  // FixtureManifest comment on #1885) — none exercise codex through a gate exec.
  {
    name: 'ts/library/codex',
    language: 'typescript',
    archetype: 'library',
    tools: 'codex',
    binaries: ['node', 'npx'],
  },
  // Exercises the FSD-boundaries flat-config fix + render-smoke formatContent fix.
  {
    name: 'ts/frontend-spa/claude+codex',
    language: 'typescript',
    archetype: 'frontend-spa',
    tools: 'claude,codex',
    binaries: ['node', 'npx'],
  },
  // Exercises the api-e2e.ts formatContent-before-config-exists ordering fix.
  {
    name: 'ts/backend-web-db/claude+codex',
    language: 'typescript',
    archetype: 'backend-web-db',
    tools: 'claude,codex',
    binaries: ['node', 'npx'],
  },
  // Exercises the rustfmt import-order fix in example_bdd_test.rs.ejs.
  {
    name: 'rust/library/claude',
    language: 'rust',
    archetype: 'library',
    tools: 'claude',
    binaries: ['cargo', 'rustfmt', 'cargo-clippy'],
  },
]

describe.skipIf(!L2)('greenfield first-run — real dist/cli.js entry point (#1491-B4)', () => {
  const cliMissing = !existsSync(CLI)

  for (const cell of CELLS) {
    const missing = missingBinaries(cell.binaries)
    const skipReason = cliMissing
      ? CLI_MISSING_REASON
      : missing.length > 0
        ? `missing toolchain: ${missing.join(', ')}`
        : null

    describe(cell.name, () => {
      let dir: string

      beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'arbiter-greenfield-'))
        initGit(dir)
        if (cell.language === 'typescript') scaffoldBareTsSkeleton(dir)
        if (cell.language === 'rust') scaffoldBareCargoSkeleton(dir)
        commitAll(dir, 'chore: bare skeleton')
      })

      afterEach(() => {
        if (dir != null) rmSync(dir, { recursive: true, force: true })
      })

      it.skipIf(skipReason != null)(
        `init 0 → check-all L1 0 on first run, no pre-existing prettier config${skipReason ? ` (${skipReason})` : ''}`,
        () => {
          const init = runCli(dir, [
            'init',
            '--yes',
            '--tools',
            cell.tools,
            '--language',
            cell.language,
            '--archetype',
            cell.archetype,
            '--level',
            'L1',
            '--no-verify',
          ])
          expect(init.status, `init failed:\n${init.output.slice(-3000)}`).toBe(0)
          commitAll(dir, 'chore: post-init')

          if (cell.language === 'typescript') {
            const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
              cwd: dir,
              encoding: 'utf-8',
              timeout: 240_000,
            })
            expect(install.status, `npm install failed:\n${install.stderr}`).toBe(0)
          }

          const gate = runGate(dir, 'L1')
          expect(gate.status, `gate did not execute:\n${gate.output.slice(-2000)}`).not.toBe(127)
          expect(
            gate.status,
            gate.status === 0
              ? ''
              : `generated L1 gate failed on first run:\n${gate.output.slice(-4000)}`,
          ).toBe(0)
        },
        300_000,
      )
    })
  }

  // Terraform-acceptance pairing (FP-5): the cells above prove GREEN on a clean
  // scaffold. This proves the SAME generated gate actually BLOCKS a seeded
  // violation — without this half, a gate that always exits 0 would satisfy the
  // cells above too, and the whole harness would be a green-only fake guarantee.
  describe('seeded-violation RED path', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'arbiter-greenfield-red-'))
      initGit(dir)
      scaffoldBareTsSkeleton(dir)
      commitAll(dir, 'chore: bare skeleton')
    })

    afterEach(() => {
      if (dir != null) rmSync(dir, { recursive: true, force: true })
    })

    const skip = cliMissing || missingBinaries(['node', 'npx']).length > 0

    it.skipIf(skip)(
      `a seeded format violation REDs the generated L1 gate${skip ? ` (${CLI_MISSING_REASON})` : ''}`,
      () => {
        const init = runCli(dir, [
          'init',
          '--yes',
          '--tools',
          'codex',
          '--language',
          'typescript',
          '--archetype',
          'library',
          '--level',
          'L1',
          '--no-verify',
        ])
        expect(init.status, `init failed:\n${init.output.slice(-3000)}`).toBe(0)

        // Seed a genuine violation: double-quoted + semicolon-terminated source,
        // both banned by the generated .prettierrc (singleQuote:true, semi:false).
        writeFileSync(join(dir, 'src', 'violation.ts'), 'export const bad = "not-formatted";\n')
        commitAll(dir, 'chore: post-init + seeded violation')

        const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
          cwd: dir,
          encoding: 'utf-8',
          timeout: 240_000,
        })
        expect(install.status, `npm install failed:\n${install.stderr}`).toBe(0)

        const gate = runGate(dir, 'L1')
        expect(
          gate.status,
          'a seeded format violation must RED the gate, not pass silently',
        ).not.toBe(0)
        expect(gate.output).toMatch(/format/i)
      },
      300_000,
    )
  })

  // Tier-blindness fix (release-readiness verdict, Blocker 2): every cell above
  // pins `--level L1` and gates with `runGate(dir, 'L1')`, so a project that goes
  // through `arbiter init` the way the verdict actually reproduced it —
  // `arbiter init -y` with NO --level flag, which resolves to the CLI's own
  // default, L2 (see `arbiter init --help`) — was never exercised end-to-end by
  // this harness. That gap is exactly how the B4 knip/prettier regression (a
  // virgin `arbiter init -y` → `check-all.mjs gate` exiting 1) shipped unnoticed:
  // the "green" first-run E2E only ever asserted L1. This block closes the gap by
  // driving `arbiter init` with no --level override and gating with the real
  // `gate` subcommand (`check-all.mjs gate`, the exact command cited in the
  // verdict) — which the generated script's own _SUBCOMMAND_LEVEL table maps to
  // L2, matching what a first-time user actually runs pre-push.
  describe('default level (L2) first-run — tier-blindness fix', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'arbiter-greenfield-l2default-'))
      initGit(dir)
      scaffoldBareTsSkeleton(dir)
      commitAll(dir, 'chore: bare skeleton')
    })

    afterEach(() => {
      if (dir != null) rmSync(dir, { recursive: true, force: true })
    })

    const skip = cliMissing || missingBinaries(['node', 'npx']).length > 0

    it.skipIf(skip)(
      `init -y (no --level ⇒ default L2) → check-all.mjs gate exits 0 on first run${skip ? ` (${CLI_MISSING_REASON})` : ''}`,
      () => {
        const init = runCli(dir, [
          'init',
          '--yes',
          '--tools',
          'codex',
          '--language',
          'typescript',
          '--archetype',
          'library',
          '--no-verify',
        ])
        expect(init.status, `init failed:\n${init.output.slice(-3000)}`).toBe(0)
        commitAll(dir, 'chore: post-init')

        const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
          cwd: dir,
          encoding: 'utf-8',
          timeout: 240_000,
        })
        expect(install.status, `npm install failed:\n${install.stderr}`).toBe(0)

        const gate = runGate(dir, 'gate')
        expect(gate.status, `gate did not execute:\n${gate.output.slice(-2000)}`).not.toBe(127)
        expect(
          gate.status,
          gate.status === 0
            ? ''
            : `generated default-level (L2) gate failed on first run:\n${gate.output.slice(-4000)}`,
        ).toBe(0)
      },
      300_000,
    )

    // Terraform-acceptance pairing for the default-level cell above: proves the
    // same default-level gate is not vacuously green by seeding a genuine
    // unused-devDependency (dead-code) violation — the same finding CLASS as the
    // B4 regression this block exists to catch, and one that only an L2 gate
    // (knip runs at L2, not L1) can detect. A future regression that silently
    // widens knip.json's ignoreDependencies (or otherwise neuters the dead-code
    // check) would turn this red-path green again, so it FAILS the test.
    it.skipIf(skip)(
      `a seeded unused-devDependency REDs the default-level (L2) gate${skip ? ` (${CLI_MISSING_REASON})` : ''}`,
      () => {
        const init = runCli(dir, [
          'init',
          '--yes',
          '--tools',
          'codex',
          '--language',
          'typescript',
          '--archetype',
          'library',
          '--no-verify',
        ])
        expect(init.status, `init failed:\n${init.output.slice(-3000)}`).toBe(0)

        const pkgPath = join(dir, 'package.json')
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
          devDependencies?: Record<string, string>
        }
        pkg.devDependencies = { ...pkg.devDependencies, 'is-odd': '^3.0.1' }
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
        commitAll(dir, 'chore: post-init + seeded unused devDependency')

        const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
          cwd: dir,
          encoding: 'utf-8',
          timeout: 240_000,
        })
        expect(install.status, `npm install failed:\n${install.stderr}`).toBe(0)

        const gate = runGate(dir, 'gate')
        expect(
          gate.status,
          'a seeded unused devDependency must RED the default-level (L2) gate, not pass silently',
        ).not.toBe(0)
        // #2257: assert the knip gate's OWN status line, not just a regex over the
        // combined output — `dead code` is soft:true (it renders as
        // `{ soft: graceActive }`), so a future config that flips grace on would
        // turn this into a WARN while the loose regex still matched. #2244 cites
        // this line as REQ-010's functional-tier evidence; it has to bind.
        expect(gateStatus(gate.output, 'dead code'), gate.output.slice(-3000)).toBe('FAIL')
      },
      300_000,
    )
  })

  // ── #2257 AC-3: one fixture cell per blocked-gate family ────────────────────
  // Every functional fixture that existed before this block inited with
  // architectureStyle='none', permitGitHub=false, coverage off and never above
  // L2/library — so the gates 13 of #2244's RTM rows describe were never
  // EMITTED, let alone executed. Each cell below unlocks exactly ONE family and
  // proves the emitted gate is real the only way that survives CANON-23: the
  // named gate PASSes on a clean tree and FAILs on a seeded violation.
  //
  // Cells that need no npm install do not run one: every guard these assert is a
  // dependency-free node script, and a 60s install per cell would price the
  // family coverage out of the nightly lane it has to live in.

  // useGitHub family (REQ-007) — and the day-2 regression it exposed.
  describe('github workflow gates (#2257 AC-3, useGitHub family)', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'arbiter-greenfield-github-'))
      initGit(dir)
      scaffoldBareTsSkeleton(dir)
      commitAll(dir, 'chore: bare skeleton')
    })

    afterEach(() => {
      if (dir != null) rmSync(dir, { recursive: true, force: true })
    })

    const skip = cliMissing || missingBinaries(['node']).length > 0

    // THE RED (#2257): `arbiter init --github` wires the 12 workflow gates, and
    // the very next routine `arbiter update` silently STRIPPED all of them while
    // leaving .github/workflows and the guard scripts they run on disk — so the
    // generated project's own L1 `unwired guards` gate went red on a consumer who
    // did nothing but run the documented upgrade command. Root cause was the
    // registry conditioning those gates on `useGitHub`, which resolveProjectConfig
    // sets from the LIVE-API-call flag (--github) on the update path, not on the
    // persisted `permitGitHub` capability that decides whether the workflows are
    // emitted at all. Two names, one meaning, opposite values.
    it.skipIf(skip)(
      `init --github wires the workflow gates and a plain \`arbiter update\` keeps them${skip ? ` (${CLI_MISSING_REASON})` : ''}`,
      () => {
        const init = runCli(dir, [
          'init',
          '--yes',
          '--github',
          '--tools',
          'codex',
          '--language',
          'typescript',
          '--archetype',
          'library',
          '--level',
          'L2',
          '--no-verify',
        ])
        expect(init.status, `init failed:\n${init.output.slice(-3000)}`).toBe(0)

        const WORKFLOW_GATES = [
          'ci-tiers',
          'action-pins',
          'workflow-perms',
          'workflow-runners',
          'workflow-sha-pinning',
          'workflow-job-naming',
          'pr-size-gate',
          'merge-method-ff-only',
        ]
        expect(emittedGateIds(dir)).toEqual(expect.arrayContaining(WORKFLOW_GATES))

        // The day-2 command every consumer runs. No --github: it must not be
        // required to KEEP gates that guard files already on disk.
        const update = runCli(dir, ['update'])
        expect(update.status, `update failed:\n${update.output.slice(-3000)}`).toBe(0)
        expect(
          emittedGateIds(dir),
          'a plain `arbiter update` must not strip the workflow gates it still emits workflows for',
        ).toEqual(expect.arrayContaining(WORKFLOW_GATES))

        // The observable consequence: the project's own guard-wiring gate.
        const unwired = runGate(dir, 'L1', 'unwired-guards')
        expect(gateStatus(unwired.output, 'unwired guards'), unwired.output.slice(-2000)).toBe(
          'PASS',
        )

        // The workflow gates themselves run for real against the emitted workflows.
        for (const [id, name] of [
          ['action-pins', 'action pins (INV-75)'],
          ['workflow-sha-pinning', 'workflow sha pinning'],
          ['ci-tiers', 'ci tiers (INV-73)'],
          ['workflow-perms', 'workflow perms (INV-76)'],
        ] as const) {
          const g = runGate(dir, 'L1', id)
          expect(gateStatus(g.output, name), `${id}:\n${g.output.slice(-2000)}`).toBe('PASS')
        }
      },
      300_000,
    )

    // Terraform-acceptance pairing: the emitted workflow gates must BLOCK an
    // unpinned action, not merely be present and green.
    it.skipIf(skip)(
      `a seeded tag-pinned action REDs the emitted action-pins gate${skip ? ` (${CLI_MISSING_REASON})` : ''}`,
      () => {
        const init = runCli(dir, [
          'init',
          '--yes',
          '--github',
          '--tools',
          'codex',
          '--language',
          'typescript',
          '--archetype',
          'library',
          '--level',
          'L2',
          '--no-verify',
        ])
        expect(init.status, `init failed:\n${init.output.slice(-3000)}`).toBe(0)

        writeFileSync(
          join(dir, '.github', 'workflows', '99-seeded.yml'),
          'name: seeded\non: [push]\npermissions:\n  contents: read\njobs:\n  seeded-job:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n',
        )

        for (const [id, name] of [
          ['action-pins', 'action pins (INV-75)'],
          ['workflow-sha-pinning', 'workflow sha pinning'],
        ] as const) {
          const g = runGate(dir, 'L1', id)
          expect(
            gateStatus(g.output, name),
            `${id} must RED on a tag-pinned action, not pass silently:\n${g.output.slice(-2000)}`,
          ).toBe('FAIL')
        }
      },
      300_000,
    )
  })

  // architectureStyle family (REQ-001 TS half, REQ-016 TS half). `arbiter init`
  // has no --architecture-style flag, so the consumer path is init → configure
  // → update; that round-trip is part of what this cell proves.
  describe('hexagonal boundaries (#2257 AC-3, architectureStyle family)', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'arbiter-greenfield-hex-'))
      initGit(dir)
      scaffoldBareTsSkeleton(dir)
      commitAll(dir, 'chore: bare skeleton')
    })

    afterEach(() => {
      if (dir != null) rmSync(dir, { recursive: true, force: true })
    })

    const skip = cliMissing || missingBinaries(['node', 'npx']).length > 0

    it.skipIf(skip)(
      `architectureStyle=hexagonal emits a boundaries gate that PASSes clean and REDs a cross-layer import${skip ? ` (${CLI_MISSING_REASON})` : ''}`,
      () => {
        const init = runCli(dir, [
          'init',
          '--yes',
          '--tools',
          'codex',
          '--language',
          'typescript',
          '--archetype',
          'library',
          '--level',
          'L2',
          '--no-verify',
        ])
        expect(init.status, `init failed:\n${init.output.slice(-3000)}`).toBe(0)

        const cfg = runCli(dir, ['configure', '--set', 'architectureStyle=hexagonal'])
        expect(cfg.status, `configure failed:\n${cfg.output.slice(-2000)}`).toBe(0)
        const upd = runCli(dir, ['update'])
        expect(upd.status, `update failed:\n${upd.output.slice(-3000)}`).toBe(0)

        expect(emittedGateIds(dir)).toContain('ts-boundaries')
        expect(existsSync(join(dir, 'scripts', 'check-boundaries.mjs'))).toBe(true)

        const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
          cwd: dir,
          encoding: 'utf-8',
          timeout: 240_000,
        })
        expect(install.status, `npm install failed:\n${install.stderr}`).toBe(0)

        const clean = runGate(dir, 'L2', 'ts-boundaries')
        expect(gateStatus(clean.output, 'boundaries'), clean.output.slice(-3000)).toBe('PASS')

        // Seed a genuine hexagonal violation: domain importing an adapter. The
        // emitted eslint.config.boundaries.mjs declares `from: 'domain', allow: []`.
        mkdirSync(join(dir, 'src', 'domain'), { recursive: true })
        mkdirSync(join(dir, 'src', 'adapters'), { recursive: true })
        writeFileSync(join(dir, 'src', 'adapters', 'rest.ts'), "export const rest = 'adapter'\n")
        writeFileSync(
          join(dir, 'src', 'domain', 'entity.ts'),
          "import { rest } from '../adapters/rest'\nexport const entity = rest\n",
        )

        const seeded = runGate(dir, 'L2', 'ts-boundaries')
        expect(
          gateStatus(seeded.output, 'boundaries'),
          `a domain→adapters import must RED the boundaries gate:\n${seeded.output.slice(-3000)}`,
        ).toBe('FAIL')
      },
      420_000,
    )
  })

  // coverage family (REQ-005 coverage half) + the INV-40 BDD @ignore hard-fail
  // (REQ-036, and the behavioral quarter of REQ-006). Both gates live in the same
  // default-L2 project, so they share one `npm install`.
  describe('coverage threshold + BDD @ignore (#2257 AC-3, coverage family)', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'arbiter-greenfield-coverage-'))
      initGit(dir)
      scaffoldBareTsSkeleton(dir)
      commitAll(dir, 'chore: bare skeleton')
    })

    afterEach(() => {
      if (dir != null) rmSync(dir, { recursive: true, force: true })
    })

    const skip = cliMissing || missingBinaries(['node', 'npx']).length > 0

    it.skipIf(skip)(
      `the emitted coverage + BDD @ignore gates PASS clean and RED on seeded violations${skip ? ` (${CLI_MISSING_REASON})` : ''}`,
      () => {
        const init = runCli(dir, [
          'init',
          '--yes',
          '--tools',
          'codex',
          '--language',
          'typescript',
          '--archetype',
          'library',
          '--level',
          'L2',
          '--no-verify',
        ])
        expect(init.status, `init failed:\n${init.output.slice(-3000)}`).toBe(0)

        // Emission proof for both. (The RTM's standing note that coverage needs
        // LOC>=1000 describes the *scaled* profile only; the default profile is
        // `fixed`, under which computeThresholds enables coverage unconditionally.)
        expect(emittedGateIds(dir)).toEqual(
          expect.arrayContaining(['coverage-threshold', 'bdd-ignore-check']),
        )

        const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
          cwd: dir,
          encoding: 'utf-8',
          timeout: 240_000,
        })
        expect(install.status, `npm install failed:\n${install.stderr}`).toBe(0)

        const covClean = runGate(dir, 'L2', 'coverage-threshold')
        expect(
          gateStatus(covClean.output, 'coverage threshold'),
          covClean.output.slice(-3000),
        ).toBe('PASS')

        // Seed real executable, untested statements: the greenfield guard no longer
        // applies and the emitted threshold (80% at L2) must bite.
        writeFileSync(
          join(dir, 'src', 'uncovered.ts'),
          'export function branchy(n: number): string {\n' +
            "  if (n > 10) return 'big'\n" +
            "  if (n > 5) return 'medium'\n" +
            "  if (n > 0) return 'small'\n" +
            "  return 'zero'\n" +
            '}\n',
        )
        const covSeeded = runGate(dir, 'L2', 'coverage-threshold')
        expect(
          gateStatus(covSeeded.output, 'coverage threshold'),
          `untested executable code must RED the coverage gate:\n${covSeeded.output.slice(-3000)}`,
        ).toBe('FAIL')

        const bddClean = runGate(dir, 'L2', 'bdd-ignore-check')
        expect(gateStatus(bddClean.output, 'BDD @ignore check'), bddClean.output.slice(-2000)).toBe(
          'PASS',
        )

        // INV-40: @ignore-tagged scenarios are a HARD fail, never graced.
        mkdirSync(join(dir, 'features'), { recursive: true })
        writeFileSync(
          join(dir, 'features', 'seeded.feature'),
          '@ignore\nFeature: seeded\n  Scenario: s\n    Given x\n',
        )
        const bddSeeded = runGate(dir, 'L2', 'bdd-ignore-check')
        expect(
          gateStatus(bddSeeded.output, 'BDD @ignore check'),
          `an @ignore-tagged scenario must RED the gate (INV-40):\n${bddSeeded.output.slice(-2000)}`,
        ).toBe('FAIL')
      },
      420_000,
    )
  })

  // L3 family (REQ-038). No functional cell reached above L2 before this one, so
  // the whole L3 lane — and the evidence gate that is its reason to exist — had
  // never been executed against a generated project.
  describe('L3 evidence gate (#2257 AC-3, L3 family)', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'arbiter-greenfield-l3-'))
      initGit(dir)
      scaffoldBareTsSkeleton(dir)
      commitAll(dir, 'chore: bare skeleton')
    })

    afterEach(() => {
      if (dir != null) rmSync(dir, { recursive: true, force: true })
    })

    const skip = cliMissing || missingBinaries(['node']).length > 0

    it.skipIf(skip)(
      `an L3 project emits the evidence gate (INV-33) and it REDs a failing obs_gate${skip ? ` (${CLI_MISSING_REASON})` : ''}`,
      () => {
        const init = runCli(dir, [
          'init',
          '--yes',
          '--tools',
          'codex',
          '--language',
          'typescript',
          '--archetype',
          'library',
          '--level',
          'L3',
          '--no-verify',
        ])
        expect(init.status, `init failed:\n${init.output.slice(-3000)}`).toBe(0)
        // mutation-stryker rides along: it needs mutationEnabled (true under the
        // default `fixed` profile) AND enableMutationTesting, which is L3+ — so
        // L3 is the first tier that emits it at all. Emission only: `npx stryker
        // run` needs a network install, so #2244's REQ-006 does not cite it as
        // executed.
        expect(emittedGateIds(dir)).toEqual(
          expect.arrayContaining(['evidence-gate', 'mutation-stryker']),
        )

        mkdirSync(join(dir, '.evidence'), { recursive: true })
        writeFileSync(
          join(dir, '.evidence', 'SUMMARY.json'),
          JSON.stringify({ obs_gate: 'PASS' }) + '\n',
        )
        const clean = runGate(dir, 'L3', 'evidence-gate')
        expect(gateStatus(clean.output, 'evidence gate (INV-33)'), clean.output.slice(-2000)).toBe(
          'PASS',
        )

        writeFileSync(
          join(dir, '.evidence', 'SUMMARY.json'),
          JSON.stringify({ obs_gate: 'FAIL' }) + '\n',
        )
        const seeded = runGate(dir, 'L3', 'evidence-gate')
        expect(
          gateStatus(seeded.output, 'evidence gate (INV-33)'),
          `obs_gate=FAIL must RED the evidence gate (INV-33):\n${seeded.output.slice(-2000)}`,
        ).toBe('FAIL')
      },
      300_000,
    )
  })

  // frontend-spa-at-L2 family (REQ-032). The tier's only FE cell inits at L1, and
  // every INV-102..106 gate needs L2 AND a frontend archetype — so none of them
  // had ever been emitted at this tier, let alone executed.
  describe('frontend governance INV-102..106 (#2257 AC-3, FE-at-L2 family)', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'arbiter-greenfield-fe-l2-'))
      initGit(dir)
      scaffoldBareTsSkeleton(dir)
      commitAll(dir, 'chore: bare skeleton')
    })

    afterEach(() => {
      if (dir != null) rmSync(dir, { recursive: true, force: true })
    })

    const skip = cliMissing || missingBinaries(['node']).length > 0

    it.skipIf(skip)(
      `a frontend-spa L2 project emits INV-102..106 gates that PASS clean and RED seeded violations${skip ? ` (${CLI_MISSING_REASON})` : ''}`,
      () => {
        const init = runCli(dir, [
          'init',
          '--yes',
          '--tools',
          'codex',
          '--language',
          'typescript',
          '--archetype',
          'frontend-spa',
          '--level',
          'L2',
          '--no-verify',
        ])
        expect(init.status, `init failed:\n${init.output.slice(-3000)}`).toBe(0)
        expect(emittedGateIds(dir)).toEqual(
          expect.arrayContaining([
            'fe-boundaries',
            'token-discipline',
            'i18n-literals',
            'i18n-parity',
            'bundle-size-budget',
          ]),
        )

        const FE_GATES = [
          ['fe-boundaries', 'fe boundaries (INV-102/103/104)'],
          ['token-discipline', 'token discipline (INV-105)'],
          ['i18n-literals', 'i18n literals (INV-106)'],
        ] as const
        for (const [id, name] of FE_GATES) {
          const g = runGate(dir, 'L2', id)
          expect(gateStatus(g.output, name), `${id} clean:\n${g.output.slice(-2000)}`).toBe('PASS')
        }

        // INV-105: a raw hex colour in a component. INV-103: a browser global in
        // the domain layer. Both are the exact violations the emitted guards name.
        mkdirSync(join(dir, 'src', 'components'), { recursive: true })
        mkdirSync(join(dir, 'src', 'domain'), { recursive: true })
        writeFileSync(
          join(dir, 'src', 'components', 'Button.tsx'),
          "export const style = { color: '#ff0000' }\n",
        )
        writeFileSync(
          join(dir, 'src', 'domain', 'viewport.ts'),
          'export const wide = window.innerWidth\n',
        )

        for (const [id, name] of [
          ['token-discipline', 'token discipline (INV-105)'],
          ['fe-boundaries', 'fe boundaries (INV-102/103/104)'],
        ] as const) {
          const g = runGate(dir, 'L2', id)
          expect(
            gateStatus(g.output, name),
            `${id} must RED on its own seeded violation:\n${g.output.slice(-2000)}`,
          ).toBe('FAIL')
        }
      },
      300_000,
    )
  })
})
