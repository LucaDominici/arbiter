// SPDX-License-Identifier: Apache-2.0
/**
 * Gauntlet Java JUnit5 emitter (#260).
 *
 * Emits a Java test class using `@ParameterizedTest` / `@MethodSource`.
 * Each IPOG row becomes an entry in the arguments stream.
 *
 * Existing Code Survey: grepped src/generators/ for @ParameterizedTest.
 * Found references in mutation.ts (pitest config) but no parameterised
 * test emitter — new file justified.
 */

import type { GauntletSpec } from '../spec.js'
import type { IpogRow } from '../ipog.js'
import { escapeStringLiteral, sanitizeIdentifier } from '../spec.js'

/** A representative subset of Java reserved words that could appear as a dim key. */
const JAVA_RESERVED: readonly string[] = [
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'try',
  'void',
  'volatile',
  'while',
  'true',
  'false',
  'null',
  'var',
]

export function emitJava(spec: GauntletSpec, rows: IpogRow[]): string {
  if (rows.length === 0) {
    throw new Error('Gauntlet emitter: no rows match constraints — cannot emit empty test suite')
  }
  const firstRow = rows[0] as IpogRow
  const className = sanitizeIdentifier(toPascalCase(spec.name)) + 'GauntletTest'
  const methodName = sanitizeIdentifier(`test_${toCamelCase(spec.name)}`)
  const params = Object.keys(firstRow)
  const ident = (p: string): string => sanitizeIdentifier(toCamelCase(p), JAVA_RESERVED)

  const argStream = rows
    .map((row) => {
      const vals = params.map((p) => `"${escapeStringLiteral(row[p] ?? '')}"`)
      return `      Arguments.of(${vals.join(', ')})`
    })
    .join(',\n')

  const paramDecls = params.map((p) => `String ${ident(p)}`).join(', ')
  const assertBody = params
    .map((p) => `    assertNotNull(${ident(p)}, "${escapeStringLiteral(p)} must not be null");`)
    .join('\n')

  return [
    `package gauntlet;`,
    ``,
    `// Gauntlet-generated — do not edit manually. Re-generate with:`,
    `//   arbiter gauntlet generate --spec gauntlet.yaml`,
    `// spec: ${spec.name}  strategy: ${spec.strategy}  rows: ${rows.length}`,
    ``,
    `import org.junit.jupiter.params.ParameterizedTest;`,
    `import org.junit.jupiter.params.provider.Arguments;`,
    `import org.junit.jupiter.params.provider.MethodSource;`,
    `import java.util.stream.Stream;`,
    `import static org.junit.jupiter.api.Assertions.assertNotNull;`,
    ``,
    `public class ${className} {`,
    ``,
    `    static Stream<Arguments> matrix() {`,
    `        return Stream.of(`,
    argStream,
    `        );`,
    `    }`,
    ``,
    `    @ParameterizedTest`,
    `    @MethodSource("matrix")`,
    `    void ${methodName}(${paramDecls}) {`,
    `        // TODO(#260): implement test body using params`,
    assertBody,
    `    }`,
    `}`,
    ``,
  ].join('\n')
}

function toPascalCase(s: string): string {
  return s
    .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase())
}

function toCamelCase(s: string): string {
  const pascal = toPascalCase(s)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}
