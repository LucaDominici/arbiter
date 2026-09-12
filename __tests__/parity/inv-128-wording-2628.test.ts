// SPDX-License-Identifier: Apache-2.0
// #2628 slice 3: governance prose that describes generated artifacts must describe what ships.
// Two staleness classes found by the workflow inventory (evidence/arbiter-2628):
//   1. AGENTS.md INV-128 still described `scripts/conformance.mjs` as delegating to a retired
//      CLI command ("Known gap … nothing to delegate to", exit 1=FAIL), while the emitted
//      template has pointed at `gold-audit` with exit codes 0/2 for some time.
//   2. `generator-matrix.yml` named sibling workflows (`kit-self-canary.yml`,
//      `probe-writer-audit.yml`) that do not exist.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

function inv128Entry(): string {
  const lines = readFileSync(join(root, 'AGENTS.md'), 'utf-8').split('\n')
  const start = lines.findIndex((l) => /^- \*\*INV-128:\*\*/.test(l))
  expect(start, 'AGENTS.md has an INV-128 entry').toBeGreaterThan(-1)
  let end = start + 1
  while (end < lines.length && !/^- \*\*INV-\d+:\*\*/.test(lines[end])) end++
  return lines.slice(start, end).join('\n')
}

describe('#2628 — INV-128 prose matches the shipped conformance runner', () => {
  const template = readFileSync(join(root, 'src/templates/scripts/conformance.mjs.ejs'), 'utf-8')
  const templateExitLine = template.match(/^\/\/ Exit codes \(INV-53\): (.+)$/m)?.[1] ?? ''

  it('the template header states its exit codes (the source of truth for the prose)', () => {
    expect(templateExitLine).toMatch(/0=/)
    expect(template).toMatch(/gold-audit/)
  })

  it('AGENTS.md INV-128 does not describe the retired delegation as a live gap', () => {
    const entry = inv128Entry()
    expect(entry).not.toMatch(/Known gap/)
    expect(entry).not.toMatch(/nothing to delegate to/)
    expect(entry).toMatch(/gold-audit/)
  })

  it('AGENTS.md INV-128 states the same exit codes as the template header', () => {
    expect(inv128Entry()).toContain(templateExitLine)
  })

  it('AGENTS.md INV-128 states the real skipIfExists of the generator', () => {
    const gen = readFileSync(join(root, 'src/generators/conformance.ts'), 'utf-8')
    const real = gen.match(/skipIfExists:\s*(true|false)/)?.[1]
    expect(real).toBeDefined()
    expect(inv128Entry()).toContain(`skipIfExists:${real}`)
  })
})

describe('#2628 — hand-authored workflows only name siblings that exist', () => {
  const wfDir = join(root, '.github/workflows')
  const handAuthored = readdirSync(wfDir).filter(
    (f) =>
      f.endsWith('.yml') && !existsSync(join(root, 'src/templates/github/workflows', `${f}.ejs`)),
  )

  it('there is at least one hand-authored workflow (non-vacuous)', () => {
    expect(handAuthored.length).toBeGreaterThan(0)
  })

  it.each(handAuthored)('%s names only existing workflow files in its comments', (file) => {
    const comments = readFileSync(join(wfDir, file), 'utf-8')
      .split('\n')
      .filter((l) => /^\s*#/.test(l))
      .join('\n')
    const named = [...comments.matchAll(/`([\w.-]+\.yml)`/g)].map((m) => m[1])
    for (const name of named) {
      expect(existsSync(join(wfDir, name)), `${file} names ${name}, which does not exist`).toBe(
        true,
      )
    }
  })
})
