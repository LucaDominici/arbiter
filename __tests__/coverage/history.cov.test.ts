// SPDX-License-Identifier: Apache-2.0
/**
 * Coverage test for src/graph/history.ts — drives the git-log harvesting path
 * (#1483 coverage ratchet).
 *
 * The existing __tests__/graph/history.test.ts covers the pure functions
 * parseHistoryEvents + filterEventsForNode with hand-built fixtures. This file
 * complements it by exercising the previously-uncovered git-backed path:
 * harvestHistoryForNode → runGitLog → parseGitLogOutput, across FILE: vs
 * non-FILE nodes, maxEntries scoping, Notary footer extraction from real commit
 * bodies, and the error/empty branches. It builds a real throwaway git repo in
 * the OS tmpdir so no source or config is mocked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../../src/utils/run-cli.js'
import {
  parseHistoryEvents,
  filterEventsForNode,
  harvestHistoryForNode,
  type GitLogEntry,
  type HistoryEvent,
} from '../../src/graph/history.js'

// ── Real git fixture helpers ───────────────────────────────────────────────

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Arbiter Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Arbiter Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  // Deterministic timestamps so ascending-sort assertions are stable.
  GIT_AUTHOR_DATE: '2024-11-03T10:00:00+00:00',
  GIT_COMMITTER_DATE: '2024-11-03T10:00:00+00:00',
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV): void {
  runCli('git', args, { cwd, env, timeoutMs: 15_000 })
}

interface CommitSpec {
  file: string
  content: string
  subject: string
  body?: string
  /** ISO-8601 date used for both author + committer of this commit. */
  date: string
}

/**
 * Build a real git repository in a fresh tmpdir and apply the given commits in
 * order. Returns the repo path; caller cleans up via the returned cleanup fn.
 */
function makeRepo(commits: CommitSpec[]): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-history-cov-'))
  git(dir, ['init', '-q', '-b', 'main'])
  // Local identity so commits succeed even without a global git config.
  git(dir, ['config', 'user.name', 'Arbiter Test'])
  git(dir, ['config', 'user.email', 'test@example.com'])

  for (const c of commits) {
    const filePath = join(dir, c.file)
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, c.content)
    git(dir, ['add', '--', c.file])
    const message = c.body !== undefined ? `${c.subject}\n\n${c.body}` : c.subject
    const env: NodeJS.ProcessEnv = {
      ...GIT_ENV,
      GIT_AUTHOR_DATE: c.date,
      GIT_COMMITTER_DATE: c.date,
    }
    git(dir, ['commit', '-q', '-m', message], env)
  }

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const NOTARY_BODY = [
  'Notary:',
  '- Delta: src/invariants/catalog.ts §Complexity (modify, +5 -0)',
  '- Intent: adds INV-05 enforcement [per INV-05]',
  '- Patch: src/invariants/catalog.ts (update)',
].join('\n')

// ── harvestHistoryForNode: git-backed path ─────────────────────────────────

describe('harvestHistoryForNode — git-backed harvesting (#1483)', () => {
  let repo: { dir: string; cleanup: () => void }

  beforeEach(() => {
    repo = makeRepo([
      {
        file: 'src/invariants/catalog.ts',
        content: 'export const a = 1\n',
        subject: 'feat(#001): add INV-05 cyclomatic complexity invariant',
        date: '2024-11-03T10:00:00+00:00',
      },
      {
        file: 'src/invariants/catalog.ts',
        content: 'export const a = 1\nexport const b = 2\n',
        subject: 'feat(#002): enforce with ESLint rule',
        body: NOTARY_BODY,
        date: '2024-11-15T14:30:00+00:00',
      },
      {
        file: 'package.json',
        content: '{}\n',
        subject: 'chore: update dependencies',
        date: '2024-12-01T09:00:00+00:00',
      },
    ])
  })

  afterEach(() => repo.cleanup())

  it('filters non-FILE nodes by id appearing in subject across the full log', () => {
    const events = harvestHistoryForNode({ nodeId: 'INV-05', gitDir: repo.dir })
    // Both INV-05 commits match (first via subject, second via notaryIntent);
    // the chore commit does not mention INV-05.
    const subjects = events.map((e) => e.subject)
    expect(events.length).toBe(2)
    expect(subjects.some((s) => s.includes('add INV-05'))).toBe(true)
    expect(subjects.every((s) => !s.includes('update dependencies'))).toBe(true)
  })

  it('parses the Notary Intent footer out of a real commit body', () => {
    const events = harvestHistoryForNode({ nodeId: 'INV-05', gitDir: repo.dir })
    const withIntent = events.find((e) => e.notaryIntent !== undefined)
    expect(withIntent).toBeDefined()
    expect(withIntent?.notaryIntent).toBe('adds INV-05 enforcement [per INV-05]')
  })

  it('returns events sorted ascending by timestamp', () => {
    const events = harvestHistoryForNode({ nodeId: 'INV-05', gitDir: repo.dir })
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]
      const curr = events[i]
      if (prev === undefined || curr === undefined) continue
      expect(prev.ts <= curr.ts).toBe(true)
    }
  })

  it('returns no events for a node id that appears nowhere', () => {
    const events = harvestHistoryForNode({ nodeId: 'INV-99', gitDir: repo.dir })
    expect(events).toHaveLength(0)
  })

  it('scopes the log to the pathspec for FILE: nodes and returns every entry', () => {
    const events = harvestHistoryForNode({
      nodeId: 'FILE:src/invariants/catalog.ts',
      gitDir: repo.dir,
    })
    // Two commits touched the file; the package.json commit must be excluded by
    // the pathspec-scoped log, and all returned entries are kept (FILE branch).
    expect(events.length).toBe(2)
    expect(events.every((e) => typeof e.sha === 'string' && e.sha.length > 0)).toBe(true)
  })

  it('returns empty for a FILE: node whose path was never committed', () => {
    const events = harvestHistoryForNode({
      nodeId: 'FILE:does/not/exist.ts',
      gitDir: repo.dir,
    })
    expect(events).toHaveLength(0)
  })

  it('honours maxEntries to cap the number of harvested commits', () => {
    const events = harvestHistoryForNode({
      nodeId: 'FILE:src/invariants/catalog.ts',
      gitDir: repo.dir,
      maxEntries: 1,
    })
    expect(events).toHaveLength(1)
  })

  it('returns an empty array when the directory is not a git repository', () => {
    const nonRepo = mkdtempSync(join(tmpdir(), 'arbiter-history-norepo-'))
    try {
      const events = harvestHistoryForNode({ nodeId: 'INV-05', gitDir: nonRepo })
      expect(events).toEqual([])
    } finally {
      rmSync(nonRepo, { recursive: true, force: true })
    }
  })

  it('returns an empty array when the git directory does not exist', () => {
    const events = harvestHistoryForNode({
      nodeId: 'INV-05',
      gitDir: join(tmpdir(), 'arbiter-history-absent-dir-xyz'),
    })
    expect(events).toEqual([])
  })
})

