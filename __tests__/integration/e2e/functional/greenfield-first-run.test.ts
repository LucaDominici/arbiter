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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { missingBinaries } from '../helpers.js'

const L2 = process.env.VITEST_L2 === '1'
const REPO_ROOT = process.cwd()
const CLI = join(REPO_ROOT, 'dist', 'cli.js')
const CLI_MISSING_REASON = 'dist/cli.js not built (run `npm run build` first)'

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

function runGate(dir: string, level: 'L1' | 'L2'): { status: number; output: string } {
  const scriptPath = join(dir, 'scripts', 'check-all.mjs')
  if (!existsSync(scriptPath)) {
    return { status: 127, output: `check-all.mjs not generated at ${scriptPath}` }
  }
  const r = spawnSync('node', [scriptPath, level], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, CI: 'true' },
  })
  return { status: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') }
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
})
