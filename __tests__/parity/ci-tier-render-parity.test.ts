// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { renderTemplate } from '../../src/utils/render.js'
import { readFileSync, readdirSync } from 'node:fs'

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/ci-tier-render-context.json', import.meta.url), 'utf-8'),
)

const workflows = [
  ['01-pr-fast.yml', 'github/workflows/01-pr-fast.yml.ejs'],
  ['02-pr-extended.yml', 'github/workflows/02-pr-extended.yml.ejs'],
  ['03-human-approval.yml', 'github/workflows/03-human-approval.yml.ejs'],
  ['06-nightly.yml', 'github/workflows/06-nightly.yml.ejs'],
  ['07-weekly.yml', 'github/workflows/07-weekly.yml.ejs'],
  ['08-monthly.yml', 'github/workflows/08-monthly.yml.ejs'],
  ['09-heartbeat.yml', 'github/workflows/09-heartbeat.yml.ejs'],
  ['_notify.yml', 'github/workflows/_notify.yml.ejs'],
  ['_label-sync.yml', 'github/workflows/_label-sync.yml.ejs'],
  ['_label-on-approve.yml', 'github/workflows/_label-on-approve.yml.ejs'],
  ['_ai-draft-check.yml', 'github/workflows/_ai-draft-check.yml.ejs'],
  ['_pr-staleness.yml', 'github/workflows/_pr-staleness.yml.ejs'],
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

describe('ci-tier render parity — labels.yml', () => {
  it('.github/labels.yml matches github/labels.yml.ejs', async () => {
    const committed = await readFile('.github/labels.yml', 'utf-8')
    const rendered = renderTemplate('github/labels.yml.ejs', fixture)
    expect(committed.replace(/\r\n/g, '\n')).toBe(rendered.replace(/\r\n/g, '\n'))
  })
})

function loadLabelNames(): Set<string> {
  // labels.yml has a simple flat shape — each label is `  - name: "X"` or
  // `  - name: X` (unquoted). Regex-parse to avoid pulling a yaml dep.
  const labelsYml = readFileSync('.github/labels.yml', 'utf-8')
  const names = new Set<string>()
  const namePattern = /^\s*-\s*name:\s*["']?([^"'\n]+?)["']?\s*$/gm
  for (const match of labelsYml.matchAll(namePattern)) {
    const name = match[1]?.trim()
    if (name) names.add(name)
  }
  return names
}

function collectLabelReferences(): Map<string, string[]> {
  // label name → list of workflow files that reference it via `--label X`.
  const refs = new Map<string, string[]>()
  const workflowDir = '.github/workflows'
  const labelPattern = /--label[= ]+["']?([A-Za-z0-9][A-Za-z0-9_\-:./ ]*?)["']?(?=\s|\\|$)/g
  for (const entry of readdirSync(workflowDir)) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue
    const body = readFileSync(`${workflowDir}/${entry}`, 'utf-8')
    for (const match of body.matchAll(labelPattern)) {
      const name = (match[1] ?? '').trim()
      if (!name) continue
      const existing = refs.get(name) ?? []
      existing.push(entry)
      refs.set(name, existing)
    }
  }
  return refs
}

describe('ci-tier render parity — label references', () => {
  it('every --label X in workflows has matching entry in labels.yml (hard)', () => {
    const labels = loadLabelNames()
    const refs = collectLabelReferences()
    const missing: Array<{ label: string; files: string[] }> = []
    for (const [label, files] of refs) {
      if (!labels.has(label)) missing.push({ label, files })
    }
    expect(missing).toEqual([])
  })

  it('every entry in labels.yml is referenced by ≥1 workflow (soft — warn only)', () => {
    // Many labels (size, priority, canon/*) are applied by humans via UI/CLI,
    // not by workflows; expecting workflow reference would false-positive. This
    // warns on candidates worth investigating, but never fails the test.
    const labels = loadLabelNames()
    const refs = collectLabelReferences()
    const orphans: string[] = []
    for (const label of labels) {
      if (!refs.has(label)) orphans.push(label)
    }
    if (orphans.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[orphan-labels] ${orphans.length} label(s) defined but not referenced by any workflow:\n  ${orphans.join('\n  ')}`,
      )
    }
    expect(Array.isArray(orphans)).toBe(true)
  })
})
