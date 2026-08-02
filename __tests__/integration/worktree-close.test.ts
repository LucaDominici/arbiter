import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runWorktreeOpen, runWorktreeClose } from '../../src/commands/worktree.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function initRepo(dir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], {
    cwd: dir,
    stdio: 'ignore',
  })
}

function initBareRemote(dir: string): void {
  execFileSync('git', ['init', '--bare', '-b', 'main'], {
    cwd: dir,
    stdio: 'ignore',
  })
}

function seedCommit(dir: string): void {
  writeFileSync(join(dir, 'README.md'), '# test')
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let repoRoot: string
let remoteDir: string
let worktreesDir: string

beforeEach(() => {
  repoRoot = makeTmpDir('arbiter-wt-close-main-')
  remoteDir = makeTmpDir('arbiter-wt-close-remote-')
  worktreesDir = makeTmpDir('arbiter-wt-close-store-')

  initRepo(repoRoot)
  seedCommit(repoRoot)

  // Wire up a local bare "remote" so the merge-base check has origin/main
  initBareRemote(remoteDir)
  execFileSync('git', ['remote', 'add', 'origin', remoteDir], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
  execFileSync('git', ['push', 'origin', 'main'], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
})

afterEach(() => {
  try {
    execFileSync('git', ['worktree', 'prune'], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
  } catch {
    // ignore
  }
  rmSync(repoRoot, { recursive: true, force: true })
  rmSync(remoteDir, { recursive: true, force: true })
  rmSync(worktreesDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helper: open a worktree and simulate merging its branch
// ---------------------------------------------------------------------------

async function openAndMerge(taskId: string, slug: string): Promise<string> {
  await runWorktreeOpen({ taskId, slug, cwd: repoRoot, worktreesDir })
  // #1108: worktree dir name strips the task id's leading # (branch keeps it).
  const wtPath = join(worktreesDir, `${taskId.replace(/^#/, '')}-${slug}`)

  // Make a commit in the worktree — stage only the feature file, not any symlinks
  // that materializeLink may have created (to avoid merge conflicts). Use a
  // slug-scoped filename so two worktrees for the same task id don't collide.
  const featureFile = `feature-${slug}.txt`
  writeFileSync(join(wtPath, featureFile), 'done')
  execFileSync('git', ['add', featureFile], { cwd: wtPath, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'feat: add feature'], {
    cwd: wtPath,
    stdio: 'ignore',
  })

  // Merge the branch into main in the main repo
  const branch = `task/${taskId}-${slug}`
  execFileSync('git', ['merge', '--no-ff', branch, '-m', `Merge ${branch}`], {
    cwd: repoRoot,
    stdio: 'ignore',
  })

  // Push main to origin so origin/main is ahead of the branch
  execFileSync('git', ['push', 'origin', 'main'], {
    cwd: repoRoot,
    stdio: 'ignore',
  })

  return wtPath
}

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

describe('runWorktreeClose', () => {
  it('closes a merged worktree — directory removed, log written', async () => {
    await openAndMerge('#999', 'test')

    runWorktreeClose({
      taskId: '#999',
      cwd: repoRoot,
      noFetch: true, // skip network fetch in test — remote is already up to date
    })

    const wtPath = join(worktreesDir, '999-test')
    expect(existsSync(wtPath)).toBe(false)

    const logPath = join(repoRoot, '.arbiter', 'worktree-close.log.json')
    expect(existsSync(logPath)).toBe(true)
    const entries = JSON.parse(readFileSync(logPath, 'utf-8')) as unknown[]
    const entry = entries[0] as Record<string, unknown>
    expect(entry['taskId']).toBe('#999')
    expect(entry['force']).toBe(false)
  })

  it('keeps untracked work safe on close while open remains lenient (#2203)', async () => {
    // Opening must remain possible when the main tree has local-only files.
    writeFileSync(join(repoRoot, '.env.local'), 'LOCAL_ONLY=1')
    const wtPath = await openAndMerge('#2203', 'untracked-safety')
    expect(existsSync(wtPath)).toBe(true)

    // A real untracked file in a real worktree must block normal teardown.
    const untrackedPath = join(wtPath, 'never-added.txt')
    writeFileSync(untrackedPath, 'do not destroy')

    expect(() =>
      runWorktreeClose({ taskId: '#2203', cwd: repoRoot, noFetch: true }),
    ).toThrow(/untracked files.*--force/i)
    expect(existsSync(untrackedPath)).toBe(true)

    // The explicit escape hatch intentionally permits removal.
    runWorktreeClose({ taskId: '#2203', cwd: repoRoot, noFetch: true, force: true })
    expect(existsSync(wtPath)).toBe(false)
  })

  it('refuses to close an unmerged branch without --force', async () => {
    await runWorktreeOpen({
      taskId: '#999',
      slug: 'unmerged',
      cwd: repoRoot,
      worktreesDir,
    })
    // Add a commit so the branch has work not yet in origin/main
    const wtPath = join(worktreesDir, '999-unmerged')
    writeFileSync(join(wtPath, 'work.txt'), 'wip')
    execFileSync('git', ['add', '.'], { cwd: wtPath, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'wip'], {
      cwd: wtPath,
      stdio: 'ignore',
    })

    expect(() => runWorktreeClose({ taskId: '#999', cwd: repoRoot, noFetch: true })).toThrow(
      /not been merged/i,
    )
  })

  it('closes with --force even when branch is unmerged', async () => {
    await runWorktreeOpen({
      taskId: '#999',
      slug: 'unmerged',
      cwd: repoRoot,
      worktreesDir,
    })
    const wtPath = join(worktreesDir, '999-unmerged')
    writeFileSync(join(wtPath, 'work.txt'), 'wip')
    execFileSync('git', ['add', '.'], { cwd: wtPath, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'wip'], {
      cwd: wtPath,
      stdio: 'ignore',
    })

    runWorktreeClose({
      taskId: '#999',
      force: true,
      cwd: repoRoot,
      noFetch: true,
    })

    expect(existsSync(wtPath)).toBe(false)
  })

  it('detects dangling symlinks and reports them (does not throw)', async () => {
    // .env is untracked (as in a real project where it's gitignored), so open
    // must permit it. Removing the target leaves a dangling, untracked symlink.
    const envPath = join(repoRoot, '.env')
    writeFileSync(envPath, 'SECRET=1')

    await openAndMerge('#999', 'dangling')

    // Remove .env from the main repo AFTER opening — symlink in worktree now dangles
    rmSync(envPath)

    const warnings: string[] = []
    runWorktreeClose({
      taskId: '#999',
      cwd: repoRoot,
      noFetch: true,
      force: true,
      onWarning: (w) => warnings.push(w),
    })

    expect(warnings.some((w) => w.includes('.env'))).toBe(true)
    expect(existsSync(join(worktreesDir, '999-dangling'))).toBe(false)
  })

  it('invokes the close hook and passes the worktree path', async () => {
    await openAndMerge('#999', 'hook')

    // Write a simple hook script that records its argument
    const hookLog = join(repoRoot, 'hook-was-called.txt')
    const hookScript = join(repoRoot, 'close-hook.sh')
    writeFileSync(hookScript, `#!/bin/sh\necho "$1" > "${hookLog}"\n`)
    execFileSync('chmod', ['+x', hookScript])

    // Write arbiter.json with hook configured
    writeFileSync(
      join(repoRoot, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L1',
        useGitHub: false,
        worktree: {
          base: worktreesDir,
          links: [],
          closeHook: './close-hook.sh',
        },
      }),
    )

    runWorktreeClose({ taskId: '#999', cwd: repoRoot, noFetch: true })

    expect(existsSync(hookLog)).toBe(true)
    const wtPath = join(worktreesDir, '999-hook')
    expect(readFileSync(hookLog, 'utf-8').trim()).toBe(resolve(wtPath))
  })

  it('aborts close (without --force) when close hook exits non-zero', async () => {
    await openAndMerge('#999', 'hookfail')

    const hookScript = join(repoRoot, 'fail-hook.sh')
    writeFileSync(hookScript, '#!/bin/sh\nexit 1\n')
    execFileSync('chmod', ['+x', hookScript])

    writeFileSync(
      join(repoRoot, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L1',
        useGitHub: false,
        worktree: {
          base: worktreesDir,
          links: [],
          closeHook: './fail-hook.sh',
        },
      }),
    )

    expect(() => runWorktreeClose({ taskId: '#999', cwd: repoRoot, noFetch: true })).toThrow(
      /close hook failed/i,
    )

    // Worktree must still be present
    expect(existsSync(join(worktreesDir, '999-hookfail'))).toBe(true)
  })

  it('emits warning callback but does not throw when close hook fails under --force', async () => {
    await openAndMerge('#999', 'hookforce')

    const hookScript = join(repoRoot, 'fail-hook-force.sh')
    writeFileSync(hookScript, '#!/bin/sh\nexit 1\n')
    execFileSync('chmod', ['+x', hookScript])

    writeFileSync(
      join(repoRoot, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L1',
        useGitHub: false,
        worktree: {
          base: worktreesDir,
          links: [],
          closeHook: './fail-hook-force.sh',
        },
      }),
    )

    const warnings: string[] = []

    expect(() =>
      runWorktreeClose({
        taskId: '#999',
        force: true,
        cwd: repoRoot,
        noFetch: true,
        onWarning: (warning) => warnings.push(warning),
      }),
    ).not.toThrow()

    expect(warnings.join('\n')).toMatch(/close hook failed/i)
    // Worktree should be removed despite hook failure
    expect(existsSync(join(worktreesDir, '999-hookforce'))).toBe(false)
  })

  it('refuses when no open log entry exists for the task', async () => {
    expect(() => runWorktreeClose({ taskId: '#000', cwd: repoRoot })).toThrow(/no open worktree/i)
  })

  it('closes the second worktree when two share the same task id', async () => {
    // Open two worktrees for the same task id with different slugs
    await openAndMerge('#999', 'first')
    await openAndMerge('#999', 'second')

    // Close the first — picks the first matching open-log entry
    runWorktreeClose({ taskId: '#999', cwd: repoRoot, noFetch: true })
    expect(existsSync(join(worktreesDir, '999-first'))).toBe(false)
    expect(existsSync(join(worktreesDir, '999-second'))).toBe(true)

    // Close the second — must skip the stale first entry and find the second
    runWorktreeClose({ taskId: '#999', cwd: repoRoot, noFetch: true })
    expect(existsSync(join(worktreesDir, '999-second'))).toBe(false)
  })
})

describe('runWorktreeClose --harvest', () => {
  it('harvests modified files back to main repo before closing', async () => {
    await runWorktreeOpen({
      taskId: '#888',
      slug: 'harvest',
      cwd: repoRoot,
      worktreesDir,
    })
    const wtPath = join(worktreesDir, '888-harvest')

    // Create a tracked file in main repo and commit it
    mkdirSync(join(repoRoot, 'src'), { recursive: true })
    writeFileSync(join(repoRoot, 'src/app.ts'), 'original')
    execFileSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'add app.ts'], {
      cwd: repoRoot,
      stdio: 'ignore',
    })

    // Pull the commit into the worktree branch
    execFileSync('git', ['merge', 'main'], { cwd: wtPath, stdio: 'ignore' })

    // Modify the file in the worktree (unstaged)
    writeFileSync(join(wtPath, 'src/app.ts'), 'modified-in-wt')

    // Use harvestAll to skip merge check (branch isn't merged)
    const harvested: string[] = []
    runWorktreeClose({
      taskId: '#888',
      harvestAll: true,
      cwd: repoRoot,
      noFetch: true,
      onHarvestFile: (file, action) => {
        if (action === 'copy') harvested.push(file)
      },
    })

    expect(harvested).toContain('src/app.ts')
    expect(readFileSync(join(repoRoot, 'src/app.ts'), 'utf-8')).toBe('modified-in-wt')
    expect(existsSync(wtPath)).toBe(false)
  })

  it('harvests new (untracked) files back to main repo', async () => {
    await runWorktreeOpen({
      taskId: '#887',
      slug: 'harvest-new',
      cwd: repoRoot,
      worktreesDir,
    })
    const wtPath = join(worktreesDir, '887-harvest-new')

    // Create a new file in the worktree (untracked)
    mkdirSync(join(wtPath, 'src'), { recursive: true })
    writeFileSync(join(wtPath, 'src', 'new-feature.ts'), 'new content')

    // Use harvestAll to skip merge check
    const harvested: string[] = []
    runWorktreeClose({
      taskId: '#887',
      harvestAll: true,
      cwd: repoRoot,
      noFetch: true,
      onHarvestFile: (file, action) => {
        if (action === 'copy') harvested.push(file)
      },
    })

    expect(harvested).toContain('src/new-feature.ts')
    expect(existsSync(join(repoRoot, 'src', 'new-feature.ts'))).toBe(true)
  })

  it('harvestAll skips merge check', async () => {
    await runWorktreeOpen({
      taskId: '#886',
      slug: 'harvest-force',
      cwd: repoRoot,
      worktreesDir,
    })
    const wtPath = join(worktreesDir, '886-harvest-force')

    // Don't merge the branch — harvestAll should still close
    writeFileSync(join(wtPath, 'work.txt'), 'wip')

    runWorktreeClose({
      taskId: '#886',
      harvestAll: true,
      cwd: repoRoot,
      noFetch: true,
    })

    expect(existsSync(wtPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// #307 — readJsonArray backs up corrupt open log
// ---------------------------------------------------------------------------

describe('#307 corrupt open log backup', () => {
  it('renames corrupt log to .corrupt file and proceeds', async () => {
    const logDir = join(repoRoot, '.arbiter')
    mkdirSync(logDir, { recursive: true })
    const logPath = join(logDir, 'worktree-open.log.json')
    writeFileSync(logPath, '{not valid json[[', 'utf-8')

    expect(() => runWorktreeClose({ taskId: '#307', cwd: repoRoot, noFetch: true })).toThrow(
      /no open worktree/i,
    )

    // Original log file must be gone (renamed)
    expect(existsSync(logPath)).toBe(false)
    // A .corrupt-* backup must exist
    const files = readdirSync(logDir)
    expect(files.some((f) => f.startsWith('worktree-open.log.json.corrupt-'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// #313 — harvestAll close log force field + bypass warning
// ---------------------------------------------------------------------------

describe('#313 harvestAll close log and warning', () => {
  it('records force=true in close log even when opts.force is false', async () => {
    await runWorktreeOpen({
      taskId: '#313a',
      slug: 'harvest-log',
      cwd: repoRoot,
      worktreesDir,
    })

    runWorktreeClose({
      taskId: '#313a',
      harvestAll: true,
      cwd: repoRoot,
      noFetch: true,
    })

    const logPath = join(repoRoot, '.arbiter', 'worktree-close.log.json')
    const entries = JSON.parse(readFileSync(logPath, 'utf-8')) as Array<Record<string, unknown>>
    const entry = entries.find((e) => e['taskId'] === '#313a')
    expect(entry?.['force']).toBe(true)
  })

  it('emits harvest-all bypass warning to stderr', async () => {
    await runWorktreeOpen({
      taskId: '#313b',
      slug: 'harvest-warn',
      cwd: repoRoot,
      worktreesDir,
    })

    const stderrChunks: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: unknown, ...args: unknown[]) => {
      stderrChunks.push(String(chunk))
      return originalWrite(chunk, ...(args as Parameters<typeof originalWrite>))
    }

    try {
      runWorktreeClose({
        taskId: '#313b',
        harvestAll: true,
        cwd: repoRoot,
        noFetch: true,
      })
    } finally {
      process.stderr.write = originalWrite
    }

    expect(stderrChunks.join('')).toMatch(/harvest-all/i)
  })
})

// ---------------------------------------------------------------------------
// #314 — stale log entry is pruned with distinct message
// ---------------------------------------------------------------------------

describe('#314 stale log entry pruning', () => {
  it('prunes stale entry and throws with informative error', async () => {
    // Write a log entry that points to a non-existent directory
    const logDir = join(repoRoot, '.arbiter')
    mkdirSync(logDir, { recursive: true })
    const logPath = join(logDir, 'worktree-open.log.json')
    const fakeEntry = {
      taskId: '#314',
      slug: 'gone',
      worktreePath: join(worktreesDir, '314-gone-deleted'),
      branch: 'task/#314-gone',
      baseBranch: 'main',
      baseRef: 'abc1234',
      openedAt: new Date().toISOString(),
    }
    writeFileSync(logPath, JSON.stringify([fakeEntry], null, 2), 'utf-8')

    const stderrChunks: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: unknown, ...args: unknown[]) => {
      stderrChunks.push(String(chunk))
      return originalWrite(chunk, ...(args as Parameters<typeof originalWrite>))
    }

    try {
      expect(() => runWorktreeClose({ taskId: '#314', cwd: repoRoot, noFetch: true })).toThrow(
        /no open worktree/i,
      )
    } finally {
      process.stderr.write = originalWrite
    }

    // Stale message emitted to stderr
    expect(stderrChunks.join('')).toMatch(/stale log entry/i)

    // Log entry must be pruned
    const remaining = JSON.parse(readFileSync(logPath, 'utf-8')) as unknown[]
    expect(remaining).toHaveLength(0)
  })
})
