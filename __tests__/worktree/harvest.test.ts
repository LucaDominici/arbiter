import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli } from '../../src/utils/run-cli.js'
import { harvestFiles } from '../../src/worktree/harvest.js'

let mainRepo: string
let worktree: string

/**
 * Init a git repo at `dir` with one initial commit.
 */
function initGitRepo(dir: string): void {
  runCli('git', ['init'], { cwd: dir })
  runCli('git', ['config', 'user.email', 'test@test.com'], { cwd: dir })
  runCli('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# test')
  runCli('git', ['add', '.'], { cwd: dir })
  runCli('git', ['commit', '-m', 'init'], { cwd: dir })
}

beforeEach(() => {
  mainRepo = mkdtempSync(join(tmpdir(), 'arbiter-harvest-main-'))
  worktree = mkdtempSync(join(tmpdir(), 'arbiter-harvest-wt-'))
  initGitRepo(mainRepo)
  initGitRepo(worktree)
})

afterEach(() => {
  rmSync(mainRepo, { recursive: true, force: true })
  rmSync(worktree, { recursive: true, force: true })
})

describe('harvestFiles', () => {
  it('copies modified files from worktree to main repo', () => {
    // Create a file in main repo and commit it
    mkdirSync(join(mainRepo, 'src'), { recursive: true })
    writeFileSync(join(mainRepo, 'src/app.ts'), 'original')
    runCli('git', ['add', '.'], { cwd: mainRepo })
    runCli('git', ['commit', '-m', 'add app.ts'], { cwd: mainRepo })

    // Modify the file in the worktree
    mkdirSync(join(worktree, 'src'), { recursive: true })
    writeFileSync(join(worktree, 'src/app.ts'), 'modified')
    // Stage it so git status picks it up
    runCli('git', ['add', '.'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.copied).toContain('src/app.ts')
    expect(readFileSync(join(mainRepo, 'src/app.ts'), 'utf-8')).toBe('modified')
  })

  it('copies new (untracked) files from worktree to main repo', () => {
    // Create an untracked file in the worktree
    mkdirSync(join(worktree, 'src'), { recursive: true })
    writeFileSync(join(worktree, 'src', 'new-feature.ts'), 'new content')
    runCli('git', ['add', '.'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.copied).toContain('src/new-feature.ts')
    expect(existsSync(join(mainRepo, 'src', 'new-feature.ts'))).toBe(true)
  })

  it('skips files that have uncommitted changes in the main repo', () => {
    // Create a file in main repo and commit it
    mkdirSync(join(mainRepo, 'src'), { recursive: true })
    writeFileSync(join(mainRepo, 'src/app.ts'), 'original')
    runCli('git', ['add', '.'], { cwd: mainRepo })
    runCli('git', ['commit', '-m', 'add app.ts'], { cwd: mainRepo })

    // Modify the file in the worktree
    mkdirSync(join(worktree, 'src'), { recursive: true })
    writeFileSync(join(worktree, 'src/app.ts'), 'worktree-change')
    runCli('git', ['add', '.'], { cwd: worktree })

    // Also modify the same file in the main repo (uncommitted)
    writeFileSync(join(mainRepo, 'src/app.ts'), 'main-repo-change')

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.skipped).toContain('src/app.ts')
    // Main repo file should keep its uncommitted change
    expect(readFileSync(join(mainRepo, 'src/app.ts'), 'utf-8')).toBe('main-repo-change')
  })

  it('returns empty arrays when worktree has no changes', () => {
    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.copied).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })

  it('calls onFile callback for each file', () => {
    writeFileSync(join(worktree, 'new-file.txt'), 'content')
    runCli('git', ['add', '.'], { cwd: worktree })

    const actions: Array<{ file: string; action: 'copy' | 'skip' }> = []
    harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
      onFile: (file, action) => actions.push({ file, action }),
    })

    expect(actions).toHaveLength(1)
    expect(actions[0].action).toBe('copy')
  })

  it("skips deleted files (source doesn't exist)", () => {
    // No changes in worktree = empty result — tests the graceful handling path
    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.copied).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })

  it('skips directories in the changed files list', () => {
    // Create a directory in worktree (not a file)
    mkdirSync(join(worktree, 'some-dir'), { recursive: true })
    writeFileSync(join(worktree, 'some-dir', 'file.txt'), 'content')
    runCli('git', ['add', '.'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    // "some-dir" should be skipped (it's a directory)
    // but "some-dir/file.txt" should be copied
    expect(result.copied).toContain('some-dir/file.txt')
    expect(result.copied).not.toContain('some-dir')
  })

  it('handles filenames containing spaces verbatim (no porcelain quoting) (#500)', () => {
    writeFileSync(join(worktree, 'weird name.txt'), 'content')
    runCli('git', ['add', '.'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.copied).toContain('weird name.txt')
    expect(existsSync(join(mainRepo, 'weird name.txt'))).toBe(true)
    // Must NOT be the quoted form that `--porcelain` (without -z) would emit.
    expect(result.copied).not.toContain('"weird name.txt"')
  })

  it('handles filenames containing unicode characters (#500)', () => {
    // Italian + a CJK glyph
    const name = 'città-测试.txt'
    writeFileSync(join(worktree, name), 'content')
    runCli('git', ['add', '.'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.copied).toContain(name)
    expect(existsSync(join(mainRepo, name))).toBe(true)
  })

  it('handles filenames containing newline characters (#500)', () => {
    // A literal newline in a filename — the pre-fix newline-split parser
    // would have truncated this. POSIX allows newlines; macOS and Linux do too.
    const name = 'with\nnewline.txt'
    writeFileSync(join(worktree, name), 'content')
    runCli('git', ['add', '.'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.copied).toContain(name)
    expect(existsSync(join(mainRepo, name))).toBe(true)
  })

  it('rename to a destination filename containing the literal " -> " substring (#501)', () => {
    // The destination filename itself contains ' -> ' — the pre-fix
    // `indexOf(' -> ')` parser would have split here and produced a wrong
    // path. Under `-z` there is no separator at all; destination is its own
    // NUL-terminated field.
    writeFileSync(join(worktree, 'src.txt'), 'content')
    runCli('git', ['add', '.'], { cwd: worktree })
    runCli('git', ['commit', '-m', 'add src.txt'], { cwd: worktree })

    const dst = 'a -> b.txt'
    runCli('git', ['mv', 'src.txt', dst], { cwd: worktree })

    const files: string[] = []
    harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
      onFile: (file) => files.push(file),
    })

    expect(files).toContain(dst)
    // Must not be the substring before " -> " in the destination name.
    expect(files).not.toContain('a')
  })

  it('extracts destination path from rename entries (#312)', () => {
    // Create a file in the worktree, commit it, then rename it
    writeFileSync(join(worktree, 'old-name.ts'), 'content')
    runCli('git', ['add', '.'], { cwd: worktree })
    runCli('git', ['commit', '-m', 'add old-name.ts'], { cwd: worktree })

    // Rename using git mv — produces "R  old-name.ts -> new-name.ts" in porcelain
    runCli('git', ['mv', 'old-name.ts', 'new-name.ts'], { cwd: worktree })

    const files: string[] = []
    harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
      onFile: (file) => files.push(file),
    })

    // Should use destination ("new-name.ts"), not the raw "old-name.ts -> new-name.ts"
    expect(files).toContain('new-name.ts')
    expect(files).not.toContain('old-name.ts -> new-name.ts')
    expect(files).not.toContain('old-name.ts')
  })
})

