// SPDX-License-Identifier: Apache-2.0
// CANON-04 render test (ADR-110, INV-137): the acceptance-anchor orchestration tools
// emitted to every governed tree (issue-readiness.mjs, rework-log.mjs and their shared
// pure core lib/acceptance-criteria.mjs) must render byte-equal to arbiter's own
// dogfooded scripts (CANON-01 dual-sided declination holds by construction) and execute
// with the INV-53 exit contract (CANON-07).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const REPO_ROOT = resolve(__dirname, '../..')

function render(tpl: string): string {
  const data = makeConfig('/tmp/test') as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}

const PAIRS: Array<[string, string]> = [
  ['scripts/issue-readiness.mjs.ejs', 'scripts/issue-readiness.mjs'],
  ['scripts/rework-log.mjs.ejs', 'scripts/rework-log.mjs'],
  ['scripts/lib/acceptance-criteria.mjs.ejs', 'scripts/lib/acceptance-criteria.mjs'],
]

describe('acceptance-anchor script templates (ADR-110)', () => {
  it.each(PAIRS)('%s renders byte-equal to the dogfooded self script', (tpl, self) => {
    expect(render(tpl)).toBe(readFileSync(join(REPO_ROOT, self), 'utf-8'))
  })

  it('rendered tools execute in a fresh tree with INV-53 exit codes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acceptance-anchor-render-'))
    try {
      mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
      writeFileSync(
        join(dir, 'scripts', 'lib', 'acceptance-criteria.mjs'),
        render('scripts/lib/acceptance-criteria.mjs.ejs'),
      )
      writeFileSync(
        join(dir, 'scripts', 'issue-readiness.mjs'),
        render('scripts/issue-readiness.mjs.ejs'),
      )
      writeFileSync(join(dir, 'scripts', 'rework-log.mjs'), render('scripts/rework-log.mjs.ejs'))

      writeFileSync(
        join(dir, 'body.md'),
        [
          '### Acceptance criteria',
          '- [ ] AC-1: retries 3 times on 5xx',
          '### Non-goals',
          '- no circuit breaker',
          '### Files / contracts touched',
          '- src/fetcher.ts',
        ].join('\n'),
      )
      const ready = spawnSync(
        process.execPath,
        ['scripts/issue-readiness.mjs', '--body-file', 'body.md'],
        { cwd: dir, encoding: 'utf-8' },
      )
      expect(ready.status).toBe(0)
      expect(JSON.parse(ready.stdout.split('\n')[0]).ready).toBe(true)

      writeFileSync(join(dir, 'vague.md'), 'make it nice')
      expect(
        spawnSync(process.execPath, ['scripts/issue-readiness.mjs', '--body-file', 'vague.md'], {
          cwd: dir,
          encoding: 'utf-8',
        }).status,
      ).toBe(1)

      const add = spawnSync(
        process.execPath,
        [
          'scripts/rework-log.mjs',
          'add',
          '--issue',
          '7',
          '--reason',
          'scope-creep',
          '--caught',
          'review',
        ],
        { cwd: dir, encoding: 'utf-8' },
      )
      expect(add.status).toBe(0)
      const report = spawnSync(process.execPath, ['scripts/rework-log.mjs', 'report'], {
        cwd: dir,
        encoding: 'utf-8',
      })
      expect(report.status).toBe(0)
      expect(report.stdout).toContain('scope-creep')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
