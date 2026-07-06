// SPDX-License-Identifier: Apache-2.0
// A9 (#1817): Flyway migration validator — naming, idempotency, destructive-DDL guard,
// dual-migration-set parity. Fixtures are fake in-memory migration files (no real fs).

import { describe, it, expect } from 'vitest'
import {
  validateFlywayMigrations,
  type MigrationFile,
} from '../../../src/kit/checks/flyway-validator.js'

function file(name: string, content: string): MigrationFile {
  return { name, content }
}

describe('validateFlywayMigrations — naming convention', () => {
  it('passes a well-named versioned migration', () => {
    const violations = validateFlywayMigrations([
      file('V1__create_users.sql', 'CREATE TABLE IF NOT EXISTS users (id int);'),
    ])
    expect(violations.filter((v) => v.rule === 'naming')).toHaveLength(0)
  })

  it('passes a well-named repeatable migration', () => {
    const violations = validateFlywayMigrations([
      file('R__users_view.sql', 'CREATE OR REPLACE VIEW users_view AS SELECT * FROM users;'),
    ])
    expect(violations.filter((v) => v.rule === 'naming')).toHaveLength(0)
  })

  it('flags a migration missing the version/description separator', () => {
    const violations = validateFlywayMigrations([file('create_users.sql', 'SELECT 1;')])
    expect(violations).toContainEqual(
      expect.objectContaining({ file: 'create_users.sql', rule: 'naming' }),
    )
  })

  it('flags a lower-case v prefix as non-conforming', () => {
    const violations = validateFlywayMigrations([file('v1__create_users.sql', 'SELECT 1;')])
    expect(violations.some((v) => v.rule === 'naming')).toBe(true)
  })
})

describe('validateFlywayMigrations — destructive DDL guard', () => {
  it('flags DROP TABLE without IF EXISTS', () => {
    const violations = validateFlywayMigrations([
      file('V2__drop_legacy.sql', 'DROP TABLE legacy_orders;'),
    ])
    expect(violations).toContainEqual(
      expect.objectContaining({ file: 'V2__drop_legacy.sql', rule: 'destructive-ddl' }),
    )
  })

  it('allows DROP TABLE IF EXISTS', () => {
    const violations = validateFlywayMigrations([
      file('V2__drop_legacy.sql', 'DROP TABLE IF EXISTS legacy_orders;'),
    ])
    expect(violations.filter((v) => v.rule === 'destructive-ddl')).toHaveLength(0)
  })

  it('flags bare TRUNCATE as destructive', () => {
    const violations = validateFlywayMigrations([
      file('V3__reset_orders.sql', 'TRUNCATE TABLE orders;'),
    ])
    expect(violations.some((v) => v.rule === 'destructive-ddl')).toBe(true)
  })

  it('respects the explicit escape-hatch marker', () => {
    const violations = validateFlywayMigrations([
      file(
        'V3__reset_orders.sql',
        '-- arbiter:allow-destructive (reviewed #1817)\nTRUNCATE TABLE orders;',
      ),
    ])
    expect(violations.filter((v) => v.rule === 'destructive-ddl')).toHaveLength(0)
  })
})

describe('validateFlywayMigrations — idempotency (repeatable only)', () => {
  it('flags CREATE TABLE without IF NOT EXISTS in a repeatable migration', () => {
    const violations = validateFlywayMigrations([
      file('R__seed_lookup.sql', 'CREATE TABLE lookup (id int);'),
    ])
    expect(violations).toContainEqual(
      expect.objectContaining({ file: 'R__seed_lookup.sql', rule: 'idempotency' }),
    )
  })

  it('does not require idempotency guards on versioned migrations', () => {
    const violations = validateFlywayMigrations([
      file('V4__create_lookup.sql', 'CREATE TABLE lookup (id int);'),
    ])
    expect(violations.filter((v) => v.rule === 'idempotency')).toHaveLength(0)
  })

  it('passes a repeatable migration using CREATE OR REPLACE', () => {
    const violations = validateFlywayMigrations([
      file('R__lookup_view.sql', 'CREATE OR REPLACE VIEW lookup_view AS SELECT * FROM lookup;'),
    ])
    expect(violations.filter((v) => v.rule === 'idempotency')).toHaveLength(0)
  })
})

describe('validateFlywayMigrations — dual migration-set parity', () => {
  it('flags a version present only in the primary set', () => {
    const primary = [file('V1__init.sql', 'CREATE TABLE IF NOT EXISTS t (id int);')]
    const secondary: MigrationFile[] = []
    const violations = validateFlywayMigrations(primary, { secondarySet: secondary })
    expect(violations).toContainEqual(
      expect.objectContaining({ rule: 'dual-set-parity', file: 'V1__init.sql' }),
    )
  })

  it('flags a version present only in the secondary set', () => {
    const primary: MigrationFile[] = []
    const secondary = [file('V1__init.sql', 'CREATE TABLE IF NOT EXISTS t (id int);')]
    const violations = validateFlywayMigrations(primary, { secondarySet: secondary })
    expect(violations).toContainEqual(
      expect.objectContaining({ rule: 'dual-set-parity', file: 'V1__init.sql' }),
    )
  })

  it('passes when both sets share the same versions', () => {
    const primary = [file('V1__init.sql', 'CREATE TABLE IF NOT EXISTS t (id int);')]
    const secondary = [file('V1__init.sql', 'CREATE TABLE IF NOT EXISTS t (id int);')]
    const violations = validateFlywayMigrations(primary, { secondarySet: secondary })
    expect(violations.filter((v) => v.rule === 'dual-set-parity')).toHaveLength(0)
  })

  it('is skipped entirely when no secondary set is supplied', () => {
    const primary = [file('V1__init.sql', 'CREATE TABLE IF NOT EXISTS t (id int);')]
    const violations = validateFlywayMigrations(primary)
    expect(violations.filter((v) => v.rule === 'dual-set-parity')).toHaveLength(0)
  })

  it('ignores non-versioned (repeatable) files when comparing sets', () => {
    // Repeatable migrations have no version, so extractVersion returns null and
    // they must never count toward parity in either direction.
    const primary = [file('R__view.sql', 'CREATE OR REPLACE VIEW v AS SELECT 1;')]
    const secondary = [file('R__view.sql', 'CREATE OR REPLACE VIEW v AS SELECT 1;')]
    const violations = validateFlywayMigrations(primary, { secondarySet: secondary })
    expect(violations.filter((v) => v.rule === 'dual-set-parity')).toHaveLength(0)
  })
})

describe('validateFlywayMigrations — destructive DROP COLUMN', () => {
  it('flags DROP COLUMN without IF EXISTS', () => {
    const violations = validateFlywayMigrations([
      file('V5__drop_col.sql', 'ALTER TABLE users DROP COLUMN legacy;'),
    ])
    expect(violations).toContainEqual(
      expect.objectContaining({ file: 'V5__drop_col.sql', rule: 'destructive-ddl' }),
    )
  })
})

describe('validateFlywayMigrations — idempotency CREATE INDEX', () => {
  it('flags CREATE INDEX without IF NOT EXISTS in a repeatable migration', () => {
    const violations = validateFlywayMigrations([
      file('R__idx.sql', 'CREATE INDEX idx_users_email ON users (email);'),
    ])
    expect(violations).toContainEqual(
      expect.objectContaining({ file: 'R__idx.sql', rule: 'idempotency' }),
    )
  })
})
