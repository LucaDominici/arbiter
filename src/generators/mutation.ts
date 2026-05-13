import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { isL3Allowed } from '../utils/maturity-check.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface MutationGeneratorResult {
  files: WriteResult[]
}

function shouldEmit(target: 'java' | 'typescript', language: string, acceptBeta: boolean): boolean {
  if (language === target) return true
  if (language !== 'multi') return false
  return isL3Allowed(target, 'mutation', acceptBeta).allowed
}

function emitJavaMutation(targetDir: string, buildTool: string, data: object): WriteResult {
  if (buildTool === 'maven') {
    return writeFile(
      resolvedPath(targetDir, 'docs', 'mutation', 'pitest-maven-setup.md'),
      renderTemplate('mutation/pitest-maven-setup.md.ejs', data),
      { skipIfExists: true },
    )
  }
  return writeFile(
    resolvedPath(targetDir, 'gradle', 'pitest.gradle'),
    renderTemplate('mutation/pitest.gradle.ejs', data),
    { skipIfExists: true },
  )
}

export function generateMutation(config: ProjectConfig): MutationGeneratorResult {
  if (config.governanceLevel !== 'L3') return { files: [] }

  const { language, targetDir, acceptBetaTools = false } = config

  if (language !== 'multi') {
    const gate = isL3Allowed(language, 'mutation', acceptBetaTools)
    if (!gate.allowed) return { files: [] }
  }

  const data: object = {
    ...config,
    mutationThreshold: config.thresholds?.mutationScore || 85,
    basePackage: config.basePackage ?? 'com.example',
    modulePath: config.projectName.replace(/-/g, '_'),
  }

  const files: WriteResult[] = []

  if (shouldEmit('java', language, acceptBetaTools)) {
    files.push(emitJavaMutation(targetDir, config.buildTool, data))
  }
  if (shouldEmit('typescript', language, acceptBetaTools)) {
    files.push(
      writeFile(
        resolvedPath(targetDir, 'stryker.conf.json'),
        renderTemplate('mutation/stryker.conf.json.ejs', data),
        { skipIfExists: true },
      ),
    )
  }
  if (language === 'rust') {
    files.push(
      writeFile(
        resolvedPath(targetDir, 'cargo-mutants.toml'),
        renderTemplate('mutation/cargo-mutants.toml.ejs', data),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(targetDir, 'scripts', 'parse-mutants.mjs'),
        renderTemplate('mutation/parse-mutants.mjs.ejs', data),
        { skipIfExists: true },
      ),
    )
  } else if (language === 'python') {
    files.push(
      writeFile(
        resolvedPath(targetDir, 'mutmut-config.toml'),
        renderTemplate('mutation/mutmut-config.toml.ejs', data),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(targetDir, 'scripts', 'parse-mutmut.py'),
        renderTemplate('mutation/parse-mutmut.py.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  return { files }
}
