// SPDX-License-Identifier: Apache-2.0
/**
 * Gauntlet Rust rstest emitter (#260).
 *
 * Emits a Rust test module using `#[rstest]` with `#[case]` attributes.
 * Each IPOG row becomes a `#[case(...)]` annotation.
 *
 * Existing Code Survey: grepped src/generators/ for rstest. Found
 * references in rust-boundaries.ts (module boundary checks) but no
 * rstest emitter — new file justified.
 */

import type { GauntletSpec } from '../spec.js'
import type { IpogRow } from '../ipog.js'
import { escapeStringLiteral, sanitizeIdentifier } from '../spec.js'

/** Rust reserved keywords (incl. reserved-for-future) that may appear as a dim key. */
const RUST_RESERVED: readonly string[] = [
  'as',
  'break',
  'const',
  'continue',
  'crate',
  'dyn',
  'else',
  'enum',
  'extern',
  'false',
  'fn',
  'for',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'match',
  'mod',
  'move',
  'mut',
  'pub',
  'ref',
  'return',
  'self',
  'Self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'type',
  'unsafe',
  'use',
  'where',
  'while',
  'async',
  'await',
  'dyn',
  'abstract',
  'become',
  'box',
  'do',
  'final',
  'macro',
  'override',
  'priv',
  'typeof',
  'unsized',
  'virtual',
  'yield',
  'try',
]

export function emitRust(spec: GauntletSpec, rows: IpogRow[]): string {
  if (rows.length === 0) {
    throw new Error('Gauntlet emitter: no rows match constraints — cannot emit empty test suite')
  }
  const firstRow = rows[0] as IpogRow
  const params = Object.keys(firstRow)
  const modName = sanitizeIdentifier(toSnakeCase(spec.name))
  const ident = (p: string): string => sanitizeIdentifier(toSnakeCase(p), RUST_RESERVED)

  const cases = rows
    .map((row) => {
      const vals = params.map((p) => `"${escapeStringLiteral(row[p] ?? '')}"`)
      return `    #[case(${vals.join(', ')})]`
    })
    .join('\n')

  const paramDecls = params.map((p) => `${ident(p)}: &str`).join(', ')
  const assertBody = params
    .map(
      (p) => `    assert!(!${ident(p)}.is_empty(), "${escapeStringLiteral(p)} must not be empty");`,
    )
    .join('\n')

  return [
    `// Gauntlet-generated — do not edit manually. Re-generate with:`,
    `//   arbiter gauntlet generate --spec gauntlet.yaml`,
    `// spec: ${spec.name}  strategy: ${spec.strategy}  rows: ${rows.length}`,
    ``,
    `#[cfg(test)]`,
    `mod ${modName}_gauntlet {`,
    `    use rstest::rstest;`,
    ``,
    `    #[rstest]`,
    cases,
    `    fn ${sanitizeIdentifier(`test_${modName}`)}(${paramDecls}) {`,
    `        // TODO(#260): implement test body using params`,
    assertBody,
    `    }`,
    `}`,
    ``,
  ].join('\n')
}

function toSnakeCase(s: string): string {
  return s
    .replace(/[-\s]+/g, '_')
    .replace(/([A-Z])/g, (_, c: string) => `_${c.toLowerCase()}`)
    .replace(/^_/, '')
    .toLowerCase()
}
