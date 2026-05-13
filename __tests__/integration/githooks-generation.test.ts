import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { makeConfig } from '../helpers.js'
import { generateGithooks } from '../../src/generators/githooks.js'
import { generateCheckAll } from '../../src/generators/check-all.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-githooks-test-'))
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], {
    cwd: dir,
    stdio: 'ignore',
  })
}

function isExecutable(filePath: string): boolean {
  return (statSync(filePath).mode & 0o111) !== 0
}

describe('generateGithooks — typescript stack', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits .githooks/pre-commit', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    expect(existsSync(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit is executable', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    expect(isExecutable(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit calls L1 gate', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    const content = readFileSync(join(dir, '.githooks', 'pre-commit'), 'utf-8')
    expect(content).toContain('node scripts/check-all.mjs L1')
  })

  it('.githooks/pre-commit includes rsync workaround (TS-specific)', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    const content = readFileSync(join(dir, '.githooks', 'pre-commit'), 'utf-8')
    expect(content).toContain('rsync')
  })

  it('emits .githooks/pre-push', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    expect(existsSync(join(dir, '.githooks', 'pre-push'))).toBe(true)
  })

  it('.githooks/pre-push is executable', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    expect(isExecutable(join(dir, '.githooks', 'pre-push'))).toBe(true)
  })

  it('.githooks/pre-push calls L2 gate', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    const content = readFileSync(join(dir, '.githooks', 'pre-push'), 'utf-8')
    expect(content).toContain('node scripts/check-all.mjs L2')
  })

  it('emits .githooks/commit-msg', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    expect(existsSync(join(dir, '.githooks', 'commit-msg'))).toBe(true)
  })

  it('.githooks/commit-msg is executable', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    expect(isExecutable(join(dir, '.githooks', 'commit-msg'))).toBe(true)
  })

  it('.githooks/commit-msg runs commitlint', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    const content = readFileSync(join(dir, '.githooks', 'commit-msg'), 'utf-8')
    expect(content).toContain('commitlint')
  })

  it('injects prepare script into package.json for TS', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    // Provide an existing package.json
    const pkgPath = join(dir, 'package.json')
    const existingPkg = { name: 'test-project', scripts: {} }
    writeFileSync(pkgPath, JSON.stringify(existingPkg, null, 2))
    generateGithooks(config)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
    const scripts = pkg.scripts as Record<string, string>
    expect(scripts.prepare).toContain('git config core.hooksPath .githooks')
  })

  it('does NOT emit scripts/setup-hooks.sh for TS', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    expect(existsSync(join(dir, 'scripts', 'setup-hooks.sh'))).toBe(false)
  })

  it('appends git config core.hooksPath when prepare already has a value', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    const pkgPath = join(dir, 'package.json')
    const existingPkg = {
      name: 'test-project',
      scripts: { prepare: 'husky install' },
    }
    writeFileSync(pkgPath, JSON.stringify(existingPkg, null, 2))
    generateGithooks(config)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
    const scripts = pkg.scripts as Record<string, string>
    expect(scripts.prepare).toBe('husky install && git config core.hooksPath .githooks')
  })

  it('injects git config core.hooksPath exactly once on repeated calls', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    const pkgPath = join(dir, 'package.json')
    const existingPkg = { name: 'test-project', scripts: {} }
    writeFileSync(pkgPath, JSON.stringify(existingPkg, null, 2))

    generateGithooks(config)
    generateGithooks(config)

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
    const scripts = pkg.scripts as Record<string, string>
    const occurrences = (scripts.prepare.match(/git config core\.hooksPath \.githooks/g) ?? [])
      .length
    expect(occurrences).toBe(1)
  })
})

describe('generateGithooks — rust stack', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits .githooks/pre-commit for rust', () => {
    const config = makeConfig(dir, { language: 'rust', buildTool: 'cargo' })
    generateGithooks(config)
    expect(existsSync(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit is executable for rust', () => {
    const config = makeConfig(dir, { language: 'rust', buildTool: 'cargo' })
    generateGithooks(config)
    expect(isExecutable(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit calls L1 gate for rust', () => {
    const config = makeConfig(dir, { language: 'rust', buildTool: 'cargo' })
    generateGithooks(config)
    const content = readFileSync(join(dir, '.githooks', 'pre-commit'), 'utf-8')
    expect(content).toContain('node scripts/check-all.mjs L1')
  })

  it('.githooks/pre-commit does NOT include rsync for rust', () => {
    const config = makeConfig(dir, { language: 'rust', buildTool: 'cargo' })
    generateGithooks(config)
    const content = readFileSync(join(dir, '.githooks', 'pre-commit'), 'utf-8')
    expect(content).not.toContain('rsync')
  })

  it('emits scripts/setup-hooks.sh for rust (non-Node)', () => {
    const config = makeConfig(dir, { language: 'rust', buildTool: 'cargo' })
    generateGithooks(config)
    expect(existsSync(join(dir, 'scripts', 'setup-hooks.sh'))).toBe(true)
  })

  it('scripts/setup-hooks.sh is executable for rust', () => {
    const config = makeConfig(dir, { language: 'rust', buildTool: 'cargo' })
    generateGithooks(config)
    expect(isExecutable(join(dir, 'scripts', 'setup-hooks.sh'))).toBe(true)
  })

  it('commit-msg uses soft commitlint check for rust', () => {
    const config = makeConfig(dir, { language: 'rust', buildTool: 'cargo' })
    generateGithooks(config)
    const content = readFileSync(join(dir, '.githooks', 'commit-msg'), 'utf-8')
    // Non-TS: soft check with command -v npx
    expect(content).toContain('command -v npx')
    expect(content).toContain('commitlint')
  })
})

describe('generateGithooks — java-gradle stack', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits .githooks/pre-commit for java-gradle', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
    })
    generateGithooks(config)
    expect(existsSync(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit is executable for java-gradle', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
    })
    generateGithooks(config)
    expect(isExecutable(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit calls L1 gate for java-gradle', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
    })
    generateGithooks(config)
    const content = readFileSync(join(dir, '.githooks', 'pre-commit'), 'utf-8')
    expect(content).toContain('node scripts/check-all.mjs L1')
  })

  it('emits scripts/setup-hooks.sh for java-gradle', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
    })
    generateGithooks(config)
    expect(existsSync(join(dir, 'scripts', 'setup-hooks.sh'))).toBe(true)
  })
})

