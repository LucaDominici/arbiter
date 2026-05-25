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
