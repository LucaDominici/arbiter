// SPDX-License-Identifier: Apache-2.0
/**
 * A9 (#1817): Flyway migration validator — opt-in java-kit check.
 *
 * Generalizes the Viafera INV-09 migration-validator pattern: naming convention,
 * destructive-DDL guard, idempotency (repeatable migrations), and dual-migration-set
 * parity (e.g. a Postgres set + a SQLite set for an embedded-DB test profile).
 *
 * Pure text-based validation — callers own file I/O (see src/commands/kit.ts).
 */

export interface MigrationFile {
  /** File name only (no directory), e.g. "V1__create_users.sql" or "R__users_view.sql". */
  name: string
  content: string
}

type FlywayRule = 'naming' | 'destructive-ddl' | 'idempotency' | 'dual-set-parity'

export interface FlywayViolation {
  file: string
  rule: FlywayRule
  message: string
}

export interface FlywayValidationOptions {
  /** Second dialect's migration set, for dual-migration-set parity (opt-in). */
  secondarySet?: MigrationFile[]
}

const VERSIONED_NAME = /^V(\d+(?:\.\d+)*)__\w+\.sql$/
const REPEATABLE_NAME = /^R__\w+\.sql$/
const UNDO_NAME = /^U(\d+(?:\.\d+)*)__\w+\.sql$/

const ALLOW_DESTRUCTIVE_MARKER = '-- arbiter:allow-destructive'

function extractVersion(name: string): string | null {
  const match = VERSIONED_NAME.exec(name)
  return match ? (match[1] ?? null) : null
}

/** Rule: naming convention (V<version>__desc.sql | R__desc.sql | U<version>__desc.sql). */
function validateNaming(files: MigrationFile[]): FlywayViolation[] {
  const violations: FlywayViolation[] = []
  for (const f of files) {
    const conforms =
      VERSIONED_NAME.test(f.name) || REPEATABLE_NAME.test(f.name) || UNDO_NAME.test(f.name)
    if (!conforms) {
      violations.push({
        file: f.name,
        rule: 'naming',
        message: `"${f.name}" does not match V<version>__desc.sql, R__desc.sql, or U<version>__desc.sql`,
      })
    }
  }
  return violations
}

/** Rule: destructive DDL (DROP TABLE/COLUMN, TRUNCATE) must be guarded or explicitly reviewed. */
function checkDestructiveDdl(files: MigrationFile[]): FlywayViolation[] {
  const violations: FlywayViolation[] = []
  const dropTablePattern = /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i
  const dropColumnPattern = /DROP\s+COLUMN\s+(?!IF\s+EXISTS)/i
  const truncatePattern = /TRUNCATE\s+(TABLE\s+)?/i

  for (const f of files) {
    if (f.content.includes(ALLOW_DESTRUCTIVE_MARKER)) continue
    if (dropTablePattern.test(f.content)) {
      violations.push({
        file: f.name,
        rule: 'destructive-ddl',
        message:
          'DROP TABLE without IF EXISTS — add the guard or an explicit allow-destructive marker',
      })
    }
    if (dropColumnPattern.test(f.content)) {
      violations.push({
        file: f.name,
        rule: 'destructive-ddl',
        message:
          'DROP COLUMN without IF EXISTS — add the guard or an explicit allow-destructive marker',
      })
    }
    if (truncatePattern.test(f.content)) {
      violations.push({
        file: f.name,
        rule: 'destructive-ddl',
        message: 'TRUNCATE has no safe guard — requires an explicit allow-destructive marker',
      })
    }
  }
  return violations
}

/** Rule: repeatable (R__) migrations must be idempotent — versioned migrations are exempt. */
function checkIdempotency(files: MigrationFile[]): FlywayViolation[] {
  const violations: FlywayViolation[] = []
  const createTableNoGuard = /CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i
  const createIndexNoGuard = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i

  for (const f of files) {
    if (!REPEATABLE_NAME.test(f.name)) continue
    if (createTableNoGuard.test(f.content)) {
      violations.push({
        file: f.name,
        rule: 'idempotency',
        message: 'repeatable migration uses CREATE TABLE without IF NOT EXISTS',
      })
    }
    if (createIndexNoGuard.test(f.content)) {
      violations.push({
        file: f.name,
        rule: 'idempotency',
        message: 'repeatable migration uses CREATE INDEX without IF NOT EXISTS',
      })
    }
  }
  return violations
}

/** Rule: dual-migration-set parity — every versioned migration must exist in both dialect sets. */
function checkDualSetParity(
  primary: MigrationFile[],
  secondary: MigrationFile[],
): FlywayViolation[] {
  const violations: FlywayViolation[] = []
  const primaryByVersion = new Map<string, string>()
  for (const f of primary) {
    const v = extractVersion(f.name)
    if (v) primaryByVersion.set(v, f.name)
  }
  const secondaryByVersion = new Map<string, string>()
  for (const f of secondary) {
    const v = extractVersion(f.name)
    if (v) secondaryByVersion.set(v, f.name)
  }

  for (const [version, name] of primaryByVersion) {
    if (!secondaryByVersion.has(version)) {
      violations.push({
        file: name,
        rule: 'dual-set-parity',
        message: `version V${version} has no counterpart in the secondary migration set`,
      })
    }
  }
  for (const [version, name] of secondaryByVersion) {
    if (!primaryByVersion.has(version)) {
      violations.push({
        file: name,
        rule: 'dual-set-parity',
        message: `version V${version} has no counterpart in the primary migration set`,
      })
    }
  }
  return violations
}

/** Combined opt-in validator — runs all rules; dual-set parity only when a secondary set is given. */
export function validateFlywayMigrations(
  files: MigrationFile[],
  options: FlywayValidationOptions = {},
): FlywayViolation[] {
  const violations = [
    ...validateNaming(files),
    ...checkDestructiveDdl(files),
    ...checkIdempotency(files),
  ]
  if (options.secondarySet) {
    violations.push(...checkDualSetParity(files, options.secondarySet))
  }
  return violations
}
