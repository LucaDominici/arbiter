// SPDX-License-Identifier: Apache-2.0
// Wave C (#1041): shared helpers for the fixture bake-and-run E2E harness.
// Pattern reference: Nx (create-nx-workspace), Cookiecutter (pytest-cookies),
// Spring Initializr (initializr-generator-test).
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

export interface FixtureManifest {
  language: string
  archetype: string
  buildTool?: string | null
  levels: string[]
  tier: 'snapshot' | 'bake' | 'functional'
  note?: string
}

const FIXTURES_ROOT = resolve('__tests__/fixtures/real-projects')

export function loadFixtureManifest(name: string): FixtureManifest {
  const path = join(FIXTURES_ROOT, name, 'manifest.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as FixtureManifest
}

export function listFixtures(...tiers: Array<FixtureManifest['tier']>): string[] {
  const accept = new Set(tiers)
  const names = readdirSync(FIXTURES_ROOT).filter((entry) => {
    try {
      return statSync(join(FIXTURES_ROOT, entry)).isDirectory()
    } catch (err) {
      // FAIL-OPEN-INTENT: ENOENT/ENOTDIR are race-safe skips; all other errors re-throw
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return false
      throw err
    }
  })
  return names.filter((name) => {
    try {
      return accept.has(loadFixtureManifest(name).tier)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw new Error(
        `fixture '${name}' has invalid manifest.json: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  })
}

export function stageFixture(name: string): string {
  const src = join(FIXTURES_ROOT, name)
  const dir = mkdtempSync(join(tmpdir(), `arbiter-e2e-${name}-`))
  cpSync(src, dir, { recursive: true })
  initGit(dir)
  return dir
}

export function initGit(dir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'e2e@arbiter.test'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Arbiter E2E'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'chore: fixture init', '--no-verify'], {
    cwd: dir,
    stdio: 'ignore',
  })
}

// Walk dir, return sorted relative paths, excluding noise that arbiter init
// does not own (git metadata, dependency installs, runtime artefacts).
const EXCLUDE_PREFIXES = ['.git/', 'node_modules/', '.gradle/', 'target/', 'build/']
const EXCLUDE_FILES = new Set(['.DS_Store'])
// #1685: ENV-DERIVED outputs whose presence depends on the HOST, not on the
// generator. `.arbiter/detected-integrations.json` is emitted only when arbiter
// init detects host integrations/skills — present on a dev machine, absent in CI's
// clean env. Keyed by repo-relative POSIX path so the bake name-list snapshot is
// reproducible across environments. (Detection in init.ts is intentionally left as-is.)
const EXCLUDE_RELS = new Set(['.arbiter/detected-integrations.json'])

export function listProjectFiles(dir: string): string[] {
  const out: string[] = []
  const stack: string[] = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current == null) continue
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      const rel = relative(dir, full)
      if (EXCLUDE_FILES.has(entry) || EXCLUDE_RELS.has(rel)) continue
      if (EXCLUDE_PREFIXES.some((p) => rel === p.slice(0, -1) || rel.startsWith(p))) continue
      const st = statSync(full)
      if (st.isDirectory()) {
        stack.push(full)
      } else if (st.isFile() || st.isSymbolicLink()) {
        out.push(rel)
      }
    }
  }
  return out.sort()
}

// Delta between pre-init and post-init file sets — exactly what arbiter init created.
export function computeFileDelta(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before)
  return after.filter((p) => !beforeSet.has(p))
}

// ─── Per-binary toolchain guard (#1321) ──────────────────────────────────────
// The functional harness has a whole-cell `toolchainPresent` keyed by language.
// The virgin-init harness needs finer granularity: a single cell exercises the
// generated L1/L2 gate which shells out to specific binaries (gofmt, golangci-lint,
// gitleaks, go, …). When ANY required binary is absent locally we SKIP the cell
// WITH A REASON so an absent toolchain is never a false RED. (In CI the binaries
// are present, so the cell runs for real.)

export function hasBinary(bin: string): boolean {
  const r = spawnSync('which', [bin], { encoding: 'utf-8' })
  return r.status === 0 && r.stdout.trim().length > 0
}

/**
 * Return the subset of `bins` that are NOT on PATH. Empty array ⇒ all present.
 * Callers SKIP the cell with `missingBinaries(...).join(', ')` as the reason.
 */
export function missingBinaries(bins: readonly string[]): string[] {
  return bins.filter((b) => !hasBinary(b))
}

/**
 * Classify a dependency-install failure as a GENUINE network/offline failure (true) vs
 * a DETERMINISTIC, reproducible failure (false: PEP-668 externally-managed-environment,
 * a broken build backend, a malformed manifest, a resolver conflict).
 *
 * Load-bearing fake-green guard for the functional harness (B5 / #1491 / #1042): only a
 * genuine network failure may SKIP a cell. A deterministic failure must surface as a
 * hard RED — never be laundered into a skip/green. (A bare `pip install -e .` fails with
 * `externally-managed-environment` on every Debian/Ubuntu host incl. the CI runner; the
 * old harness silently passed that cell, so the generated python gate never ran.)
 */
export function isOfflineFailure(out: string): boolean {
  return /(ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|getaddrinfo|Temporary failure in name resolution|Could not resolve host|[Nn]etwork is unreachable|Failed to establish a new connection|Connection timed out|Max retries exceeded)/.test(
    out,
  )
}
