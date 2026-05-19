// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { renderTemplate } from '../../src/utils/render.js'
import { readFileSync } from 'node:fs'

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/ci-tier-render-context.json', import.meta.url), 'utf-8'),
)

const workflows = [
  ['01-pr-fast.yml', 'github/workflows/01-pr-fast.yml.ejs'],
  ['02-pr-extended.yml', 'github/workflows/02-pr-extended.yml.ejs'],
  ['03-human-approval.yml', 'github/workflows/03-human-approval.yml.ejs'],
  ['09-heartbeat.yml', 'github/workflows/09-heartbeat.yml.ejs'],
  ['_notify.yml', 'github/workflows/_notify.yml.ejs'],
  ['_label-sync.yml', 'github/workflows/_label-sync.yml.ejs'],
] as const

describe('ci-tier render parity — workflows', () => {
  for (const [out, tpl] of workflows) {
    it(`.github/workflows/${out} matches ${tpl}`, async () => {
      const committed = await readFile(`.github/workflows/${out}`, 'utf-8')
      const rendered = renderTemplate(tpl, fixture)
      expect(committed.replace(/\r\n/g, '\n')).toBe(rendered.replace(/\r\n/g, '\n'))
    })
  }
})
