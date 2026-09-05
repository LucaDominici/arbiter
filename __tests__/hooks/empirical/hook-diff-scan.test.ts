// #2539: content-scanning PostToolUse hooks used to scan the WHOLE edited file,
// so a marker planted on a line the edit never touched (a checker's own PATTERNS
// array, a deliberate test fixture, a coincidentally-matching variable name)
// blocked any unrelated edit to that file. The fix adopts the already-exported
// `addedLinesVsHEAD` (lib.mjs) so these hooks scan only the lines an edit added,
// falling back to a whole-file scan when the file is untracked or git errors
// (fail-open to the MORE conservative side, never less).
//
// Every hook here is exercised via its rendered TEMPLATE twin (self-contained —
// no cross-file import into arbiter's own scripts/) in an isolated temp git repo,
// mirroring the pattern in check-no-any.test.ts / ssot-guard.test.ts. A separate
// describe block below runs the RAW arbiter-only hooks (.claude/hooks/*.mjs)
// against a throwaway local clone of this repo to prove the five real instances
// named in #2539 are now editable.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, afterEach, afterAll, beforeAll } from 'vitest'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig } from '../../helpers.js'

const REPO_ROOT = resolve(process.cwd())

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
}

function commitAll(dir: string, message = 'init'): void {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', message], { cwd: dir, stdio: 'ignore' })
}

function installTemplateHook(dir: string, templatePath: string, hookFileName: string): string {
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  const config = makeConfig(dir, {
    language: 'typescript',
    projectName: 'hook-diff-scan-test',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --write',
  })
  writeFileSync(
    join(hooksDir, 'lib.mjs'),
    renderTemplate('claude/hooks/lib.mjs.ejs', config as unknown as Record<string, unknown>),
  )
  const hookPath = join(hooksDir, hookFileName)
  writeFileSync(
    hookPath,
    renderTemplate(templatePath, config as unknown as Record<string, unknown>),
  )
  return hookPath
}

function runHook(hookPath: string, cwd: string, filePath: string) {
  return spawnSync('node', [hookPath], {
    cwd,
    encoding: 'utf-8',
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    timeout: 5000,
  })
}

interface HookCase {
  name: string
  templatePath: string
  hookFileName: string
  relPath: string
  /** Content with NO violation. */
  clean: string
  /** Content with a violation on its own (last) line, appended to `clean`. */
  markerLine: string
  /** Substring expected in stderr when the marker fires. */
  markerNeedle: string
}

const CASES: HookCase[] = [
  {
    name: 'check-no-placeholders',
    templatePath: 'claude/hooks/check-no-placeholders.mjs.ejs',
    hookFileName: 'check-no-placeholders.mjs',
    relPath: 'src/file.ts',
    clean: 'export const a = 1\n',
    markerLine: '// FIXME: needs cleanup\n',
    markerNeedle: 'FIXME',
  },
  {
    name: 'check-no-orphan-todo',
    templatePath: 'claude/hooks/check-no-orphan-todo.mjs.ejs',
    hookFileName: 'check-no-orphan-todo.mjs',
    relPath: 'src/file.ts',
    clean: 'export const a = 1\n',
    // Built via concatenation so this test file's own source never spells a
    // bare orphan-TODO comment contiguously — the repo's own orphan-TODO gate
    // (scripts/check-no-orphan-todo.mjs) whole-file-scans __tests__/, and a
    // literal one here would self-block (#2539).
    markerLine: '//' + ' TODO: no task id\n',
    markerNeedle: 'INV-21',
  },
  {
    name: 'check-no-skipped-tests',
    templatePath: 'claude/hooks/check-no-skipped-tests.mjs',
    hookFileName: 'check-no-skipped-tests.mjs',
    relPath: 'src/file.test.ts',
    clean: "it('runs', () => {})\n",
    markerLine: "it.skip('broken', () => {})\n",
    markerNeedle: 'NI-11',
  },
  {
    name: 'check-no-pii',
    templatePath: 'claude/hooks/check-no-pii.mjs.ejs',
    hookFileName: 'check-no-pii.mjs',
    relPath: 'src/file.ts',
    clean: 'export const a = 1\n',
    // Built via concatenation so this test file's own source never spells a
    // contiguous email address — the repo's own PII gate (scripts/pii-scan.mjs)
    // whole-file-scans __tests__/, and a literal one here would self-block (#2539).
    markerLine: "const contact = 'leaked" + "@example.com'\n",
    markerNeedle: 'INV-12',
  },
]

