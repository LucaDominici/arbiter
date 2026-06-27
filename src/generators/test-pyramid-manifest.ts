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
  // TS: vitest convention co-locates `*.test.ts` under `src/` (arbiter's own
  // emitted example behavioral test lands at src/test/*.behavioral.test.ts), so
  // the L1 glob must cover `src/**` as well as the optional `__tests__/**` layout
  // — otherwise the freshly-scaffolded project fails its own pyramid gate on the
  // very first run (B4: gate must be green init→install→check-all).
  typescript: [
    'src/**/*.test.ts',
    'src/**/*.spec.ts',
    '__tests__/**/*.test.ts',
    '__tests__/**/*.spec.ts',
  ],
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

// Greenfield rationale for tiers arbiter does not scaffold a test for. `arbiter
// init` emits a passing example test that satisfies exactly one tier per language
// (see SCAFFOLDED_LEVELS); it does NOT fabricate property-based, integration,
// contract, e2e, or performance tests — those depend on the team's real subjects
// and infrastructure. Emitting an unscaffolded tier as `required` would make a
// fresh project fail its own gate on first run (B4). Such tiers start as `n/a`
// with an honest, auditable rationale (retaining their globs) so a team flips
// status→required once it adds real tests — the gate then enforces it.
const GREENFIELD_TIER_RATIONALE =
  'Greenfield scaffold: arbiter init does not fabricate tests for this tier — add ' +
  'real tests for it, then set status to "required" so the gate enforces it.'

// Which pyramid tier the `arbiter init` example test(s) actually populate, per
// language — the one tier that may be `required` on first run without failing the
// gate. TS/Python/Java/Go scaffold an L1 unit/behavioral test; Rust scaffolds its
// example tests under `tests/` (which the L2 glob matches) while L1 is inline-only
// and undetectable (n/a). Every other declared tier is greenfield-`n/a`.
const SCAFFOLDED_LEVEL: Partial<Record<Language, string>> = {
  rust: 'L2',
}
// Default for every language whose init scaffold populates the L1 tier.
const DEFAULT_SCAFFOLDED_LEVEL = 'L1'

/**
 * Resolve the glob patterns for a tier × language. #1653: `multi` (polyglot) has
 * no key in the per-language GLOB tables, so it previously resolved to `[]` —
 * making the `required` L1 tier glob-less and failing the unconditional
 * check-test-pyramid gate on every freshly-inited polyglot project (Day-1 RED).
 * For `multi` the globs are the union of every concrete language's globs for that
 * tier, so the L1 union matches the Java + TS BDD tests `behavioral-tests`
 * actually scaffolds for `multi` and the required tier turns green honestly.
 */
function globsForLevel(id: string, language: Language): string[] {
  const map = GLOB_BY_LEVEL[id] ?? {}
  if (language === 'multi') {
    return [...new Set(Object.values(map).flat())]
  }
  return map[language] ?? []
}

function buildManifestLevel(id: string, name: string, language: Language): object {
  // Rust L1 gets n/a — inline tests are undetectable by file presence
  if (id === 'L1' && language === 'rust') {
    return { id, name, status: 'n/a', rationale: RUST_L1_RATIONALE }
  }

  const globs = globsForLevel(id, language)

  // Only the single tier the init scaffold populates is `required`; every other
  // tier is greenfield-`n/a` (retaining globs) so first-run is green and honest.
  if (id !== (SCAFFOLDED_LEVEL[language] ?? DEFAULT_SCAFFOLDED_LEVEL)) {
    return { id, name, globs, status: 'n/a', rationale: GREENFIELD_TIER_RATIONALE }
  }

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
