// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  parseWorkspaceFile,
  parseWorkspaceYaml,
  type ParseWorkspaceOutcome,
} from '../../src/compare/workspace.js'

// ─── Temp-fixture lifecycle ─────────────────────────────────────────────────
// Real filesystem temp dirs (mkdtempSync) drive parseWorkspaceFile's readFileSync
// branches; cleaned in afterEach so the suite stays hermetic and deterministic.

const created: string[] = []

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-cov-'))
  created.push(dir)
  return dir
}

function writeYaml(contents: string): string {
  const dir = tmpDir()
  const file = join(dir, 'workspace.yaml')
  writeFileSync(file, contents, 'utf-8')
  return file
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

/** Narrow an outcome to the ok branch, failing the test loudly otherwise. */
function expectOk(outcome: ParseWorkspaceOutcome): Extract<ParseWorkspaceOutcome, { ok: true }> {
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) {
    throw new Error(`expected ok outcome, got error: ${outcome.reason}`)
  }
  return outcome
}

// ─── parseWorkspaceFile: readFileSync success / catch branches ──────────────

describe('parseWorkspaceFile', () => {
  it('reads and parses a real file on disk (try branch)', () => {
    const file = writeYaml('name: disk-org\nrepos:\n  - path: ./app\n')
    const result = parseWorkspaceFile(file)
    const ok = expectOk(result)
    expect(ok.spec.name).toBe('disk-org')
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.path).toBe('./app')
  })

  it('returns an error when the file does not exist (catch branch, Error message)', () => {
    const missing = join(tmpdir(), 'workspace-cov-does-not-exist-zzz.yaml')
    const result = parseWorkspaceFile(missing)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('failed to read workspace file')
    expect(result.reason).toContain(missing)
    // readFileSync throws an Error (instanceof Error true branch) carrying ENOENT.
    expect(result.reason).toContain('ENOENT')
  })

  it('propagates a parse error (no repos) read from a real file', () => {
    const file = writeYaml('name: only-name\n')
    const result = parseWorkspaceFile(file)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('no repos found')
  })
})

// ─── parseWorkspaceYaml: top-level key branches ─────────────────────────────

describe('parseWorkspaceYaml top-level keys', () => {
  it('defaults name to "unknown" when no name key is present', () => {
    const ok = expectOk(parseWorkspaceYaml('repos:\n  - path: ./a\n'))
    expect(ok.spec.name).toBe('unknown')
  })

  it('uses a custom source label in the no-repos error', () => {
    const result = parseWorkspaceYaml('name: x\n', 'my-source.yaml')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('my-source.yaml: no repos found in workspace spec')
  })

  it('ignores an unknown top-level key (else branch) and closes repos mode', () => {
    // unknown key after repos must flip inRepos=false so the following
    // indented "- path" line is NOT treated as a repo entry.
    const yaml = ['name: org', 'repos:', '  - path: ./first', 'other: value', '  - path: ./second'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.name).toBe('org')
    // Only ./first is captured; ./second falls outside repos mode.
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.path).toBe('./first')
  })

  it('treats a second name key after repos as ending repos mode', () => {
    const yaml = ['repos:', '  - path: ./a', 'name: late', '  - path: ./ignored'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.name).toBe('late')
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.path).toBe('./a')
  })
})

// ─── processLine: blank / comment-only / pre-repos-content branches ─────────

describe('parseWorkspaceYaml line filtering', () => {
  it('skips blank lines and full-line comments', () => {
    const yaml = ['', '# leading comment', 'name: org', '   ', '# another', 'repos:', '  - path: ./a', ''].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.name).toBe('org')
    expect(ok.spec.repos).toHaveLength(1)
  })

  it('ignores indented content before repos mode begins (inRepos false guard)', () => {
    // Indented line that is not a top-level key, while inRepos is still false,
    // must hit the early `if (!state.inRepos) return`.
    const yaml = ['name: org', '  - path: ./too-early', 'repos:', '  - path: ./real'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.path).toBe('./real')
  })

  it('treats a tab-indented top-level-looking line as repo content, not a top key', () => {
    // Line starts with a tab, so the !startsWith('\t') guard rejects the top-level
    // branch; inside repos it is parsed as a continuation key.
    const yaml = ['name: org', 'repos:', '  - path: ./a', '\trole: prod'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.role).toBe('prod')
  })
})

// ─── processRepoLine + flushCurrent + assignField branches ──────────────────

