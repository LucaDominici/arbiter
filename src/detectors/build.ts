// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Language } from '../wizard/types.js'
import { readPackageJsonSafe } from '../utils/safe-read.js'
import { jvmRoot } from './language.js'

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
    case 'kotlin':
    case 'multi':
      // For `multi` the JVM build lives under backend/, not the root (#1378); resolve
      // it via jvmRoot so a Maven backend gets Maven commands instead of falling
      // through to the Gradle default for an empty root (#1567). For `java` jvmRoot
      // is the root itself, so behaviour is unchanged. `kotlin` shares the identical
      // JVM build-file markers (gradlew/build.gradle(.kts)/pom.xml) — before this
      // case existed, kotlin fell through to `default` (buildTool: 'unknown'), which
      // silently coerced every `buildTool === 'gradle' ? … : …` template check to its
      // maven branch regardless of what was actually on disk (#1803 end-to-end repro).
      return detectJavaCommands(jvmRoot(dir) ?? dir)
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
  // Substring match on the serialized package.json mistakenly counted
  // `eslint-config-prettier`, `prettier-eslint`, scripts mentioning "prettier",
  // or description text — leading to a `prettier --check` command even when
  // the binary is not installed (#278 finding #9). Restrict to actual prettier
  // dependency keys (the package itself or first-party plugins).
  const hasPrettier = hasPrettierDependency(pkg)
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

const readPackageJson = readPackageJsonSafe

function hasScript(pkg: Record<string, unknown>, name: string): boolean {
  const scripts = pkg['scripts']
  return typeof scripts === 'object' && scripts !== null && name in scripts
}

/**
 * Detect whether the project declares prettier as an actual dependency.
 *
 * Matches the bare `prettier` package or any first-party `prettier-plugin-*`.
 * Excludes ESLint integration packages like `eslint-config-prettier` and
 * `prettier-eslint` which advertise prettier in their name but do not install
 * the binary themselves (#278 finding #9).
 */
function hasPrettierDependency(pkg: Record<string, unknown>): boolean {
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[key]
    if (typeof deps !== 'object' || deps === null) continue
    for (const name of Object.keys(deps)) {
      if (name === 'prettier') return true
      if (name.startsWith('prettier-plugin-')) return true
    }
  }
  return false
}

function getScript(pkg: Record<string, unknown>, name: string): string | null {
  const scripts = pkg['scripts']
  if (typeof scripts === 'object' && scripts !== null && name in scripts) {
    const val = (scripts as Record<string, unknown>)[name]
    return typeof val === 'string' ? `npm run ${name}` : null
  }
  return null
}
