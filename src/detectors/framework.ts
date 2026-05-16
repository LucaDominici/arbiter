// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Archetype, Language } from '../wizard/types.js'
import { readFileSafe, readPackageJsonSafe } from '../utils/safe-read.js'

export function detectFramework(dir: string, language: Language): string | null {
  if (language === 'multi') return detectMultiFramework(dir)
  if (language === 'typescript') return detectTypescriptFramework(dir)
  if (language === 'rust') return detectRustFramework(dir)
  if (language === 'java') return detectJavaFramework(dir)
  return null
}

/**
 * Detect frameworks on both the TS and Java sides of a multi-language monorepo
 * and combine them. Returns the TS framework alone if no Java build file is
 * present, the Java framework alone if no TS framework is detected, or a
 * `tsFramework+javaFramework` composite when both sides have a meaningful match.
 */
function detectMultiFramework(dir: string): string | null {
  const ts = detectTypescriptFramework(dir)
  const javaBuildPresent =
    existsSync(join(dir, 'build.gradle')) ||
    existsSync(join(dir, 'build.gradle.kts')) ||
    existsSync(join(dir, 'pom.xml'))
  const java = javaBuildPresent ? detectJavaFramework(dir) : null
  if (ts && java) return `${ts}+${java}`
  return ts ?? java
}

function detectTypescriptFramework(dir: string): string | null {
  const pkg = readPackageJson(dir)
  const deps = getAllDeps(pkg)
  const hasTauri = existsSync(join(dir, 'src-tauri'))
  const hasVue = deps.has('vue')
  const hasReact = deps.has('react')
  const hasExpress = deps.has('express')
  const hasNext = deps.has('next')
  const hasFastify = deps.has('fastify')

  if (hasTauri && hasReact) return 'tauri+react'
  if (hasTauri && hasVue) return 'tauri+vue'
  if (hasTauri) return 'tauri'
  if (hasNext) return 'next'
  if (hasExpress && hasReact) return 'express+react'
  if (hasExpress && hasVue) return 'express+vue'
  if (hasExpress) return 'express'
  if (hasFastify) return 'fastify'
  if (hasVue) return 'vue'
  if (hasReact) return 'react'
  return null
}

function detectRustFramework(dir: string): string | null {
  if (existsSync(join(dir, 'src-tauri'))) return 'tauri'
  return null
}

function detectJavaFramework(dir: string): string | null {
  // Read every common Java build manifest. Kotlin-DSL (`build.gradle.kts`) was previously
  // a blind spot — projects using only `build.gradle.kts` fell through to the legacy
  // `"java"` sentinel and were mis-archetyped (#278 finding #1). Returning `null` aligns
  // the contract with sibling detectors (TypeScript, Rust) and lets `detectArchetypeHint`
  // apply `LANGUAGE_FALLBACK_ARCHETYPE` cleanly (#278 finding #2).
  const buildFile =
    readFileSafe(join(dir, 'build.gradle')) +
    readFileSafe(join(dir, 'build.gradle.kts')) +
    readFileSafe(join(dir, 'pom.xml'))
  // Match both the Gradle plugin slug `spring-boot` and the Maven/Kotlin-DSL form
  // `org.springframework.boot` so Kotlin-DSL Spring Boot projects are recognised.
  if (buildFile.includes('spring-boot') || buildFile.includes('org.springframework.boot'))
    return 'spring-boot'
  if (buildFile.includes('quarkus') || buildFile.includes('io.quarkus')) return 'quarkus'
  return null
}

const readPackageJson = readPackageJsonSafe

function getAllDeps(pkg: Record<string, unknown>): Set<string> {
  const deps = new Set<string>()
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const d = pkg[key]
    if (typeof d === 'object' && d !== null) {
      for (const name of Object.keys(d)) deps.add(name)
    }
  }
  return deps
}

// Maps a framework slug to an archetype for languages where heuristics are reliable.
// Keyed by `${language}:${framework}`. Languages without a reliable mapping (go, python,
// unknown) are not present — callers default to "library". See ADR-021.
const FRAMEWORK_ARCHETYPE_MAP: ReadonlyMap<string, Archetype> = new Map([
  ['java:spring-boot', 'backend-web-db'],
  ['java:quarkus', 'backend-web-db'],
  ['typescript:next', 'backend-web-db'],
  ['typescript:express', 'backend-web-db'],
  ['typescript:express+react', 'backend-web-db'],
  ['typescript:express+vue', 'backend-web-db'],
  ['typescript:fastify', 'backend-web-db'],
  ['typescript:tauri+react', 'frontend-spa'],
  ['typescript:tauri+vue', 'frontend-spa'],
  ['typescript:tauri', 'frontend-spa'],
  ['typescript:react', 'frontend-spa'],
  ['typescript:vue', 'frontend-spa'],
  ['rust:tauri', 'frontend-spa'],
])

// Languages where "no matching framework" still yields a reliable archetype.
const LANGUAGE_FALLBACK_ARCHETYPE: ReadonlyMap<Language, Archetype> = new Map([
  ['java', 'library'],
  ['typescript', 'library'],
  ['rust', 'library'],
  ['multi', 'backend-web-db'],
])

/**
 * Infer a project archetype from the detected language and framework.
 * Returns null when the heuristic is unreliable — callers should default to "library".
 *
 * The archetype is separate from language: a TypeScript CLI and a Python CLI share
 * archetype invariants. See ADR-021.
 */
export function detectArchetypeHint(
  _dir: string,
  language: Language,
  framework: string | null,
): Archetype | null {
  if (framework !== null) {
    if (language === 'multi' && framework.includes('+')) {
      return detectMultiCompositeArchetype(framework)
    }
    const key = `${language}:${framework}`
    const mapped = FRAMEWORK_ARCHETYPE_MAP.get(key)
    if (mapped !== undefined) return mapped
  }
  return LANGUAGE_FALLBACK_ARCHETYPE.get(language) ?? null
}

function detectMultiCompositeArchetype(framework: string): Archetype | null {
  const parts = framework.split('+')
  const last = parts[parts.length - 1]
  if (last === undefined) return null
  const tsFramework = parts.slice(0, -1).join('+')
  const tsArchetype = FRAMEWORK_ARCHETYPE_MAP.get(`typescript:${tsFramework}`) ?? null
  const javaArchetype = FRAMEWORK_ARCHETYPE_MAP.get(`java:${last}`) ?? null
  if (tsArchetype !== null && tsArchetype === javaArchetype) return tsArchetype
  if (tsArchetype === 'backend-web-db' || javaArchetype === 'backend-web-db')
    return 'backend-web-db'
  return tsArchetype ?? javaArchetype
}
