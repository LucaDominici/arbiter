import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Language } from '../wizard/types.js'

export interface BuildCommands {
  buildTool: string
  buildCommand: string
  testCommand: string
  lintCommand: string
  formatCommand: string
}

export function detectBuildCommands(dir: string, language: Language): BuildCommands {
  switch (language) {
    case 'typescript':
      return detectTypescriptCommands(dir)
    case 'rust':
      return detectRustCommands(dir)
    case 'java':
    case 'multi':
      return detectJavaCommands(dir)
    case 'go':
      return {
        buildTool: 'go',
        buildCommand: 'go build ./...',
        testCommand: 'go test ./...',
        lintCommand: 'golangci-lint run',
        formatCommand: 'gofmt -l .',
      }
    case 'python':
      return {
        buildTool: 'pip',
        buildCommand: 'pip install -e .',
        testCommand: 'pytest',
        lintCommand: 'ruff check .',
        formatCommand: 'ruff format --check .',
      }
    default:
      return {
        buildTool: 'unknown',
        buildCommand: 'echo "configure build command"',
        testCommand: 'echo "configure test command"',
        lintCommand: 'echo "configure lint command"',
        formatCommand: 'echo "configure format command"',
      }
  }
}

function detectTypescriptCommands(dir: string): BuildCommands {
  const pkg = readPackageJson(dir)
  const hasEslint = hasScript(pkg, 'lint')
  const hasPrettier = JSON.stringify(pkg).includes('prettier')
  return {
    buildTool: 'npm',
    buildCommand: getScript(pkg, 'build') ?? 'npm run build',
    testCommand: getScript(pkg, 'test') ?? 'npm test',
    lintCommand: hasEslint
      ? (getScript(pkg, 'lint') ?? 'npm run lint')
      : 'echo "no lint configured"',
    formatCommand: hasPrettier ? 'npx prettier --check .' : 'echo "no formatter configured"',
  }
}

function detectRustCommands(dir: string): BuildCommands {
  const hasCargoToml = existsSync(join(dir, 'src-tauri', 'Cargo.toml'))
  const manifest = hasCargoToml ? '--manifest-path src-tauri/Cargo.toml' : ''
  return {
    buildTool: 'cargo',
    buildCommand: `cargo build ${manifest}`.trim(),
    testCommand: `cargo test ${manifest}`.trim(),
    lintCommand: `cargo clippy ${manifest} -- -D warnings`.trim(),
    formatCommand: `cargo fmt ${manifest} --check`.trim(),
  }
}

function detectJavaCommands(dir: string): BuildCommands {
  const useWrapper = existsSync(join(dir, 'gradlew'))
  const hasBuildGradle =
    existsSync(join(dir, 'build.gradle')) || existsSync(join(dir, 'build.gradle.kts'))
  const useMaven = !useWrapper && !hasBuildGradle && existsSync(join(dir, 'pom.xml'))
  if (useMaven) {
    return {
      buildTool: 'maven',
      buildCommand: 'mvn package -DskipTests',
      testCommand: 'mvn test',
      lintCommand: 'mvn checkstyle:check',
      formatCommand: 'echo "no formatter configured"',
    }
  }
  const gradle = useWrapper ? './gradlew' : 'gradle'
  return {
    buildTool: 'gradle',
    buildCommand: `${gradle} build -x test`,
    testCommand: `${gradle} test`,
    lintCommand: `${gradle} checkstyleMain`,
    formatCommand: 'echo "no formatter configured"',
  }
}

function readPackageJson(dir: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function hasScript(pkg: Record<string, unknown>, name: string): boolean {
  const scripts = pkg['scripts']
  return typeof scripts === 'object' && scripts !== null && name in scripts
}

function getScript(pkg: Record<string, unknown>, name: string): string | null {
  const scripts = pkg['scripts']
  if (typeof scripts === 'object' && scripts !== null && name in scripts) {
    const val = (scripts as Record<string, unknown>)[name]
    return typeof val === 'string' ? `npm run ${name}` : null
  }
  return null
}