describe.each(CASES)(
  '$name — diff-scoped PostToolUse scan (#2539)',
  ({ templatePath, hookFileName, relPath, clean, markerLine, markerNeedle }) => {
    let dir: string
    let hookPath: string
    let filePath: string

    function setup(): void {
      dir = mkdtempSync(join(tmpdir(), 'arbiter-hook-diff-scan-'))
      gitInit(dir)
      hookPath = installTemplateHook(dir, templatePath, hookFileName)
      filePath = join(dir, relPath)
      mkdirSync(join(dir, 'src'), { recursive: true })
    }

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('passes when a pre-existing marker is untouched and an unrelated line is edited', () => {
      setup()
      writeFileSync(filePath, `${markerLine}${clean}`)
      commitAll(dir)
      // Edit ONLY the unrelated line — the marker line is untouched.
      writeFileSync(filePath, `${markerLine}${clean.replace('1', '2')}`)

      const result = runHook(hookPath, dir, filePath)

      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toBe('')
    })

    it('still blocks (exit 2) when the marker line is newly added', () => {
      setup()
      writeFileSync(filePath, clean)
      commitAll(dir)
      writeFileSync(filePath, `${clean}${markerLine}`)

      const result = runHook(hookPath, dir, filePath)

      expect(result.status).toBe(2)
      expect(result.stderr).toContain(markerNeedle)
    })

    it('scans the whole file when the file is untracked (fail-open, #609 precedent)', () => {
      setup()
      // Never added/committed — addedLinesVsHEAD must degrade to whole-file.
      writeFileSync(filePath, `${markerLine}${clean}`)

      const result = runHook(hookPath, dir, filePath)

      expect(result.status).toBe(2)
      expect(result.stderr).toContain(markerNeedle)
    })

    it('scans the whole file when `git diff HEAD` errors despite the file being tracked (fail-open, not skip)', () => {
      setup()
      writeFileSync(filePath, `${markerLine}${clean}`)
      // Staged but never committed: `git ls-files --error-unmatch` reads the
      // index and succeeds, but `git diff HEAD` fails outright (no HEAD commit
      // exists yet) — a distinct failure path from "untracked" that must ALSO
      // degrade to whole-file, never to skipping the check.
      execFileSync('git', ['add', filePath], { cwd: dir, stdio: 'ignore' })

      const result = runHook(hookPath, dir, filePath)

      expect(result.status).toBe(2)
      expect(result.stderr).toContain(markerNeedle)
    })
  },
)

