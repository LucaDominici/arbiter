// SPDX-License-Identifier: Apache-2.0
//
// Unified task-state document (#1206): writer merge semantics, schema, migration, atomicity.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import {
  readUnifiedState,
  writeUnifiedState,
  readTaskId,
  appendLog,
  seedFromLegacy,
  normalizePhase,
  isTddPhase,
  statusPath,
  taskStateDir,
} from '../../src/commands/task-state.js'

describe('unified task-state document (#1206)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  describe('readUnifiedState', () => {
    it('returns null for a fresh tree (no document, no legacy)', () => {
      expect(readUnifiedState(dir)).toBeNull()
    })

    it('throws on a corrupted status.json', () => {
      mkdirSync(taskStateDir(dir), { recursive: true })
      writeFileSync(statusPath(dir), '{ not json', 'utf-8')
      expect(() => readUnifiedState(dir)).toThrow(/corrupted status/i)
    })
  })

  describe('writeUnifiedState', () => {
    it('writes status.json at the fixed path with a complete schema', () => {
      writeUnifiedState(dir, { taskId: '#1', phase: 'plan' })
      const s = JSON.parse(readFileSync(statusPath(dir), 'utf-8'))
      expect(s.phase).toBe('plan')
      expect(s.taskId).toBe('#1')
      expect(s.cursor).toEqual({ tddPhase: null, lastAction: '', nextAction: '' })
      expect(typeof s.runId).toBe('string')
      expect(s.timestamps).toHaveProperty('plan')
      expect(Array.isArray(s.gateDecisions)).toBe(true)
    })

    it('merges ALL prior fields — a later phase write never clobbers cursor/branch/cost', () => {
      writeUnifiedState(dir, {
        taskId: '#1',
        phase: 'red',
        branch: 'task/#1',
        tier: 'Standard',
      })
      writeUnifiedState(dir, { cursor: { nextAction: 'implement X in src/a.ts' } })
      // advance phase — must preserve everything above
      const after = writeUnifiedState(dir, { phase: 'green' })
      expect(after.phase).toBe('green')
      expect(after.taskId).toBe('#1')
      expect(after.branch).toBe('task/#1')
      expect(after.tier).toBe('Standard')
      expect(after.cursor.nextAction).toBe('implement X in src/a.ts')
    })

    it('shallow-merges cursor partials without dropping untouched cursor keys', () => {
      writeUnifiedState(dir, { cursor: { nextAction: 'do A', lastAction: 'did B' } })
      writeUnifiedState(dir, { cursor: { tddPhase: 'GREEN' } })
      const s = readUnifiedState(dir)
      expect(s?.cursor).toEqual({ tddPhase: 'GREEN', lastAction: 'did B', nextAction: 'do A' })
    })

    it('accumulates per-phase timestamps across advances', () => {
      writeUnifiedState(dir, { phase: 'plan' })
      writeUnifiedState(dir, { phase: 'red-team-review' })
      const s = readUnifiedState(dir)
      expect(s?.timestamps).toHaveProperty('plan')
      expect(s?.timestamps).toHaveProperty('red-team-review')
    })

    it('leaves no temp file behind (atomic write)', () => {
      writeUnifiedState(dir, { phase: 'plan' })
      const leftovers = readdirSync(taskStateDir(dir)).filter((f: string) => f.includes('.tmp'))
      expect(leftovers).toEqual([])
    })

    it('AC-7 resets task-owned state atomically when the normalized task id changes', () => {
      writeUnifiedState(dir, {
        taskId: '#2120',
        phase: 'complete',
        tier: 'Standard',
        plan: '.claude/plans/old.md',
        branch: 'tmp-red',
        cursor: { tddPhase: 'REFACTOR', lastAction: 'old', nextAction: 'stale' },
        handoffStrategy: 'interactive',
        handoffReady: true,
        planningHandoffReady: '2026-07-01T00:00:00.000Z',
        redTeamFindings: [
          {
            id: 'RT-OLD',
            severity: 'HIGH',
            summary: 'old finding',
            auditorHint: 'bugs',
            resolved: false,
          },
        ],
        overrides: { 'automation.autonomy': 'L1' },
      })

      const next = writeUnifiedState(dir, {
        taskId: '#2135',
        tier: 'S',
        branch: 'task/#2135-release-bar',
        overrides: { 'automation.autonomy': 'L3' },
      })

      expect(next).toMatchObject({
        taskId: '#2135',
        phase: 'preflight',
        tier: 'S',
        plan: '',
        branch: 'task/#2135-release-bar',
        cursor: { tddPhase: null, lastAction: '', nextAction: '' },
        handoffStrategy: null,
        handoffReady: false,
        overrides: { 'automation.autonomy': 'L3' },
      })
      expect(next.timestamps).toEqual({})
      expect(next.gateDecisions).toEqual([])
      expect(next.redTeamFindings).toBeUndefined()
      expect(next.planningHandoffReady).toBeUndefined()
    })

    it('AC-7 preserves incremental fields when the task id is unchanged', () => {
      writeUnifiedState(dir, {
        taskId: '#2135',
        phase: 'red',
        plan: '.claude/plans/2135.md',
        branch: 'task/#2135-release-bar',
      })
      const next = writeUnifiedState(dir, { taskId: '#2135', tier: 'Standard' })
      expect(next.phase).toBe('red')
      expect(next.plan).toBe('.claude/plans/2135.md')
      expect(next.branch).toBe('task/#2135-release-bar')
    })

    // #2533: status.json is internal task-engine state written by tooling, never a
    // generator-emitted target a downstream repo would hand-customise — it must
    // never be subject to `writeFile`'s `arbiter:preserve` withholding (src/utils/
    // fs.ts #1980), or every `task advance`/`record-red` after a marker-quoting
    // write would silently stop persisting while still reporting success.
    it('rewrites status.json even when its on-disk content quotes the arbiter:preserve marker (#2533)', () => {
      mkdirSync(taskStateDir(dir), { recursive: true })
      writeFileSync(
        statusPath(dir),
        JSON.stringify({ taskId: '#1', note: 'quotes <!-- arbiter:preserve -->' }),
        'utf-8',
      )
      writeUnifiedState(dir, { taskId: '#1', phase: 'plan' })
      const s = JSON.parse(readFileSync(statusPath(dir), 'utf-8'))
      expect(s.phase).toBe('plan')
    })
  })

  describe('readTaskId / appendLog', () => {
    it('readTaskId returns the active id, undefined when empty', () => {
      expect(readTaskId(dir)).toBeUndefined()
      writeUnifiedState(dir, { taskId: '#42' })
      expect(readTaskId(dir)).toBe('#42')
    })

    it('appendLog appends timestamped lines to log.md', () => {
      appendLog(dir, 'first')
      appendLog(dir, 'second')
      const log = readFileSync(join(taskStateDir(dir), 'log.md'), 'utf-8')
      expect(log).toMatch(/- \d{4}-\d{2}-\d{2}T.* first/)
      expect(log).toContain('second')
    })
  })

  describe('normalizePhase', () => {
    it('migrates the legacy implementation alias to red', () => {
      expect(normalizePhase('implementation')).toBe('red')
    })
    it('defaults empty/undefined to preflight', () => {
      expect(normalizePhase(undefined)).toBe('preflight')
      expect(normalizePhase('')).toBe('preflight')
    })
    it('throws on an unrecognized phase', () => {
      expect(() => normalizePhase('bogus')).toThrow(/corrupted phase/i)
    })
  })

  describe('isTddPhase', () => {
    it('accepts the three valid TDD sub-phases', () => {
      expect(isTddPhase('RED')).toBe(true)
      expect(isTddPhase('GREEN')).toBe(true)
      expect(isTddPhase('REFACTOR')).toBe(true)
    })
    it('rejects anything else', () => {
      expect(isTddPhase('red')).toBe(false)
      expect(isTddPhase('bogus')).toBe(false)
      expect(isTddPhase('')).toBe(false)
    })
  })

  describe('seedFromLegacy (migration)', () => {
    const writeDot = (name: string, val: string) =>
      writeFileSync(join(dir, '.claude', name), `${val}\n`, 'utf-8')

    it('returns null when there is no legacy state', () => {
      expect(seedFromLegacy(dir)).toBeNull()
    })

    it('seeds the unified doc from flat dotfiles and deletes them', () => {
      writeDot('.task-id', '#7')
      writeDot('.task-phase', 'green')
      writeDot('.task-tier', 'Standard')
      writeDot('.task-plan', '.claude/plans/task-7.md')
      const seeded = seedFromLegacy(dir)
      expect(seeded?.taskId).toBe('#7')
      expect(seeded?.phase).toBe('green')
      expect(seeded?.tier).toBe('Standard')
      expect(seeded?.plan).toBe('.claude/plans/task-7.md')
      // legacy removed, unified written
      expect(existsSync(join(dir, '.claude', '.task-phase'))).toBe(false)
      expect(existsSync(join(dir, '.claude', '.task-id'))).toBe(false)
      expect(existsSync(statusPath(dir))).toBe(true)
    })

    it('merges rich per-id status.json metadata (not orphaned) and removes the per-id dir', () => {
      writeDot('.task-id', '#7')
      writeDot('.task-phase', 'red')
      const perId = join(dir, '.claude', '.task-_7')
      mkdirSync(perId, { recursive: true })
      writeFileSync(
        join(perId, 'status.json'),
        JSON.stringify({
          handoffStrategy: 'interactive',
          planningHandoffReady: '2026-06-04T10:00:00.000Z',
        }),
        'utf-8',
      )
      const seeded = seedFromLegacy(dir)
      expect(seeded?.handoffStrategy).toBe('interactive')
      expect(seeded?.planningHandoffReady).toBe('2026-06-04T10:00:00.000Z')
      expect(existsSync(perId)).toBe(false)
    })

    it('preserves a corrupt per-id rich file instead of deleting it', () => {
      writeDot('.task-id', '#7')
      writeDot('.task-phase', 'red')
      const perId = join(dir, '.claude', '.task-_7')
      mkdirSync(perId, { recursive: true })
      writeFileSync(join(perId, 'status.json'), '{ corrupt', 'utf-8')
      const seeded = seedFromLegacy(dir)
      expect(seeded?.phase).toBe('red') // flat dotfiles still migrate
      expect(existsSync(perId)).toBe(true) // corrupt rich file preserved for recovery
    })

    it('sets handoffReady when the legacy marker is present', () => {
      writeDot('.task-id', '#7')
      writeDot('.task-phase', 'red-team-review')
      writeFileSync(join(dir, '.claude', '.task-handoff-ready'), '', 'utf-8')
      expect(seedFromLegacy(dir)?.handoffReady).toBe(true)
    })

    it('migrates the legacy implementation phase during seeding', () => {
      writeDot('.task-id', '#7')
      writeDot('.task-phase', 'implementation')
      expect(seedFromLegacy(dir)?.phase).toBe('red')
    })

    it('triggers transparently on the first read', () => {
      writeDot('.task-id', '#7')
      writeDot('.task-phase', 'plan')
      expect(readUnifiedState(dir)?.phase).toBe('plan')
      expect(existsSync(statusPath(dir))).toBe(true)
    })
  })

  describe('redTeamFindings forward-link (#1212)', () => {
    it('round-trips RT findings through write/read', () => {
      writeUnifiedState(dir, {
        taskId: '#1212',
        redTeamFindings: [
          {
            id: 'RT-01',
            severity: 'HIGH',
            summary: 'unchecked input',
            auditorHint: 'security',
            resolved: false,
          },
          {
            id: 'RT-02',
            severity: 'MEDIUM',
            summary: 'race',
            auditorHint: 'data-integrity',
            resolved: true,
          },
        ],
      })
      const state = readUnifiedState(dir)
      expect(state?.redTeamFindings).toHaveLength(2)
      expect(state?.redTeamFindings?.[0]).toMatchObject({
        id: 'RT-01',
        auditorHint: 'security',
        resolved: false,
      })
      expect(state?.redTeamFindings?.[1].resolved).toBe(true)
    })

    it('replaces the findings array wholesale on a subsequent patch', () => {
      writeUnifiedState(dir, {
        redTeamFindings: [
          { id: 'RT-01', severity: 'HIGH', summary: 'a', auditorHint: 'bugs', resolved: false },
        ],
      })
      // Mark RT-01 resolved by rewriting the full array (the agent's resolve flow).
      writeUnifiedState(dir, {
        redTeamFindings: [
          { id: 'RT-01', severity: 'HIGH', summary: 'a', auditorHint: 'bugs', resolved: true },
        ],
      })
      const state = readUnifiedState(dir)
      expect(state?.redTeamFindings).toHaveLength(1)
      expect(state?.redTeamFindings?.[0].resolved).toBe(true)
    })

    it('is absent on a state written without findings', () => {
      writeUnifiedState(dir, { taskId: '#1212', phase: 'plan' })
      expect(readUnifiedState(dir)?.redTeamFindings).toBeUndefined()
    })
  })
})
