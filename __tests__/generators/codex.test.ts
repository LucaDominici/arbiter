import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateCodex } from '../../src/generators/codex.js'
import { makeConfig } from '../helpers.js'
import { PlanJsonV1 } from '../../src/types/plan.js'
import { runVerifyPlan } from '../../src/commands/verify-plan.js'

describe('generateCodex', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates CODEX.md and rules', () => {
    const result = generateCodex(makeConfig(dir))
    expect(result.files.length).toBeGreaterThanOrEqual(2)
    const codexMd = result.files.find((f) => f.path.endsWith('CODEX.md'))
    expect(codexMd).toBeDefined()
    expect(codexMd!.action).toBe('created')
  })

  it('CODEX.md references AGENTS.md', () => {
    generateCodex(makeConfig(dir))
    const content = readFileSync(join(dir, '.agents', 'CODEX.md'), 'utf-8')
    expect(content).toContain('AGENTS.md')
  })

  it('creates rules directory with expected files', () => {
    generateCodex(makeConfig(dir))
    expect(existsSync(join(dir, '.agents', 'rules', '05-agent-lifecycle.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents', 'rules', '25-todo-folder-policy.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents', 'rules', '90-exec-protocol.md'))).toBe(true)
  })

  it('creates plan directory with README', () => {
    generateCodex(makeConfig(dir))
    expect(existsSync(join(dir, '.agents', 'plan', 'README.md'))).toBe(true)
    const content = readFileSync(join(dir, '.agents', 'plan', 'README.md'), 'utf-8')
    expect(content).toContain('PLAN.json')
  })

  // #1952 — the CODEX.md "Plan Schema" example is a contract: it MUST validate
  // against PlanJsonV1 (the schema `arbiter verify plan` enforces) and reach an
  // APPROVED plan state when run. Prevents the template docs and the parser
  // from drifting apart silently.
  it('CODEX.md Plan Schema example validates against PlanJsonV1 and verifies APPROVED (#1952)', () => {
    generateCodex(makeConfig(dir))
    const content = readFileSync(join(dir, '.agents', 'CODEX.md'), 'utf-8')

    // Extract the JSON block immediately following the "## Plan Schema" heading.
    const schemaIdx = content.indexOf('## Plan Schema')
    expect(schemaIdx, '## Plan Schema section present').toBeGreaterThan(-1)
    const after = content.slice(schemaIdx)
    const jsonStart = after.indexOf('```json')
    const jsonEnd = after.indexOf('```', jsonStart + 7)
    expect(jsonStart, 'a ```json fenced block under Plan Schema').toBeGreaterThan(-1)
    expect(jsonEnd, 'a closing fence for the Plan Schema block').toBeGreaterThan(jsonStart)
    const rawExample = after.slice(after.indexOf('\n', jsonStart) + 1, jsonEnd)

    // `task_id` is documented as the placeholder `#NNN` (an issue number);
    // substitute a real `#<digits>` so it satisfies the `^#\d+$` schema.
    const example = JSON.parse(rawExample.replace(/"#NNN"/g, '"#1"')) as Record<string, unknown>

    const parsed = PlanJsonV1.safeParse(example)
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true)

    // Run the example through `arbiter verify plan` and assert it reaches APPROVED.
    const planFile = join(dir, 'PLAN.json')
    writeFileSync(planFile, JSON.stringify(example, null, 2))
    const result = runVerifyPlan({ file: planFile, dir })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('APPROVED')
  })
})
