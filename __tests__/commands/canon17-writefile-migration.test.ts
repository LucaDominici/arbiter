// SPDX-License-Identifier: Apache-2.0
// #1733 (CANON-17): src/commands/*.ts must never call node:fs writeFileSync
// directly — raw errno failures (ENOENT/EACCES/EROFS/...) would leak to the
// CLI user as an unstyled Node stack instead of a translated ArbiterError
// with an actionable i18n hint. All write call sites must route through
// writeFileTranslated() (src/utils/fs.ts), which catches errno failures and
// re-throws via ArbiterError.fromKey().
//
// This is a structural regression guard: it fails if a future edit
// reintroduces a direct writeFileSync import/call in src/commands/.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const COMMANDS_DIR = join(process.cwd(), 'src', 'commands')

// Named import: import { writeFileSync, ... } from 'node:fs'
const NAMED_IMPORT = /import\s*\{([^}]+)\}\s*from\s*'node:fs'/
// Default/namespace import grants access to fs.writeFileSync
const DEFAULT_OR_NAMESPACE_IMPORT = /import\s+(?:\*\s+as\s+)?\w+\s+from\s+'node:fs'/
const NS_WRITE_CALL = /\b\w+\.writeFileSync\s*\(/

function findViolations(): string[] {
  const violations: string[] = []
  for (const entry of readdirSync(COMMANDS_DIR)) {
    if (!entry.endsWith('.ts')) continue
    const full = join(COMMANDS_DIR, entry)
    const src = readFileSync(full, 'utf-8')
    if (!src.includes("from 'node:fs'")) continue

    const namedMatch = src.match(NAMED_IMPORT)
    if (namedMatch && /\bwriteFileSync\b/.test(namedMatch[1])) {
      violations.push(`${entry}: named import of writeFileSync from 'node:fs'`)
      continue
    }

    if (DEFAULT_OR_NAMESPACE_IMPORT.test(src) && NS_WRITE_CALL.test(src)) {
      violations.push(`${entry}: default/namespace fs import with .writeFileSync(...) call`)
    }
  }
  return violations
}

describe('CANON-17: src/commands/*.ts routes writes through writeFileTranslated (#1733)', () => {
  it('has zero direct node:fs writeFileSync call sites', () => {
    const violations = findViolations()
    expect(violations).toEqual([])
  })
})
