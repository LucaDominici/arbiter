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
  symlinkSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeConfig, writeGatePassEvidence } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'

const sourceProducer = join(process.cwd(), 'scripts', 'done-evidence.mjs')

function setup({
  rendered = false,
  archetype = 'library',
}: { rendered?: boolean; archetype?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-done-sequence-'))
  execFileSync('git', ['init', '-q', '-b', 'task/#2615-receipt'], { cwd: dir })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
  if (rendered)
    writeFileSync(
      join(dir, 'scripts', 'done-evidence.mjs'),
      renderTemplate('scripts/done-evidence.mjs.ejs', makeConfig(dir, { archetype })),
    )
  else copyFileSync(sourceProducer, join(dir, 'scripts', 'done-evidence.mjs'))
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
    "#!/usr/bin/env node\nimport { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'; import { buildGateEvidence, captureGateStart } from './lib/gate-evidence.mjs'; appendFileSync('gate-count', '1'); appendFileSync('gate-argv', JSON.stringify(process.argv.slice(2))); const marker = buildGateEvidence({ root: process.cwd(), level: 'L3', taskId: '#2615', start: captureGateStart(process.cwd()) }); mkdirSync('.arbiter', { recursive: true }); writeFileSync('.arbiter/gate-pass.json', JSON.stringify(marker));\n",
  )
  writeFileSync(join(dir, 'src', 'main.ts'), 'export const answer = 42\n')
  writeFileSync(join(dir, '.gitignore'), 'gate-count\ngate-argv\nruntime-argv\n.arbiter\n')
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
  it.each([false, true])(
    'AC-5: rejects corrupt task identity before any gate for %s producer',
    async (rendered) => {
      const dir = setup({ rendered })
      try {
        writeGatePassEvidence(dir, { taskId: '#2615', level: 'L3' })
        const statusPath = join(dir, '.claude', '.task', 'status.json')
        const originalStatus = readFileSync(statusPath)
        expect(spawnSync('node', ['scripts/done-evidence.mjs'], { cwd: dir }).status).toBe(0)
        writeFileSync(join(dir, '.claude', '.task', 'status.json'), '{ broken')
        const result = spawnSync('node', ['scripts/done-evidence.mjs'], {
          cwd: dir,
          encoding: 'utf8',
        })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('could not read task identity')
        expect(existsSync(join(dir, 'gate-count'))).toBe(false)
        writeFileSync(statusPath, originalStatus)
        const { verifyDoneEvidenceReceipt } = await import('../../scripts/lib/gate-evidence.mjs')
        expect(verifyDoneEvidenceReceipt({ root: dir, taskId: '#2615' }).ok).toBe(false)
        const engine = await import('../../src/evidence/gate-binding.js')
        expect(engine.verifyDoneEvidenceReceipt({ root: dir, taskId: '#2615' }).ok).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

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

  it.each([false, true])('AC-5: keeps invalid config at zero gates for %s producer', (rendered) => {
    const dir = setup({ rendered })
    try {
      writeFileSync(join(dir, 'evidence-files.json'), JSON.stringify(null))
      const result = spawnSync('node', ['scripts/done-evidence.mjs'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(result.status).toBe(1)
      expect(existsSync(join(dir, 'gate-count'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    null,
    [],
    'bad',
    { version: 2 },
    { pin_dirs: 'src' },
    { pin_dirs: ['../outside'] },
    { pin_extensions: ['ts'] },
    { exclude_dirs: [1] },
    { reality_contact: null },
    { reality_contact: { required: 'true' } },
    { reality_contact: { required: true, suite: 'unknown', command: 'node ok' } },
  ])('AC-5: rejects malformed parseable config before any gate: %j', (config) => {
    const dir = setup()
    try {
      writeFileSync(join(dir, 'evidence-files.json'), JSON.stringify(config))
      const result = spawnSync('node', ['scripts/done-evidence.mjs'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(result.status).toBe(1)
      expect(existsSync(join(dir, 'gate-count'))).toBe(false)
      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'evidence', 'done', '_2615.json'), 'utf8')),
      ).toMatchObject({ state: 'failed' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([false, true])('AC-4: rejects a symlinked pin directory for %s producer', (rendered) => {
    const dir = setup({ rendered })
    try {
      const outside = mkdtempSync(join(tmpdir(), 'arbiter-external-'))
      writeFileSync(join(outside, 'outside.ts'), 'export const outside = true\n')
      symlinkSync(outside, join(dir, 'src', 'linked'))
      writeFileSync(
        join(dir, 'evidence-files.json'),
        JSON.stringify({ pin_dirs: ['src'], pin_extensions: ['.ts'], exclude_dirs: [] }),
      )
      writeGatePassEvidence(dir, { taskId: '#2615', level: 'L3' })
      const result = spawnSync('node', ['scripts/done-evidence.mjs'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(result.status).toBe(1)
      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'evidence', 'done', '_2615.json'), 'utf8')),
      ).toMatchObject({ state: 'failed' })
      rmSync(outside, { recursive: true, force: true })
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

  it.each([
    ['self', false, 'absent'],
    ['self', false, 'expired'],
    ['self', false, 'L2'],
    ['rendered library', true, 'absent'],
    ['rendered library', true, 'expired'],
    ['rendered library', true, 'L2'],
  ])(
    'AC-4: runs exactly one L3 for %s producer (rendered=%s) with %s marker',
    (_name, rendered, state) => {
      const dir = setup({ rendered })
      try {
        if (state === 'L2') writeGatePassEvidence(dir, { taskId: '#2615', level: 'L2' })
        if (state === 'expired')
          writeGatePassEvidence(dir, {
            taskId: '#2615',
            level: 'L3',
            overrides: { timestamp: '2000-01-01T00:00:00.000Z' },
          })
        const result = spawnSync('node', ['scripts/done-evidence.mjs'], {
          cwd: dir,
          encoding: 'utf8',
        })
        expect(result.status, `stdout=${result.stdout} stderr=${result.stderr}`).toBe(0)
        expect(readFileSync(join(dir, 'gate-count'), 'utf8')).toBe('1')
        expect(readFileSync(join(dir, 'gate-argv'), 'utf8').trim()).toBe('["L3"]')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it('AC-5: records failed without another gate when frontend runtime evidence fails', () => {
    const dir = setup()
    try {
      writeFileSync(
        join(dir, 'evidence-files.json'),
        JSON.stringify({
          pin_dirs: ['src'],
          pin_extensions: ['.ts'],
          exclude_dirs: [],
          reality_contact: {
            archetype: 'frontend-spa',
            required: true,
            suite: 'render-smoke',
            command: 'node missing-runtime.mjs',
          },
        }),
      )
      execFileSync('git', ['add', '-A'], { cwd: dir })
      execFileSync('git', ['commit', '-qm', 'runtime config', '--no-gpg-sign'], { cwd: dir })
      writeGatePassEvidence(dir, { taskId: '#2615', level: 'L3' })
      const result = spawnSync('node', ['scripts/done-evidence.mjs'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(result.status).toBe(1)
      expect(existsSync(join(dir, 'gate-count'))).toBe(false)
      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'evidence', 'done', '_2615.json'), 'utf8')),
      ).toMatchObject({ state: 'failed' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-5: executes rendered frontend default runtime argv without shell splitting', () => {
    const dir = setup({ rendered: true, archetype: 'frontend-spa' })
    try {
      writeFileSync(
        join(dir, 'scripts', 'lib', 'ephemeral-server.mjs'),
        "import { writeFileSync } from 'node:fs'; writeFileSync('runtime-argv', JSON.stringify(process.argv.slice(2)));\n",
      )
      execFileSync('git', ['add', '-A'], { cwd: dir })
      execFileSync('git', ['commit', '-qm', 'frontend runtime stub', '--no-gpg-sign'], { cwd: dir })
      const result = spawnSync('node', ['scripts/done-evidence.mjs'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(result.status, `stdout=${result.stdout} stderr=${result.stderr}`).toBe(0)
      expect(JSON.parse(readFileSync(join(dir, 'runtime-argv'), 'utf8'))).toEqual([
        '--start',
        'npm run start:test',
        '--test',
        'npx playwright test tests/e2e/render-smoke.spec.ts',
        '--port',
        '4173',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([false, true])('AC-4: reuses valid L3 at zero gates for %s producer', (rendered) => {
    const dir = setup({ rendered })
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
