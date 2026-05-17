// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'check-stride-traceability.mjs')

function setup(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'stride-traceability-'))
  mkdirSync(join(dir, 'docs', 'SECURITY'), { recursive: true })
  mkdirSync(join(dir, 'docs', 'GOVERNANCE'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function runScript(dir: string): { status: number; out: string } {
  const r = spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf-8' })
  return { status: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

const EMPTY_STRIDE = `# STRIDE

| ID | Threat | Category | Severity | Mitigation | Status |
| -- | ------ | -------- | -------- | ---------- | ------ |
`

const EMPTY_RACI = `# RACI

| ID | Responsibility | Accountable | Responsible | Consulted | Informed | Priority |
| -- | -------------- | ----------- | ----------- | --------- | -------- | -------- |
`

describe('check-stride-traceability — empty-register guard (#631)', () => {
  it('FAILS when both STRIDE and RACI registers have zero HIGH/CRITICAL rows', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(join(dir, 'docs/SECURITY/STRIDE.md'), EMPTY_STRIDE)
      writeFileSync(join(dir, 'docs/GOVERNANCE/RACI.md'), EMPTY_RACI)
      const r = runScript(dir)
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/empty|no HIGH\/CRITICAL/i)
    } finally {
      cleanup()
    }
  })

  it('PASSES when STRIDE has ≥1 HIGH row with matching @Security tag', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(
        join(dir, 'docs/SECURITY/STRIDE.md'),
        `# STRIDE
| ID | Threat | Category | Severity | Mitigation | Status |
| -- | ------ | -------- | -------- | ---------- | ------ |
| S001 | test threat | Spoofing | HIGH | mitigate | OPEN |
`,
      )
      writeFileSync(join(dir, 'docs/GOVERNANCE/RACI.md'), EMPTY_RACI)
      writeFileSync(join(dir, 'src/seed.ts'), '// @Security:S001\nexport const x = 1\n')
      const r = runScript(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('FAILS when HIGH row lacks matching tag', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(
        join(dir, 'docs/SECURITY/STRIDE.md'),
        `# STRIDE
| ID | Threat | Category | Severity | Mitigation | Status |
| -- | ------ | -------- | -------- | ---------- | ------ |
| S999 | unverified | Tampering | CRITICAL | none | OPEN |
`,
      )
      writeFileSync(join(dir, 'docs/GOVERNANCE/RACI.md'), EMPTY_RACI)
      const r = runScript(dir)
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/S999/)
    } finally {
      cleanup()
    }
  })
})
