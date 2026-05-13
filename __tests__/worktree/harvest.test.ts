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
