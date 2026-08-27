import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const comparison = (name: string) =>
  readFileSync(resolve(`website/comparisons/${name}.md`), 'utf-8')

const row = (page: string, capability: string) => {
  const line = page.split('\n').find((candidate) => candidate.startsWith(`| ${capability} `))
  expect(line, `missing ${capability} row`).toBeDefined()
  return line!
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

describe('#2360 comparison claim truth', () => {
  it('states the governed requirements-traceability capability without claiming spec-driven development', () => {
    expect(row(comparison('index'), 'Requirements traceability')).toEqual([
      'Requirements traceability',
      '✓ (INV-112 / CANON-23)',
      'n/r',
      'n/r',
      'n/r',
      'n/r',
      '✓',
    ])
    expect(row(comparison('index'), 'Spec-driven development')).toEqual([
      'Spec-driven development',
      '—',
      '—',
      '—',
      '—',
      '—',
      '✓',
    ])
    expect(row(comparison('spec-kit'), 'Requirements traceability')).toEqual([
      'Requirements traceability',
      '✓ (INV-112 / CANON-23)',
      '✓',
    ])
    expect(row(comparison('spec-kit'), 'Spec-driven requirements')).toEqual([
      'Spec-driven requirements',
      '—',
      '✓',
    ])
    expect(comparison('spec-kit')).toContain('does not yet create a durable specification artifact')
  })

  it('separates configuration emission from cross-model orchestration on every relevant table', () => {
    expect(
      row(comparison('index'), 'Multi-tool configuration emission (Claude Code + Codex)'),
    ).toEqual([
      'Multi-tool configuration emission (Claude Code + Codex)',
      '✓',
      'n/r',
      'n/r',
      'n/r',
      'n/r',
      'n/r',
    ])
    expect(row(comparison('index'), 'Multi-model review / orchestration')).toEqual([
      'Multi-model review / orchestration',
      '—',
      'n/r',
      'n/r',
      'n/r',
      'n/r',
      'n/r',
    ])
    for (const name of ['gsd2', 'claude-flow', 'superclaude']) {
      expect(
        row(comparison(name), 'Multi-tool configuration emission (Claude Code + Codex)'),
      ).toEqual(['Multi-tool configuration emission (Claude Code + Codex)', '✓', 'n/r'])
      expect(row(comparison(name), 'Multi-model review / orchestration')).toEqual([
        'Multi-model review / orchestration',
        '—',
        'n/r',
      ])
      expect(comparison(name)).not.toContain('Multi-tool support (Claude + Codex)')
    }
  })

  it('dates each reviewed comparison page', () => {
    for (const name of ['index', 'spec-kit', 'bmad', 'gsd2', 'claude-flow', 'superclaude']) {
      const page = comparison(name)
      expect(page).toContain("last_review: '2026-08-26'")
      expect(page).toContain('_Last reviewed: 2026-08-26_')
    }
  })

  it('enrols the public comparison corpus in the self-only freshness audit', () => {
    const manifest = readFileSync(resolve('standards/gold-doc-set.yml'), 'utf-8')
    expect(manifest).toContain('path: website/comparisons')
    expect(manifest).toContain("glob: 'website/comparisons/*.md'")
    expect(manifest).toContain('applies: self-charter')
  })
})
