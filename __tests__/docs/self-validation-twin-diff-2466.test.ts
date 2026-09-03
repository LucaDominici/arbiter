// SPDX-License-Identifier: Apache-2.0
//
// #2466: docs/internal/METHOD/TESTING.md's "Adding a Gate to the Drill" section
// instructs a contributor to run
//
//   diff src/templates/scripts/self-validation.mjs.ejs scripts/self-validation.mjs
//   # must produce no output
//
// as the dogfood-invariant verification step after editing the drill template. That
// instruction is only true if the command it names actually exits clean on a correct
// tree. This test does not grep the doc for a phrase — it extracts the literal `diff`
// command from the doc and executes it for real, so a future edit that reintroduces
// drift (or silently rewrites the doc's command) fails here, not just in a human's
// terminal.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const TESTING_DOC = join(repoRoot, 'docs/internal/METHOD/TESTING.md')

/** Pull the `diff <a> <b>` line out of the "Adding a Gate to the Drill" section. */
function extractDocumentedDiffCommand(): string[] {
  const doc = readFileSync(TESTING_DOC, 'utf-8')
  const sectionStart = doc.indexOf('## Adding a Gate to the Drill')
  expect(sectionStart, 'TESTING.md must have an "Adding a Gate to the Drill" section').toBeGreaterThan(
    -1,
  )
  const section = doc.slice(sectionStart, doc.indexOf('\n## ', sectionStart + 1))
  const match = section.match(/^diff (\S+) (\S+)\s*$/m)
  expect(
    match,
    'the section must document a `diff <template> <materialized>` verification command',
  ).not.toBeNull()
  return [match![1], match![2]]
}

describe('#2466 TESTING.md twin-diff verification step is executable and passes', () => {
  it('names the self-validation template/materialized pair', () => {
    const [a, b] = extractDocumentedDiffCommand()
    expect(a).toBe('src/templates/scripts/self-validation.mjs.ejs')
    expect(b).toBe('scripts/self-validation.mjs')
  })

  it('running the documented diff command produces no output on this tree', () => {
    const [a, b] = extractDocumentedDiffCommand()
    let failed = false
    let output = ''
    try {
      output = execFileSync('diff', [a, b], { cwd: repoRoot, encoding: 'utf-8' })
    } catch (err) {
      failed = true
      const e = err as { stdout?: string; stderr?: string; status?: number }
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    expect(failed, `documented diff command exited non-zero; output:\n${output}`).toBe(false)
    expect(output, 'documented diff command must produce no output').toBe('')
  })
})
