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

function hasJvmBuildFile(dir: string): boolean {
  return (
    existsSync(join(dir, 'pom.xml')) ||
    existsSync(join(dir, 'build.gradle')) ||
    existsSync(join(dir, 'build.gradle.kts'))
  )
}

export function detectLanguage(dir: string): Language {
  const hasTs = existsSync(join(dir, 'package.json'))
  const hasJvmAtRoot = hasJvmBuildFile(dir)
  const hasJvmInBackend = hasJvmBuildFile(join(dir, 'backend'))

  if (hasTs && (hasJvmAtRoot || hasJvmInBackend)) return 'multi'
  if (hasTs) return 'typescript'
  if (existsSync(join(dir, 'Cargo.toml'))) return 'rust'
  if (hasJvmAtRoot) {
    if (hasKotlinSources(dir)) return 'kotlin'
    return 'java'
  }
  if (existsSync(join(dir, 'go.mod'))) return 'go'
  if (
    existsSync(join(dir, 'pyproject.toml')) ||
    existsSync(join(dir, 'setup.py')) ||
    existsSync(join(dir, 'requirements.txt'))
  )
    return 'python'
  return 'unknown'
}
