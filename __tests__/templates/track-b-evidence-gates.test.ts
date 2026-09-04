// SPDX-License-Identifier: Apache-2.0
/**
 * Track-B evidence gates, PROVEN TO RUN (#2480 wave 7).
 *
 * The arc42 wave (#2480, INV-144) shipped a gate that rendered correctly into a governed project
 * and could not execute there: its engine was absent from the tarball and its skeletons resolved to
 * a path that only exists in a dev checkout. Both defects were invisible to twenty-nine tests,
 * every one of which passed the fixture in by hand. The lesson written down at the time was that a
 * Track-B claim is worth what its execution proves, so these two ports are tested by RENDERING them
 * into a package-shaped project and RUNNING them there — including the failure paths, because a
 * gate that cannot fail is the thing this whole programme exists to refuse.
 *
 * Both gates were self-only until this wave for one shared reason: their rules validate against a
 * schema, and a rule shipped without its contract errors the moment a project uses it. So the
 * schema travelling with the gate is itself an assertion here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const HEADER = `| feature_id | capability | kit_dims | level | status | code_ref | test_ref | doc_ref | issue_ref | note |
|---|---|---|---|---|---|---|---|---|---|`

const EXCERPT = 'The excerpt is the evidence, and the hash is what keeps it the evidence.\n'
const HASH = createHash('sha256').update(EXCERPT).digest('hex')

interface Run {
  status: number
  out: string
}

describe('Track-B evidence gates run where they are emitted (#2480)', () => {
  let dir: string

  /** Render the emitted files into a project-shaped tree — gate, its schema, its one dependency. */
  const emit = (): void => {
    const data = makeConfig(dir, { governanceLevel: 'L2' }) as unknown as Record<string, unknown>
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    mkdirSync(join(dir, 'schemas'), { recursive: true })
    mkdirSync(join(dir, 'docs'), { recursive: true })
    for (const [rel, tpl] of [
      ['scripts/check-sources.mjs', 'scripts/check-sources.mjs.ejs'],
      ['scripts/check-feature-matrix.mjs', 'scripts/check-feature-matrix.mjs.ejs'],
      ['scripts/lib/agent-return-validate.mjs', 'scripts/lib/agent-return-validate.mjs.ejs'],
      ['schemas/source-record.schema.json', 'schemas/source-record.schema.json.ejs'],
      ['schemas/rtm-verdict.schema.json', 'schemas/rtm-verdict.schema.json.ejs'],
    ] as const) {
      const rendered = renderTemplate(tpl, data)
      // A leftover EJS tag would mean the gate ships a syntax error, which no runtime assertion
      // below would attribute correctly.
      expect(rendered, `${rel} still carries an unrendered EJS tag`).not.toContain('<%')
      writeFileSync(join(dir, rel), rendered)
    }
  }

  const run = (script: string, args: string[] = []): Run => {
    const r = spawnSync('node', [join(dir, 'scripts', script), ...args], {
      encoding: 'utf-8',
      cwd: dir,
    })
    return { status: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
  }

  const writeSources = (over: Record<string, unknown> = {}, excerpt = EXCERPT): void => {
    mkdirSync(join(dir, 'docs', 'sources', 'excerpts'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'sources', 'excerpts', 'SRC-001.txt'), excerpt)
    const source = {
      id: 'SRC-001',
      title: 'A source a governed project cites',
      url: 'https://example.invalid/spec',
      kind: 'docs',
      retrieved_at: '2026-09-04',
      excerpt_path: 'docs/sources/excerpts/SRC-001.txt',
      content_hash: HASH,
      citations: [{ quoted_text: 'the hash is what keeps it the evidence' }],
      selected_by_user: true,
      informs: [],
      application_status: 'cited',
      ...over,
    }
    writeFileSync(
      join(dir, 'docs', 'SOURCES.md'),
      [
        '# Sources',
        '',
        '<!-- SOURCES_START -->',
        '```json',
        JSON.stringify({ sources: [source] }, null, 2),
        '```',
        '<!-- SOURCES_END -->',
        '',
      ].join('\n'),
    )
  }

  const writeMatrix = (status: string): void => {
    const row = `| REQ-001 | A capability | N01 | L2 | ${status} | src/a.ts | test/a.test.ts | docs/a.md | #1 | — |`
    const counts = { Verified: 0, Done: 0, Partial: 0, Missing: 0 } as Record<string, number>
    counts[status] = 1
    writeFileSync(
      join(dir, 'docs', 'FEATURE_MATRIX.md'),
      [
        '# FEATURE_MATRIX',
        '',
        '<!-- FEATURE_MATRIX_START -->',
        HEADER,
        row,
        '<!-- FEATURE_MATRIX_END -->',
        '',
        '## Summary',
        '',
        '| Status | Count |',
        '|---|---|',
        `| Verified | ${counts['Verified']} |`,
        `| Done | ${counts['Done']} |`,
        `| Partial | ${counts['Partial']} |`,
        `| Missing | ${counts['Missing']} |`,
        '| **Total** | **1** |',
        '',
      ].join('\n'),
    )
    for (const rel of ['src/a.ts', 'test/a.test.ts', 'docs/a.md']) {
      mkdirSync(join(dir, rel.split('/')[0] as string), { recursive: true })
      writeFileSync(join(dir, rel), '// present\n')
    }
  }

  const writeEnvelope = (over: Record<string, unknown> = {}): void => {
    mkdirSync(join(dir, '.arbiter', 'evidence', 'rtm'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'evidence', 'rtm', 'REQ-001.json'),
      JSON.stringify({
        feature_id: 'REQ-001',
        verdict: 'PROVEN',
        justification: 'The suite was executed against this requirement and passed.',
        command: 'npm test',
        transcript_digest: 'a'.repeat(64),
        recorded_at: '2026-09-04T00:00:00Z',
        ...over,
      }),
    )
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-trackb-'))
    emit()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  describe('check-sources.mjs (INV-147)', () => {
    it('SKIPs out loud in a project that cites nothing — the common case must not read as a pass', () => {
      const r = run('check-sources.mjs')
      expect(r.status).toBe(0)
      expect(r.out).toMatch(/\[SKIP\]/)
      expect(r.out).not.toMatch(/PASS/)
    })

    it('resolves its emitted schema and passes on a well-formed registry', () => {
      writeSources()
      const r = run('check-sources.mjs')
      expect(r.out).not.toMatch(/cannot load/)
      expect(r.status).toBe(0)
      expect(r.out).toMatch(/PASS/)
    })

    it("reads docs/SOURCES.md, not arbiter's own internal path", () => {
      writeSources()
      mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
      unlinkSync(join(dir, 'docs', 'SOURCES.md'))
      expect(run('check-sources.mjs').out).toMatch(/\[SKIP\]/)
    })

    it('fails when the excerpt drifts from its recorded hash', () => {
      writeSources({}, EXCERPT.replace('evidence', 'EVIDENCE'))
      const r = run('check-sources.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/hash/i)
    })

    it('fails when the project quotes something the excerpt never said', () => {
      writeSources({ citations: [{ quoted_text: 'a sentence the source never contained' }] })
      expect(run('check-sources.mjs').status).toBe(1)
    })

    it('errors, not merely fails, when its emitted schema is missing (INV-53)', () => {
      writeSources()
      unlinkSync(join(dir, 'schemas', 'source-record.schema.json'))
      const r = run('check-sources.mjs')
      expect(r.status).toBe(2)
      expect(r.out).toMatch(/source-record\.schema\.json/)
    })
  })

  describe('check-feature-matrix.mjs axis 2 (INV-112)', () => {
    it('refuses a Verified row with no verification envelope — status is not evidence', () => {
      writeMatrix('Verified')
      const r = run('check-feature-matrix.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/RTM verdict ratchet/)
      expect(r.out).toMatch(/REQ-001/)
    })

    it('accepts the same row once the envelope exists', () => {
      writeMatrix('Verified')
      writeEnvelope()
      const r = run('check-feature-matrix.mjs')
      expect(r.out).not.toMatch(/RTM verdict ratchet/)
      expect(r.status).toBe(0)
    })

    it('refuses an envelope whose verdict is not PROVEN', () => {
      writeMatrix('Verified')
      writeEnvelope({ verdict: 'STALE' })
      const r = run('check-feature-matrix.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/requires verdict PROVEN/)
    })

    it('refuses evidence copied from another requirement', () => {
      writeMatrix('Verified')
      writeEnvelope({ feature_id: 'REQ-999' })
      const r = run('check-feature-matrix.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/REQ-999/)
    })

    it('refuses an envelope the emitted schema rejects — the contract travels with the rule', () => {
      writeMatrix('Verified')
      writeEnvelope({ justification: 'works' })
      const r = run('check-feature-matrix.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/envelope/)
    })

    it('says so when the schema is gone rather than letting the rule lapse in silence', () => {
      writeMatrix('Verified')
      writeEnvelope()
      unlinkSync(join(dir, 'schemas', 'rtm-verdict.schema.json'))
      const r = run('check-feature-matrix.mjs')
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/rtm-verdict\.schema\.json is missing/)
    })

    it('leaves a row that claims nothing alone — the rule applies to Verified only', () => {
      writeMatrix('Partial')
      const r = run('check-feature-matrix.mjs')
      expect(r.out).not.toMatch(/RTM verdict ratchet/)
    })
  })
})
