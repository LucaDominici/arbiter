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
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sourceProducer = join(process.cwd(), 'scripts', 'done-evidence.mjs')

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-done-sequence-'))
  execFileSync('git', ['init', '-q', '-b', 'task/#2615-receipt'], { cwd: dir })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
  copyFileSync(sourceProducer, join(dir, 'scripts', 'done-evidence.mjs'))
  writeFileSync(
    join(dir, 'scripts', 'check-all.mjs'),
    "#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs'; appendFileSync('gate-count', '1');\n",
  )
  writeFileSync(
    join(dir, '.claude', '.task', 'status.json'),
    JSON.stringify({ taskId: '#2615' }),
  )
  mkdirSync(join(dir, '.arbiter', 'evidence', 'done'), { recursive: true })
  writeFileSync(
    join(dir, '.arbiter', 'evidence', 'done', '_2615.json'),
    JSON.stringify({ version: 2, task_id: '#2615', state: 'passed' }),
  )
  return dir
}

describe('#2615 done-evidence capture sequence', () => {
  it('AC-5: invalid config invalidates a prior PASS before it can run a gate', () => {
    const dir = setup()
    try {
      writeFileSync(join(dir, 'evidence-files.json'), '{ invalid json')
      const result = spawnSync('node', ['scripts/done-evidence.mjs'], { cwd: dir, encoding: 'utf8' })

      expect(result.status).toBe(1)
      expect(existsSync(join(dir, 'gate-count'))).toBe(false)
      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'evidence', 'done', '_2615.json'), 'utf8')),
      ).toMatchObject({ version: 2, task_id: '#2615', state: 'failed' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
