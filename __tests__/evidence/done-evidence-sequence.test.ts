// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeGatePassEvidence } from '../helpers.js'

const sourceProducer = join(process.cwd(), 'scripts', 'done-evidence.mjs')

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-done-sequence-'))
  execFileSync('git', ['init', '-q', '-b', 'task/#2615-receipt'], { cwd: dir })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
  copyFileSync(sourceProducer, join(dir, 'scripts', 'done-evidence.mjs'))
  copyFileSync(
    join(process.cwd(), 'scripts', 'lib', 'gate-evidence.mjs'),
    join(dir, 'scripts', 'lib', 'gate-evidence.mjs'),
  )
  copyFileSync(
    join(process.cwd(), 'scripts', 'lib', 'run-helpers.mjs'),
    join(dir, 'scripts', 'lib', 'run-helpers.mjs'),
  )
  writeFileSync(
    join(dir, 'scripts', 'check-all.mjs'),
    "#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs'; appendFileSync('gate-count', '1');\n",
  )
  writeFileSync(join(dir, 'src', 'main.ts'), 'export const answer = 42\n')
  writeFileSync(join(dir, '.claude', '.task', 'status.json'), JSON.stringify({ taskId: '#2615' }))
  mkdirSync(join(dir, '.arbiter', 'evidence', 'done'), { recursive: true })
  writeFileSync(
    join(dir, '.arbiter', 'evidence', 'done', '_2615.json'),
    JSON.stringify({ version: 2, task_id: '#2615', state: 'passed' }),
  )
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'fixture', '--no-gpg-sign'], { cwd: dir })
  return dir
}

describe('#2615 done-evidence capture sequence', () => {
  it('AC-5: invalid config invalidates a prior PASS before it can run a gate', () => {
    const dir = setup()
    try {
      writeFileSync(join(dir, 'evidence-files.json'), '{ invalid json')
      const result = spawnSync('node', ['scripts/done-evidence.mjs'], {
        cwd: dir,
        encoding: 'utf8',
      })

      expect(result.status).toBe(1)
      expect(existsSync(join(dir, 'gate-count'))).toBe(false)
      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'evidence', 'done', '_2615.json'), 'utf8')),
      ).toMatchObject({ version: 2, task_id: '#2615', state: 'failed' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-6: a passed receipt binds the exact gate-marker bytes', async () => {
    const dir = setup()
    try {
      writeGatePassEvidence(dir, { taskId: '#2615', level: 'L3' })
      const marker = readFileSync(join(dir, '.arbiter', 'gate-pass.json'), 'utf8')
      const result = spawnSync('node', ['scripts/done-evidence.mjs'], {
        cwd: dir,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'evidence', 'done', '_2615.json'), 'utf8')),
      ).toMatchObject({
        version: 2,
        task_id: '#2615',
        state: 'passed',
        gate_marker_sha256: createHash('sha256').update(marker).digest('hex'),
      })
      const { verifyDoneEvidenceReceipt } = await import('../../scripts/lib/gate-evidence.mjs')
      expect(verifyDoneEvidenceReceipt({ root: dir, taskId: '#2615' })).toEqual({ ok: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-4: reuses a valid L3 marker without a second gate', () => {
    const dir = setup()
    try {
      writeGatePassEvidence(dir, { taskId: '#2615', level: 'L3' })
      const result = spawnSync('node', ['scripts/done-evidence.mjs'], {
        cwd: dir,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(existsSync(join(dir, 'gate-count'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