// ── Pure-function branches not covered by the existing graph test ──────────

describe('parseHistoryEvents — branch edges (#1483)', () => {
  it('returns an empty array for empty input', () => {
    expect(parseHistoryEvents([])).toEqual([])
  })

  it('leaves notaryIntent unset when the Intent line is missing entirely', () => {
    const entries: GitLogEntry[] = [
      {
        sha: 'aaa',
        ts: '2024-01-01T00:00:00+00:00',
        subject: 'no notary here',
        body: 'Notary:\n- Delta: x\n- Patch: y',
      },
    ]
    const [event] = parseHistoryEvents(entries)
    expect(event?.notaryIntent).toBeUndefined()
  })

  it('treats an empty body as having no notary intent', () => {
    const entries: GitLogEntry[] = [
      { sha: 'bbb', ts: '2024-01-01T00:00:00+00:00', subject: 's', body: '' },
    ]
    const [event] = parseHistoryEvents(entries)
    expect(event?.notaryIntent).toBeUndefined()
    expect(event?.filesChanged).toEqual([])
  })

  it('keeps a stable order for entries that share an identical timestamp', () => {
    const ts = '2024-05-05T05:05:05+00:00'
    const entries: GitLogEntry[] = [
      { sha: 'one', ts, subject: 'a', body: '' },
      { sha: 'two', ts, subject: 'b', body: '' },
    ]
    const events = parseHistoryEvents(entries)
    expect(events.map((e) => e.sha)).toEqual(['one', 'two'])
  })
})

describe('filterEventsForNode — branch edges (#1483)', () => {
  const events: HistoryEvent[] = [
    {
      sha: 'abc',
      ts: '2024-11-03T10:00:00+00:00',
      subject: 'feat: add INV-05',
      filesChanged: ['repo/src/invariants/catalog.ts'],
      notaryIntent: 'mentions ADR-001 too',
    },
    {
      sha: 'def',
      ts: '2024-11-04T10:00:00+00:00',
      subject: 'chore: noise',
      filesChanged: ['package.json'],
    },
  ]

  it('matches a FILE: node by suffix when filesChanged holds a longer path', () => {
    // The stored path is "repo/src/invariants/catalog.ts"; a FILE node carrying
    // the suffix must still match via endsWith.
    const filtered = filterEventsForNode(events, 'FILE:src/invariants/catalog.ts')
    expect(filtered.map((e) => e.sha)).toEqual(['abc'])
  })

  it('matches a non-FILE node found only in the notaryIntent', () => {
    const filtered = filterEventsForNode(events, 'ADR-001')
    expect(filtered.map((e) => e.sha)).toEqual(['abc'])
  })

  it('returns an empty list when no event references the node', () => {
    expect(filterEventsForNode(events, 'REQ-404')).toHaveLength(0)
  })

  it('returns an empty list for a FILE: node with no matching files', () => {
    expect(filterEventsForNode(events, 'FILE:nowhere.ts')).toHaveLength(0)
  })
})
