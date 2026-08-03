// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Lane } from '../wizard/types.js'

/**
 * Frontend package dependencies and their framework-detection slugs.
 *
 * `hasFrontendLane` deliberately inspects only `frontend/package.json`; root
 * dependency detection belongs to `framework.ts`. Keep that separate scope while
 * sharing this dependency catalog between both consumers.
 */
export const FE_FRAMEWORKS: ReadonlyMap<string, string> = new Map([
  ['react', 'react'],
  ['vue', 'vue'],
  ['next', 'next'],
  ['astro', 'astro'],
  ['nuxt', 'nuxt'],
  ['@angular/core', 'angular'],
  ['svelte', 'svelte'],
  ['solid-js', 'solid'],
  ['preact', 'preact'],
  ['vite', 'vite'],
])

const BE_MANIFEST_FILES = [
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
]

const BE_NODE_FRAMEWORKS = new Set(['express', 'fastify', 'hono', 'koa', '@nestjs/core'])

export interface LanesResult {
  lanes: Lane[]
}

function hasFrontendLane(dir: string): boolean {
  const pkgPath = join(dir, 'frontend', 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }
    return Object.keys(allDeps).some((k) => FE_FRAMEWORKS.has(k))
  } catch (err) {
    process.stderr.write(
      `[arbiter] Warning: could not read ${pkgPath} for lane detection — ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return false
  }
}

function hasBackendLane(dir: string): boolean {
  // #1318.1: the root module is the canonical backend lane. A root-level compiled-
  // language manifest (go.mod, Cargo.toml, pom.xml, …) IS the backend — `backend/`
  // is the optional monorepo split variant. (Root `package.json` is deliberately
  // excluded here: it's ambiguous FE-tooling and handled by the frontend lane.)
  if (BE_MANIFEST_FILES.some((f) => existsSync(join(dir, f)))) return true
  const beDir = join(dir, 'backend')
  if (!existsSync(beDir)) return false
  if (BE_MANIFEST_FILES.some((f) => existsSync(join(beDir, f)))) return true
  const pkgPath = join(beDir, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }
    return Object.keys(allDeps).some((k) => BE_NODE_FRAMEWORKS.has(k))
  } catch (err) {
    process.stderr.write(
      `[arbiter] Warning: could not read ${pkgPath} for lane detection — ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return false
  }
}

function hasDocsLane(dir: string): boolean {
  const docsDir = join(dir, 'docs')
  if (!existsSync(docsDir)) return false
  const hasMd = (d: string, depth = 0): boolean => {
    if (depth > 1) return false
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) return true
        if (entry.isDirectory() && hasMd(join(d, entry.name), depth + 1)) return true
      }
    } catch (err) {
      process.stderr.write(
        `[arbiter] Warning: could not read directory during docs-lane detection — ${err instanceof Error ? err.message : String(err)}\n`,
      )
      return false
    }
    return false
  }
  return hasMd(docsDir)
}

export function detectLanes(dir: string): LanesResult {
  const lanes: Lane[] = []
  if (hasFrontendLane(dir)) lanes.push('frontend')
  if (hasBackendLane(dir)) lanes.push('backend')
  if (hasDocsLane(dir)) lanes.push('docs')
  return { lanes }
}

/**
 * #1330 — true when the project declares a `frontend` SUBTREE lane: a `frontend`
 * lane on a *defined, non-`frontend-spa`* archetype. This is the polyglot case
 * where the FE app lives in a `frontend/` subtree beside a primary backend language
 * (Go/Python/Java/Rust/…) and therefore needs its own per-lane gate + CI workflow.
 *
 * The `frontend-spa` archetype is excluded because there the FE app IS the project
 * (root-level wiring already exists). An `undefined` archetype is excluded to mirror
 * the `needsFrontendQuality` (github.ts) convention — a project not yet classified
 * by the wizard does not emit the subtree gate. Used by the check-all and github
 * generators so the emit/wire/workflow guards stay in lockstep (single source).
 */
export function isSubtreeFrontendLane(config: {
  archetype?: string
  lanes: readonly string[]
}): boolean {
  return (
    config.archetype !== undefined &&
    config.archetype !== 'frontend-spa' &&
    config.lanes.includes('frontend')
  )
}
