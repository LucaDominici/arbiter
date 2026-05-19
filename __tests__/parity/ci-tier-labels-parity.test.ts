// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { renderTemplate } from '../../src/utils/render.js'
import { readFileSync } from 'node:fs'

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/ci-tier-render-context.json', import.meta.url), 'utf-8'),
)

describe('ci-tier render parity — labels', () => {
  it('.github/labels.yml matches github/labels.yml.ejs', async () => {
    const committed = await readFile('.github/labels.yml', 'utf-8')
    const rendered = renderTemplate('github/labels.yml.ejs', fixture)
    expect(committed.replace(/\r\n/g, '\n')).toBe(rendered.replace(/\r\n/g, '\n'))
  })
})
