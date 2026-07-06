// SPDX-License-Identifier: Apache-2.0
/**
 * A9 (#1817): Java test taxonomy gate — opt-in java-kit check.
 *
 * Enforces JUnit5 `@Tag("unit")` / `@Tag("integration")` (or a project-supplied allowlist)
 * on every test file, as a count gate: zero untagged tests allowed.
 *
 * Pure text-based validation — callers own file I/O (see src/commands/kit.ts).
 */

export interface JavaTestFile {
  path: string
  content: string
}

export interface TaxonomyOptions {
  /** Recognized tags — a file is "tagged" if it carries at least one of these. Default: unit/integration. */
  requiredTags?: string[]
}

export interface TaxonomyResult {
  totalFiles: number
  untaggedFiles: string[]
  requiredTags: string[]
}

const DEFAULT_REQUIRED_TAGS = ['unit', 'integration']
const TAG_PATTERN = /@Tag\(\s*"([^"]+)"\s*\)/g

function extractTags(content: string): Set<string> {
  const tags = new Set<string>()
  let match: RegExpExecArray | null
  TAG_PATTERN.lastIndex = 0
  while ((match = TAG_PATTERN.exec(content)) !== null) {
    if (match[1]) tags.add(match[1])
  }
  return tags
}

/** Scans Java test files for the presence of at least one recognized @Tag. */
export function checkJavaTestTaxonomy(
  files: JavaTestFile[],
  options: TaxonomyOptions = {},
): TaxonomyResult {
  const requiredTags = options.requiredTags ?? DEFAULT_REQUIRED_TAGS
  const untaggedFiles: string[] = []

  for (const f of files) {
    const tags = extractTags(f.content)
    const hasRequiredTag = requiredTags.some((tag) => tags.has(tag))
    if (!hasRequiredTag) untaggedFiles.push(f.path)
  }

  return { totalFiles: files.length, untaggedFiles, requiredTags }
}

/** Count gate: passes only when zero test files are untagged. */
export function isTaxonomyGatePass(result: TaxonomyResult): boolean {
  return result.untaggedFiles.length === 0
}
