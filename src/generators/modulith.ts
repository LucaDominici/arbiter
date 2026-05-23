// SPDX-License-Identifier: Apache-2.0
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ModulithGeneratorResult {
  files: WriteResult[]
}

function isSpringBootProject(targetDir: string): boolean {
  const pomPath = join(targetDir, 'pom.xml')
  if (existsSync(pomPath)) {
    try {
      const content = readFileSync(pomPath, 'utf8')
      return content.includes('spring-boot-starter')
    } catch {
      return false
    }
  }
  const gradlePath = join(targetDir, 'build.gradle')
  const gradleKtsPath = join(targetDir, 'build.gradle.kts')
  for (const gPath of [gradlePath, gradleKtsPath]) {
    if (existsSync(gPath)) {
      try {
        const content = readFileSync(gPath, 'utf8')
        if (content.includes('spring-boot')) return true
      } catch {
        continue
      }
    }
  }
  return false
}

export function generateModulith(config: ProjectConfig): ModulithGeneratorResult {
  if (config.language !== 'java' && config.language !== 'multi') return { files: [] }

  // Only emit when the target is a Spring Boot project (detected by pom.xml / build.gradle).
  // Greenfield targets don't have a pom yet, so we treat kitEnabled=true as sufficient signal
  // that the user wants the Spring Modulith scaffolding.
  const springBoot = isSpringBootProject(config.targetDir) || config.kitEnabled === true
  if (!springBoot) return { files: [] }

  const packagePath = config.basePackage
    ? config.basePackage.replace(/\./g, '/') + '/modulith'
    : 'modulith'

  const data = {
    ...config,
    basePackage: config.basePackage ?? 'com.example',
  }

  return {
    files: [
      writeFile(
        resolvedPath(
          config.targetDir,
          'src',
          'test',
          'java',
          packagePath,
          'ApplicationModulesTest.java',
        ),
        renderTemplate('java/modulith/ApplicationModulesTest.java.ejs', data),
        { skipIfExists: true },
      ),
    ],
  }
}
