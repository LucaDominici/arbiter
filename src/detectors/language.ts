// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Language } from '../wizard/types.js'

function hasKotlinSources(dir: string): boolean {
  const kotlinRoot = join(dir, 'src/main/kotlin')
  if (!existsSync(kotlinRoot)) return false
  try {
    const stack: string[] = [kotlinRoot]
    let budget = 200
    while (stack.length > 0 && budget-- > 0) {
      const cur = stack.pop()
      if (cur === undefined) break
      const entries = readdirSync(cur, { withFileTypes: true })
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.kt')) return true
        if (e.isDirectory()) stack.push(join(cur, e.name))
      }
    }
    return false
  } catch {
    return false
  }
}

function findJvmBuildFile(dir: string): string | null {
  if (existsSync(join(dir, 'pom.xml'))) return 'pom.xml'
  if (existsSync(join(dir, 'build.gradle'))) return 'build.gradle'
  if (existsSync(join(dir, 'build.gradle.kts'))) return 'build.gradle.kts'
  return null
}

export function detectLanguageWithSource(dir: string): {
  language: Language
  source: string | null
} {
  const hasTs = existsSync(join(dir, 'package.json'))
  const jvmAtRoot = findJvmBuildFile(dir)
  const jvmInBackend = findJvmBuildFile(join(dir, 'backend'))

  const jvmMultiFile = jvmAtRoot ?? jvmInBackend
  if (hasTs && jvmMultiFile !== null) {
    return { language: 'multi', source: `package.json + ${jvmMultiFile}` }
  }
  if (hasTs) return { language: 'typescript', source: 'package.json' }
  if (existsSync(join(dir, 'Cargo.toml'))) return { language: 'rust', source: 'Cargo.toml' }
  if (jvmAtRoot !== null) {
    if (hasKotlinSources(dir)) return { language: 'kotlin', source: jvmAtRoot }
    return { language: 'java', source: jvmAtRoot }
  }
  if (existsSync(join(dir, 'go.mod'))) return { language: 'go', source: 'go.mod' }
  if (existsSync(join(dir, 'pyproject.toml')))
    return { language: 'python', source: 'pyproject.toml' }
  if (existsSync(join(dir, 'setup.py'))) return { language: 'python', source: 'setup.py' }
  if (existsSync(join(dir, 'requirements.txt')))
    return { language: 'python', source: 'requirements.txt' }
  return { language: 'unknown', source: null }
}

export function detectLanguage(dir: string): Language {
  return detectLanguageWithSource(dir).language
}

/**
 * #1343: is the filesystem build-file signal for `lang` still present in `dir`?
 *
 * Used to decide whether a *stored* `arbiter.json` language is still corroborated by
 * the project on disk. The per-language signals mirror the SAME predicates
 * `detectLanguageWithSource` uses (single SSOT): `typescript`→package.json,
 * `rust`→Cargo.toml, `java`→a JVM build file (root or `backend/`), `kotlin`→a JVM
 * build file plus `.kt` sources, `go`→go.mod, `python`→pyproject.toml|setup.py|
 * requirements.txt, `multi`→package.json AND a JVM build file. `unknown` has no
 * signal and is never corroborated.
 */
export function languageSignalPresent(dir: string, lang: Language): boolean {
  const hasTs = existsSync(join(dir, 'package.json'))
  const jvmFile = findJvmBuildFile(dir) ?? findJvmBuildFile(join(dir, 'backend'))
  switch (lang) {
    case 'typescript':
      return hasTs
    case 'rust':
      return existsSync(join(dir, 'Cargo.toml'))
    case 'java':
      return jvmFile !== null
    case 'kotlin':
      return jvmFile !== null && hasKotlinSources(dir)
    case 'go':
      return existsSync(join(dir, 'go.mod'))
    case 'python':
      return (
        existsSync(join(dir, 'pyproject.toml')) ||
        existsSync(join(dir, 'setup.py')) ||
        existsSync(join(dir, 'requirements.txt'))
      )
    case 'multi':
      return hasTs && jvmFile !== null
    case 'unknown':
      return false
  }
}

/**
 * #1343: resolve the authoritative project language. A *stored* `arbiter.json`
 * `language` (persisted by init/wizard) wins over filesystem detection AS LONG AS it
 * is still corroborated on disk (its build-file signal is present). This stops a
 * secondary-lane `package.json` from shadowing a Go-primary project's stored `go`
 * (issue #1343: haben has both `go.mod` and a frontend-lane `package.json`).
 *
 * Corroboration — rather than blind "stored wins" — preserves `update`'s documented
 * language-migration detection (schema.ts): if the stored language's signal is GONE
 * (a genuine on-disk migration, e.g. package.json removed and go.mod added), the
 * stored value is no longer trusted and `detectLanguage` re-detects, so the migration
 * still propagates. Crash-safe: a missing/undefined `stored.language` simply falls
 * through to filesystem detection.
 */
export function resolveLanguage(
  dir: string,
  stored: { language?: Language } | undefined,
): Language {
  const storedLang = stored?.language
  if (
    storedLang !== undefined &&
    storedLang !== 'unknown' &&
    languageSignalPresent(dir, storedLang)
  ) {
    return storedLang
  }
  return detectLanguage(dir)
}