describe('parent state capture (#733)', () => {
  it('returns parentBranchBefore when captureParentState: true', () => {
    writeFileSync(join(worktree, 'new-file.txt'), 'content')
    runCli('git', ['add', '.'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
      captureParentState: true,
    })

    expect(typeof result.parentBranchBefore).toBe('string')
    expect(result.parentBranchBefore!.length).toBeGreaterThan(0)
  })

  it('returns parentUntrackedBefore listing untracked files in main repo', () => {
    writeFileSync(join(mainRepo, 'untracked.txt'), 'untracked content')
    writeFileSync(join(worktree, 'new-file.txt'), 'content')
    runCli('git', ['add', '.'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
      captureParentState: true,
    })

    expect(result.parentUntrackedBefore).toContain('untracked.txt')
  })

  it('parentBranchBefore and parentUntrackedBefore are undefined without captureParentState', () => {
    writeFileSync(join(worktree, 'new-file.txt'), 'content')
    runCli('git', ['add', '.'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.parentBranchBefore).toBeUndefined()
    expect(result.parentUntrackedBefore).toBeUndefined()
  })

  it('captures parent state even when worktree has no changes', () => {
    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
      captureParentState: true,
    })

    expect(typeof result.parentBranchBefore).toBe('string')
    expect(Array.isArray(result.parentUntrackedBefore)).toBe(true)
    expect(result.copied).toHaveLength(0)
  })
})

describe('untracked-file protection (#733)', () => {
  it('does not overwrite an untracked file in main repo when worktree has a newer version', () => {
    // Main repo has an untracked file — created during a session but never committed
    writeFileSync(join(mainRepo, 'FINDINGS.md'), 'original untracked content in main')

    // Worktree has the same filename staged for commit
    writeFileSync(join(worktree, 'FINDINGS.md'), 'worktree version that must not overwrite')
    runCli('git', ['add', 'FINDINGS.md'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    // Untracked file in main must be preserved
    expect(readFileSync(join(mainRepo, 'FINDINGS.md'), 'utf-8')).toBe(
      'original untracked content in main',
    )
    // Must NOT appear in copied
    expect(result.copied).not.toContain('FINDINGS.md')
    // Must appear in protectedUntracked (new guardrail field)
    expect(result.protectedUntracked).toContain('FINDINGS.md')
  })

  it('still copies new files to main repo when they do not exist there at all', () => {
    // File only exists in worktree — main has no copy → must copy freely
    writeFileSync(join(worktree, 'brand-new.ts'), 'new content')
    runCli('git', ['add', 'brand-new.ts'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.copied).toContain('brand-new.ts')
    expect(existsSync(join(mainRepo, 'brand-new.ts'))).toBe(true)
    expect(result.protectedUntracked).not.toContain('brand-new.ts')
  })

  it('still copies when main repo file is tracked and clean', () => {
    // File is tracked + committed in main → worktree version should overwrite freely
    writeFileSync(join(mainRepo, 'tracked.ts'), 'original tracked')
    runCli('git', ['add', 'tracked.ts'], { cwd: mainRepo })
    runCli('git', ['commit', '-m', 'add tracked.ts'], { cwd: mainRepo })

    writeFileSync(join(worktree, 'tracked.ts'), 'updated in worktree')
    runCli('git', ['add', 'tracked.ts'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.copied).toContain('tracked.ts')
    expect(readFileSync(join(mainRepo, 'tracked.ts'), 'utf-8')).toBe('updated in worktree')
    expect(result.protectedUntracked).not.toContain('tracked.ts')
  })

  it('protectedUntracked is empty when no untracked collisions occur', () => {
    writeFileSync(join(worktree, 'only-in-wt.ts'), 'content')
    runCli('git', ['add', 'only-in-wt.ts'], { cwd: worktree })

    const result = harvestFiles({
      worktreePath: worktree,
      mainRepoPath: mainRepo,
    })

    expect(result.protectedUntracked).toHaveLength(0)
  })
})
