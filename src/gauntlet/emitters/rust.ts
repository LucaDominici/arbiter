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

export function emitRust(spec: GauntletSpec, rows: IpogRow[]): string {
  const params = Object.keys(rows[0] ?? {})
  const modName = toSnakeCase(spec.name)

  const cases = rows
    .map((row) => {
      const vals = params.map((p) => `"${row[p] ?? ''}"`)
      return `    #[case(${vals.join(', ')})]`
    })
    .join('\n')

  const paramDecls = params.map((p) => `${toSnakeCase(p)}: &str`).join(', ')
  const assertBody = params
    .map((p) => `    assert!(!${toSnakeCase(p)}.is_empty(), "${p} must not be empty");`)
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
    `    fn test_${modName}(${paramDecls}) {`,
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
