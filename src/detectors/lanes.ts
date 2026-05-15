// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Lane } from '../wizard/types.js'

const FE_FRAMEWORKS = new Set([
  'react',
  'vue',
  'svelte',
  '@angular/core',
  'solid-js',
  'preact',
  'next',
  'nuxt',
  'astro',
  'vite',
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
