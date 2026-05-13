/**
 * Gauntlet TypeScript Playwright emitter (#260).
 *
 * Emits a `.spec.ts` file using `test.describe()` / `test()` from
 * `@playwright/test`. Each row from the IPOG matrix becomes a test case
 * parameterised via `test.describe.each()`.
 *
 * Existing Code Survey: grepped src/generators/ for parameterised test
 * emitters. Found per-stack generators (coverage.ts, behavioral-tests.ts)
 * but no existing pairwise emitter — new file justified.
 */

import type { GauntletSpec } from '../spec.js'
import type { IpogRow } from '../ipog.js'

export function emitTypeScript(spec: GauntletSpec, rows: IpogRow[]): string {
  const tagComment = spec.tags.length > 0 ? `// ${spec.tags.join(' ')}\n` : ''
  const lines: string[] = [
    tagComment + `import { test, expect } from '@playwright/test'`,
    '',
    `// Gauntlet-generated — do not edit manually. Re-generate with:`,
    `//   arbiter gauntlet generate --spec gauntlet.yaml`,
    `// spec: ${spec.name}  strategy: ${spec.strategy}  rows: ${rows.length}`,
    '',
    `const matrix = ${JSON.stringify(rows, null, 2)} as const`,
    '',
    `test.describe('${spec.name}', () => {`,
    `  for (const params of matrix) {`,
    `    const label = Object.entries(params).map(([k,v]) => \`\${k}=\${v}\`).join(', ')`,
    `    test(\`[${spec.tags[0] ?? '@gauntlet'}] \${label}\`, async ({ page }) => {`,
    `      // TODO(#260): implement test body using params`,
    `      expect(params).toBeTruthy()`,
    `    })`,
    `  }`,
    `})`,
  ]
  return lines.join('\n') + '\n'
}