describe('gate --all walk stays whole-file (#2539)', () => {
  it('scripts/check-no-placeholders.mjs still flags pre-existing content untouched by the edit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-gate-whole-file-'))
    try {
      // No git repo at all — the gate's --all walk has never been git-aware and
      // must stay that way; only the PostToolUse hook path changes for #2539.
      writeFileSync(join(dir, 'file.ts'), '// FIXME: old debt\nexport const a = 2\n')
      const result = spawnSync(
        'node',
        [join(REPO_ROOT, 'scripts', 'check-no-placeholders.mjs'), dir],
        { encoding: 'utf-8' },
      )
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('FIXME')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('scripts/check-no-orphan-todo.mjs still flags pre-existing content untouched by the edit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-gate-whole-file-'))
    try {
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'file.ts'), '//' + ' TODO: no task id\nexport const a = 2\n')
      const result = spawnSync(
        'node',
        [join(REPO_ROOT, 'scripts', 'check-no-orphan-todo.mjs'), join(dir, 'src')],
        { encoding: 'utf-8' },
      )
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('TODO')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// The five instances enumerated in #2539: real repo files whose PRE-EXISTING,
// deliberately-planted or coincidental marker content made them un-editable
// anywhere else in the file. Exercised against a throwaway LOCAL CLONE of this
// repo (full history, isolated working tree) so the test can freely modify
// files without touching the actual worktree these tests run from.
describe('the five #2539 instances become editable (real repo files, cloned)', () => {
  let cloneDir: string

  beforeAll(() => {
    cloneDir = mkdtempSync(join(tmpdir(), 'arbiter-hook-diff-scan-clone-'))
    execFileSync('git', ['clone', '--local', '-q', REPO_ROOT, cloneDir], { stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: cloneDir,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: cloneDir, stdio: 'ignore' })
  })

  afterAll(() => {
    rmSync(cloneDir, { recursive: true, force: true })
  })

  function runClonedHook(hookRelPath: string, targetRelPath: string) {
    const hookPath = join(cloneDir, hookRelPath)
    const targetPath = join(cloneDir, targetRelPath)
    return spawnSync('node', [hookPath], {
      cwd: cloneDir,
      encoding: 'utf-8',
      input: JSON.stringify({ tool_input: { file_path: targetPath } }),
      timeout: 10000,
    })
  }

  function editUnrelatedLine(targetRelPath: string): void {
    const abs = join(cloneDir, targetRelPath)
    const original = readFileSync(abs, 'utf-8')
    writeFileSync(abs, `${original}\n// unrelated trailing comment added by test (#2539)\n`)
  }

  it('1. check-no-placeholders.mjs itself — editing anywhere but PATTERNS now passes', () => {
    const target = '.claude/hooks/check-no-placeholders.mjs'
    editUnrelatedLine(target)
    const result = runClonedHook('.claude/hooks/check-no-placeholders.mjs', target)
    expect(result.status, result.stderr).toBe(0)
  })

  it('2. check-no-skipped-tests.mjs — editing it no longer trips check-no-placeholders on its own doc comment', () => {
    const target = '.claude/hooks/check-no-skipped-tests.mjs'
    editUnrelatedLine(target)
    const result = runClonedHook('.claude/hooks/check-no-placeholders.mjs', target)
    expect(result.status, result.stderr).toBe(0)
  })

  it('3. scripts/check-handoff-doc.mjs — its own `const PLACEHOLDER` no longer blocks unrelated edits', () => {
    const target = 'scripts/check-handoff-doc.mjs'
    editUnrelatedLine(target)
    const result = runClonedHook('.claude/hooks/check-no-placeholders.mjs', target)
    expect(result.status, result.stderr).toBe(0)
  })

  it('4. scripts/check-no-orphan-todo.mjs — its own doc comments/pattern no longer block unrelated edits', () => {
    const target = 'scripts/check-no-orphan-todo.mjs'
    editUnrelatedLine(target)
    const result = runClonedHook('.claude/hooks/check-no-orphan-todo.mjs', target)
    expect(result.status, result.stderr).toBe(0)
  })

  it('5. a fixture that deliberately plants it.skip/xit literals is editable elsewhere', () => {
    const target = '__tests__/scripts/check-muted-test.test.ts'
    editUnrelatedLine(target)
    const result = runClonedHook('.claude/hooks/check-no-placeholders.mjs', target)
    expect(result.status, result.stderr).toBe(0)
  })

  it('a genuinely NEW marker still blocks in the cloned repo (both directions, CANON-24)', () => {
    const target = '.claude/hooks/check-no-placeholders.mjs'
    const abs = join(cloneDir, target)
    const original = readFileSync(abs, 'utf-8')
    writeFileSync(abs, `${original}\n// FIXME: freshly added by test (#2539)\n`)
    const result = runClonedHook('.claude/hooks/check-no-placeholders.mjs', target)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('FIXME')
  })
})
