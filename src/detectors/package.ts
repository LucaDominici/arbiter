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
    const match = content.match(/<groupId>([^<]+)<\/groupId>/)
    if (match?.[1]) return match[1].trim()
  }

  const gradlePath = join(dir, 'build.gradle')
  if (existsSync(gradlePath)) {
    const content = readFileSync(gradlePath, 'utf-8')
    const match = content.match(/^group\s*=\s*['"]([^'"]+)['"]/m)
    if (match?.[1]) return match[1].trim()
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
