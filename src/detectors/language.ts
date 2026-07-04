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

/**
 * Resolve the directory that holds the JVM build for a (possibly polyglot) project.
 * Mirrors `findJvmBuildFile`'s root-then-`backend/` ordering so framework and build
 * detection agree with `detectLanguageWithSource` on WHERE the JVM build lives
 * (single SSOT). Returns `dir` for a root JVM build, `join(dir,'backend')` for a
 * `backend/` JVM build, or `null` when no JVM build file is present anywhere (#1567).
 */
export function jvmRoot(dir: string): string | null {
  if (findJvmBuildFile(dir) !== null) return dir
  const backend = join(dir, 'backend')
  if (findJvmBuildFile(backend) !== null) return backend
  return null
}

export function detectLanguageWithSource(dir: string): {
  language: Language
  source: string | null
} {
  const hasTs = existsSync(join(dir, 'package.json'))
  const jvmAtRoot = findJvmBuildFile(dir)
  const jvmInBackend = findJvmBuildFile(join(dir, 'backend'))

  // #1378: pom.xml (or any JVM build file) at the root takes precedence over package.json.
  // A Java/Kotlin project with npm tooling has both files at root but is NOT a monorepo.
  // Only a backend/ subfolder JVM build file paired with a root package.json signals a true
  // multi-language monorepo (pom.xml > package.json precedence, see #1378).
  if (hasTs && jvmInBackend !== null) {
    return { language: 'multi', source: `package.json + ${jvmInBackend}` }
  }
  if (jvmAtRoot !== null) {
    if (hasKotlinSources(dir)) return { language: 'kotlin', source: jvmAtRoot }
    return { language: 'java', source: jvmAtRoot }
  }
  // #1625: a compiled-language manifest at the root takes precedence over a root
  // package.json, mirroring the JVM-at-root precedence above. Rust+wasm-pack,
  // Go+npm-frontend-tooling, and Python+JS-tooling all carry a root package.json
  // alongside their real manifest; the primary language is the compiled one — a root
  // package.json next to it is build/dev tooling (npm scripts), not a TS project.
  // The bare `package.json` (typescript) check therefore MUST come last.
  if (existsSync(join(dir, 'Cargo.toml'))) return { language: 'rust', source: 'Cargo.toml' }
  if (existsSync(join(dir, 'go.mod'))) return { language: 'go', source: 'go.mod' }
  if (existsSync(join(dir, 'pyproject.toml')))
    return { language: 'python', source: 'pyproject.toml' }
  if (existsSync(join(dir, 'setup.py'))) return { language: 'python', source: 'setup.py' }
  if (existsSync(join(dir, 'requirements.txt')))
    return { language: 'python', source: 'requirements.txt' }
  if (hasTs) return { language: 'typescript', source: 'package.json' }
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
 * (issue #1343: a prior internal project has both `go.mod` and a frontend-lane `package.json`).
 *
 * Corroboration — rather than blind "stored wins" — preserves `update`'s documented
 * language-migration detection (schema.ts): if the stored language's signal is GONE
 * AND the project now concretely detects as a DIFFERENT language (a genuine on-disk
 * migration, e.g. package.json removed and go.mod added), the re-detected language
 * wins. But an ABSENT signal that yields no detection at all (`unknown`) must NOT
 * erase an explicit stored choice — `arbiter init --language X` persists the language
 * before any manifest is scaffolded, so a greenfield repo has a stored language and
 * zero on-disk signal; downgrading it to `unknown` would drop every language-gated
 * generator on the next `update` (#1625). Crash-safe: a missing/undefined
 * `stored.language` simply falls through to filesystem detection.
 */
export function resolveLanguage(
  dir: string,
  stored: { language?: Language } | undefined,
): Language {
  const storedLang = stored?.language
  if (storedLang !== undefined && storedLang !== 'unknown') {
    // Stored language still corroborated on disk → it wins (a frontend-lane
    // package.json must not shadow a stored go/rust primary). #1343
    if (languageSignalPresent(dir, storedLang)) return storedLang
    // Signal gone: only a CONCRETE re-detection (a genuine migration) overrides;
    // `unknown` (no signal at all) preserves the explicit stored choice. #1625
    const detected = detectLanguage(dir)
    return detected === 'unknown' ? storedLang : detected
  }
  return detectLanguage(dir)
}
