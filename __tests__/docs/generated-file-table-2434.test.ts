// SPDX-License-Identifier: Apache-2.0
//
// #2434 — README.md and docs/QUICKSTART.md both carry a "What gets generated"
// table. Three of its five rows named files a default `arbiter init` never wrote
// (`SECURITY.md`, `.editorconfig`, `.github/workflows/ci.yml`). No generator owns
// that table, so this test IS its check: every row is asserted against
// `examples/ts-library/` — the materialized `permitGitHub: false` twin that
// README.md calls "exactly what `arbiter init` generates today".
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const EXAMPLE = join(REPO_ROOT, 'examples', 'ts-library')
const DOCS = ['README.md', join('docs', 'QUICKSTART.md')]

const ALWAYS_HEADING = /^#+\s+Always generated\s*$/
const GITHUB_HEADING = /^#+\s+Generated only with `--github`/

/** First-column backticked paths of the markdown table that follows `heading`. */
function tableRowPaths(body: string, heading: RegExp): string[][] {
  const lines = body.split('\n')
  const start = lines.findIndex((l) => heading.test(l))
  if (start === -1) return []
  const rows: string[][] = []
  let seenSeparator = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (!line.trimStart().startsWith('|')) {
      if (rows.length > 0 || seenSeparator) break
      continue // blank lines / prose between the heading and the table
    }
    const firstCell = line.split('|')[1] ?? ''
    if (/^[\s:-]+$/.test(firstCell)) {
      seenSeparator = true
      continue
    }
    const paths = [...firstCell.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string)
    if (paths.length > 0) rows.push(paths)
  }
  return rows
}

function present(path: string): boolean {
  return existsSync(join(EXAMPLE, path.replace(/\/$/, '')))
}

describe('#2434 — the generated-file table matches what init emits', () => {
  it('examples/ts-library exists (the table is asserted against it)', () => {
    expect(existsSync(EXAMPLE)).toBe(true)
    expect(existsSync(join(EXAMPLE, '.github'))).toBe(false)
  })

  for (const doc of DOCS) {
    describe(doc, () => {
      const body = readFileSync(join(REPO_ROOT, doc), 'utf-8')

      it('has both an "Always generated" and a "--github" section', () => {
        expect(tableRowPaths(body, ALWAYS_HEADING).length).toBeGreaterThan(0)
        expect(tableRowPaths(body, GITHUB_HEADING).length).toBeGreaterThan(0)
      })

      it('every "Always generated" row is present in examples/ts-library', () => {
        // A row listing alternatives (`.claude/` / `.agents/`) is satisfied by any
        // one of them — which tool dirs land depends on the selected AI tools.
        const unmet = tableRowPaths(body, ALWAYS_HEADING).filter(
          (paths) => !paths.some((p) => present(p)),
        )
        expect(unmet).toEqual([])
      })

      it('no "--github" row is present in examples/ts-library', () => {
        const leaked = tableRowPaths(body, GITHUB_HEADING)
          .flat()
          .filter((p) => present(p))
        expect(leaked).toEqual([])
      })

      it('does not promise the ci.yml that no template emits', () => {
        expect(body).not.toContain('workflows/ci.yml')
      })
    })
  }
})
