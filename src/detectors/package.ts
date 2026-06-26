// SPDX-License-Identifier: Apache-2.0
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Detects the base Java package for a project.
 * Priority: pom.xml groupId > build.gradle group > directory scan of src/main/java
 */
export function detectBasePackage(dir: string): string | undefined {
  const pomPath = join(dir, 'pom.xml')
  if (existsSync(pomPath)) {
    const content = readFileSync(pomPath, 'utf-8')
    // The project's OWN <groupId> is the base package, not the inherited
    // <parent> groupId. In a standard Spring Boot pom the <parent> block
    // (spring-boot-starter-parent → org.springframework.boot) precedes the
    // project's groupId, so a first-match regex over the raw content grabs the
    // framework's package and mis-scaffolds every generated source under it
    // (#1582). Strip the <parent> block first so the project's groupId wins.
    const stripped = content.replace(/<parent>[\s\S]*?<\/parent>/i, '')
    const own = stripped.match(/<groupId>([^<]+)<\/groupId>/)
    if (own?.[1]) return own[1].trim()
    // Maven inheritance: a child that omits its own <groupId> inherits the
    // parent's. With the project groupId absent, fall back to the parent's.
    const inherited = content.match(/<groupId>([^<]+)<\/groupId>/)
    if (inherited?.[1]) return inherited[1].trim()
  }

  // Match `group = "com.acme"` (Groovy DSL) and `group = "com.acme"` (Kotlin DSL —
  // identical syntax for top-level assignment). Previously only `build.gradle`
  // was read, so Kotlin-DSL Java projects fell through to source-tree scanning
  // even when the build file carried the group explicitly (#278 finding #1).
  for (const gradleFile of ['build.gradle', 'build.gradle.kts']) {
    const gradlePath = join(dir, gradleFile)
    if (existsSync(gradlePath)) {
      const content = readFileSync(gradlePath, 'utf-8')
      const match = content.match(/^group\s*=\s*['"]([^'"]+)['"]/m)
      if (match?.[1]) return match[1].trim()
    }
  }

  return detectFromJavaSourceTree(join(dir, 'src', 'main', 'java'))
}

function detectFromJavaSourceTree(javaRoot: string): string | undefined {
  if (!existsSync(javaRoot)) return undefined
  const parts: string[] = []
  let current = javaRoot
  for (let depth = 0; depth < 6; depth++) {
    let entries: string[]
    try {
      entries = readdirSync(current).filter((e) => statSync(join(current, e)).isDirectory())
    } catch {
      break
    }
    if (entries.length !== 1) break
    const entry = entries[0] as string
    parts.push(entry)
    current = join(current, entry)
  }
  return parts.length > 0 ? parts.join('.') : undefined
}
