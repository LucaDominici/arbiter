// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator for test-pyramid.json (#1364, INV-124).
// Emits a machine-readable manifest of declared test levels with language-appropriate
// globs, cross-referenced against the archetype's TestPyramidProfile.
// skipIfExists: true — teams may customise globs/rationales after init.
// The stale-manifest check (archetype mismatch) is gate-resident, not here.
import { writeFile, resolvedPath } from '../utils/fs.js'
import { getTestPyramidProfile } from '../config/test-pyramid-profiles.js'
import type { Language, ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface TestPyramidManifestResult {
  files: WriteResult[]
}

// Language-to-glob map for standard test file patterns.
// Rust L1 Unit cannot be detected by file presence (inline #[test] annotations);
// the generator emits it as n/a with a documented rationale (amendment #8).
const L1_GLOBS: Partial<Record<Language, string[]>> = {
  typescript: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
  java: ['src/test/**/*Test.java', 'src/test/**/*Tests.java'],
  kotlin: ['src/test/**/*Test.kt', 'src/test/**/*Spec.kt'],
  python: ['tests/**/*.py', 'test/**/*.py'],
  go: ['**/*_test.go'],
  rust: [], // Rust L1 unit tests are inline #[test] annotations — see n/a entry below
}

const L2_GLOBS: Partial<Record<Language, string[]>> = {
  typescript: ['__tests__/property/**/*.property.test.ts', '__tests__/**/*.spec.ts'],
  java: ['src/test/**/*IT.java', 'src/integrationTest/**/*.java'],
  kotlin: ['src/integrationTest/**/*IT.kt'],
  python: ['tests/integration/**/*.py'],
  go: ['tests/**/*_test.go', 'integration/**/*_test.go'],
  rust: ['tests/**/*.rs'],
}

const L3_GLOBS: Partial<Record<Language, string[]>> = {
  typescript: ['__tests__/contract/**/*.test.ts'],
  java: ['src/test/**/*Contract*.java'],
  kotlin: ['src/test/**/*Contract*.kt'],
  python: ['tests/contract/**/*.py'],
  go: ['contract/**/*_test.go'],
  rust: ['tests/contract/**/*.rs'],
}

const L4_GLOBS: Partial<Record<Language, string[]>> = {
  typescript: ['e2e/**/*.spec.ts', 'playwright/**/*.spec.ts', '__tests__/e2e/**/*.test.ts'],
  java: ['src/e2e/**/*.java'],
  kotlin: ['src/e2e/**/*.kt'],
  python: ['tests/e2e/**/*.py'],
  go: ['e2e/**/*_test.go'],
  rust: ['tests/e2e/**/*.rs'],
}

const L5_GLOBS: Partial<Record<Language, string[]>> = {
  typescript: ['perf/**/*.test.ts', '__tests__/perf/**/*.test.ts'],
  java: ['src/test/**/*Performance*.java', 'src/test/**/*Load*.java'],
  kotlin: ['src/test/**/*Performance*.kt'],
  python: ['tests/perf/**/*.py'],
  go: ['perf/**/*_test.go'],
  rust: ['tests/perf/**/*.rs'],
}

// ID → glob table (resolved per language at generation time)
const GLOB_BY_LEVEL: Record<string, Partial<Record<Language, string[]>>> = {
  L1: L1_GLOBS,
  L2: L2_GLOBS,
  L3: L3_GLOBS,
  L4: L4_GLOBS,
  L5: L5_GLOBS,
}

// Rust L1 rationale (amendment #8: inline #[test] cannot be glob-detected)
const RUST_L1_RATIONALE =
  'Rust unit tests are inline #[test] annotations inside source files; file presence cannot confirm test existence.'

function buildManifestLevel(id: string, name: string, language: Language): object {
  // Rust L1 gets n/a — inline tests are undetectable by file presence
  if (id === 'L1' && language === 'rust') {
    return { id, name, status: 'n/a', rationale: RUST_L1_RATIONALE }
  }

  const globs = GLOB_BY_LEVEL[id]?.[language] ?? []
  return { id, name, globs, status: 'required' }
}

export function generateTestPyramidManifest(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): TestPyramidManifestResult {
  const profile = getTestPyramidProfile(config.archetype)
  const language = config.language

  const levels = profile.levels.map((level) => buildManifestLevel(level.id, level.name, language))

  const manifest = {
    archetype: config.archetype,
    levels,
  }

  const path = resolvedPath(config.targetDir, 'test-pyramid.json')
  const content = JSON.stringify(manifest, null, 2) + '\n'

  return {
    files: [writeFile(path, content, { skipIfExists: true, dryRun: opts.dryRun })],
  }
}
