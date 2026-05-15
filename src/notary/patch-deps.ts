// SPDX-License-Identifier: Apache-2.0
/**
 * Patch-dependency map: maps file path patterns → required index files to update.
 *
 * Rules:
 *   docs/SYSTEM/** .md → must update SSOT_CORE_SET.md AND KNOWLEDGE_MAP.md
 *   docs/** .md        → must update KNOWLEDGE_MAP.md
 *   other              → no required patches
 *
 * Exempted paths (no patches required regardless of file type):
 *   .evidence/**
 *   .claude/plans/**
 *   archives/**
 *
 * Existing Code Survey (CANON-16):
 *   - grep for "patch.dep\|patchDep\|PatchDep" src/ --include="*.ts" -l → no matches
 *   - Decision: new file justified — no similar path-to-patch mapping exists
 *
 * #256
 */

const EXEMPTED_PREFIXES: ReadonlyArray<string> = ['.evidence/', '.claude/plans/', 'archives/']

const SSOT_CORE_SET = 'docs/SSOT_CORE_SET.md'
const KNOWLEDGE_MAP = 'docs/KNOWLEDGE_MAP.md'

/**
 * Returns the list of index files that must be updated when the given
 * file path changes. Returns an empty array for non-doc or exempted paths.
 */
export function getRequiredPatches(filePath: string): string[] {
  // Normalize to forward slashes
  const normalized = filePath.replace(/\\/g, '/')

  // Check exemptions first
  for (const prefix of EXEMPTED_PREFIXES) {
    if (normalized.startsWith(prefix)) return []
  }

  // Only markdown files require patches
  if (!normalized.endsWith('.md')) return []

  // docs/SYSTEM/ → both index files
  if (normalized.startsWith('docs/SYSTEM/')) {
    return [SSOT_CORE_SET, KNOWLEDGE_MAP]
  }

  // Any other docs/ markdown → KNOWLEDGE_MAP only
  if (normalized.startsWith('docs/')) {
    return [KNOWLEDGE_MAP]
  }

  return []
}