describe('parseWorkspaceYaml repo entries', () => {
  it('parses an inline key=value on the list-item line (rest non-empty, kv match)', () => {
    const yaml = ['name: org', 'repos:', '  - path: ./inline'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.repos[0]?.path).toBe('./inline')
  })

  it('handles a bare list item (rest empty) followed by continuation keys', () => {
    const yaml = ['name: org', 'repos:', '  -', '    path: ./bare', '    role: staging', '    tier: L2'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.path).toBe('./bare')
    expect(ok.spec.repos[0]?.role).toBe('staging')
    expect(ok.spec.repos[0]?.tier).toBe('L2')
  })

  it('ignores a list item whose inline rest is not a key:value (kv null branch)', () => {
    // "- notakeyvalue" → rest non-empty but no colon → kv match null, nothing assigned.
    // current stays {path:undefined}; flushCurrent drops it (path not a string).
    const yaml = ['name: org', 'repos:', '  - notakeyvalue', '  - path: ./valid'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.path).toBe('./valid')
  })

  it('ignores a continuation line that is not key:value (kv null branch)', () => {
    const yaml = ['name: org', 'repos:', '  - path: ./a', '    this-is-not-kv'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.path).toBe('./a')
    expect(ok.spec.repos[0]?.role).toBeUndefined()
  })

  it('ignores unknown continuation keys (assignField default branch)', () => {
    const yaml = ['name: org', 'repos:', '  - path: ./a', '    unknownkey: whatever'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.path).toBe('./a')
    expect(ok.spec.repos[0]?.role).toBeUndefined()
    expect(ok.spec.repos[0]?.tier).toBeUndefined()
  })

  it('omits role/tier when only path is given (flushCurrent undefined-field branches)', () => {
    const yaml = ['name: org', 'repos:', '  - path: ./minimal'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    const repo = ok.spec.repos[0]
    expect(repo?.path).toBe('./minimal')
    expect(repo).not.toHaveProperty('role')
    expect(repo).not.toHaveProperty('tier')
  })

  it('includes role and tier when present (flushCurrent defined-field branches)', () => {
    const yaml = ['name: org', 'repos:', '  - path: ./full', '    role: production', '    tier: L3'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    const repo = ok.spec.repos[0]
    expect(repo?.role).toBe('production')
    expect(repo?.tier).toBe('L3')
  })

  it('drops a current entry that never received a path (flushCurrent path-not-string)', () => {
    // A list item with only role/tier (no path) must be discarded by flushCurrent.
    const yaml = ['name: org', 'repos:', '  - role: orphan', '    tier: L1', '  - path: ./kept'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.path).toBe('./kept')
  })

  it('ignores continuation lines when there is no current entry (current null branch)', () => {
    // After "repos:" with no list item yet, an indented kv line has current === null.
    const yaml = ['name: org', 'repos:', '    path: ./floating', '  - path: ./anchored'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.repos).toHaveLength(1)
    expect(ok.spec.repos[0]?.path).toBe('./anchored')
  })
})

// ─── stripQuotes branches ───────────────────────────────────────────────────

describe('parseWorkspaceYaml quote stripping', () => {
  it('strips double quotes around values', () => {
    const yaml = ['name: "Quoted Org"', 'repos:', '  - path: "./quoted"'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.name).toBe('Quoted Org')
    expect(ok.spec.repos[0]?.path).toBe('./quoted')
  })

  it('strips single quotes around values', () => {
    const yaml = ['name: ' + "'Single Org'", 'repos:', '  - path: ' + "'./single'"].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.name).toBe('Single Org')
    expect(ok.spec.repos[0]?.path).toBe('./single')
  })

  it('leaves mismatched/absent quotes untouched (no-strip branch)', () => {
    // Leading quote but no trailing quote → both startsWith/endsWith conditions
    // fail → value returned verbatim.
    const yaml = ['name: "unterminated', 'repos:', '  - path: ./plain'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.name).toBe('"unterminated')
    expect(ok.spec.repos[0]?.path).toBe('./plain')
  })

  it('handles an empty value after the colon (?? fallback chain)', () => {
    // "name:" with nothing after → value undefined → trimmed to '' → name ''.
    const yaml = ['name:', 'repos:', '  - path: ./a'].join('\n')
    const ok = expectOk(parseWorkspaceYaml(yaml))
    expect(ok.spec.name).toBe('')
    expect(ok.spec.repos[0]?.path).toBe('./a')
  })
})
