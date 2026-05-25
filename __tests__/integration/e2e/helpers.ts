// SPDX-License-Identifier: Apache-2.0
// Wave C (#1041): shared helpers for the fixture bake-and-run E2E harness.
// Pattern reference: Nx (create-nx-workspace), Cookiecutter (pytest-cookies),
// Spring Initializr (initializr-generator-test).
import { execFileSync } from 'node:child_process'
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

export function listProjectFiles(dir: string): string[] {
  const out: string[] = []
  const stack: string[] = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current == null) continue
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      const rel = relative(dir, full)
      if (EXCLUDE_FILES.has(entry)) continue
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