describe('generateGithooks — java-maven stack', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits .githooks/pre-commit for java-maven', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'maven',
    })
    generateGithooks(config)
    expect(existsSync(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit is executable for java-maven', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'maven',
    })
    generateGithooks(config)
    expect(isExecutable(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('emits scripts/setup-hooks.sh for java-maven', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'maven',
    })
    generateGithooks(config)
    expect(existsSync(join(dir, 'scripts', 'setup-hooks.sh'))).toBe(true)
  })
})

describe('generateGithooks — go stack', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits .githooks/pre-commit for go', () => {
    const config = makeConfig(dir, { language: 'go', buildTool: 'go' })
    generateGithooks(config)
    expect(existsSync(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit is executable for go', () => {
    const config = makeConfig(dir, { language: 'go', buildTool: 'go' })
    generateGithooks(config)
    expect(isExecutable(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit calls L1 gate for go', () => {
    const config = makeConfig(dir, { language: 'go', buildTool: 'go' })
    generateGithooks(config)
    const content = readFileSync(join(dir, '.githooks', 'pre-commit'), 'utf-8')
    expect(content).toContain('node scripts/check-all.mjs L1')
  })

  it('emits scripts/setup-hooks.sh for go', () => {
    const config = makeConfig(dir, { language: 'go', buildTool: 'go' })
    generateGithooks(config)
    expect(existsSync(join(dir, 'scripts', 'setup-hooks.sh'))).toBe(true)
  })
})

describe('generateGithooks — python stack', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits .githooks/pre-commit for python', () => {
    const config = makeConfig(dir, { language: 'python', buildTool: 'pip' })
    generateGithooks(config)
    expect(existsSync(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit is executable for python', () => {
    const config = makeConfig(dir, { language: 'python', buildTool: 'pip' })
    generateGithooks(config)
    expect(isExecutable(join(dir, '.githooks', 'pre-commit'))).toBe(true)
  })

  it('.githooks/pre-commit calls L1 gate for python', () => {
    const config = makeConfig(dir, { language: 'python', buildTool: 'pip' })
    generateGithooks(config)
    const content = readFileSync(join(dir, '.githooks', 'pre-commit'), 'utf-8')
    expect(content).toContain('node scripts/check-all.mjs L1')
  })

  it('emits scripts/setup-hooks.sh for python', () => {
    const config = makeConfig(dir, { language: 'python', buildTool: 'pip' })
    generateGithooks(config)
    expect(existsSync(join(dir, 'scripts', 'setup-hooks.sh'))).toBe(true)
  })
})

describe('generateGithooks — skipIfExists (idempotency)', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not overwrite existing .githooks/pre-commit on second run', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    const first = readFileSync(join(dir, '.githooks', 'pre-commit'), 'utf-8')

    generateGithooks(config)
    const second = readFileSync(join(dir, '.githooks', 'pre-commit'), 'utf-8')
    expect(second).toBe(first)
  })
})

describe('generateGithooks — empirical fail-fast spawn', () => {
  // This suite verifies that the generated pre-commit hook propagates a
  // non-zero exit code back to git when the L1 gate fails.
  //
  // Strategy: rather than running the full gate toolchain (which would
  // require tsc, eslint, vitest etc. in the tmpdir), we generate the hook
  // and check-all script, then OVERWRITE scripts/check-all.mjs with a
  // stub that unconditionally exits 1. This proves the hook shell chain
  // (pre-commit → node scripts/check-all.mjs L1) correctly propagates
  // non-zero exits — which is the invariant the spec demands.
  //
  // A real end-to-end test requires a fully installed Node.js project and
  // is deferred to the brownfield fixture suite (see real-projects/).

  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('pre-commit exits non-zero when L1 gate fails', () => {
    // 1. Generate hooks and the check-all script
    const config = makeConfig(dir, { language: 'typescript' })
    generateGithooks(config)
    generateCheckAll(config)

    // 2. Symlink node_modules so the TS node_modules guard passes
    const repoRoot = join(new URL('../../', import.meta.url).pathname)
    const nodeModulesTarget = join(repoRoot, 'node_modules')
    // Assert loudly if the source doesn't exist: a missing symlink target would
    // cause the node_modules guard to skip the hook (exit 0), making the
    // expect(result.status).not.toBe(0) assertion fail with a cryptic message.
    expect(existsSync(nodeModulesTarget)).toBe(true)
    symlinkSync(nodeModulesTarget, join(dir, 'node_modules'))

    // 3. Stub check-all.mjs to exit 1 unconditionally
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(
      join(dir, 'scripts', 'check-all.mjs'),
      '#!/usr/bin/env node\nprocess.exit(1);\n',
      'utf-8',
    )

    // 4. Configure git hooks path
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
      cwd: dir,
      stdio: 'ignore',
    })

    // 5. Spawn the pre-commit hook directly
    const result = spawnSync('bash', [join(dir, '.githooks', 'pre-commit')], {
      cwd: dir,
      encoding: 'utf-8',
    })

    expect(result.status).not.toBe(0)
  })
})
