import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildCodexArgs, buildCodexReviewArgs } from '../../scripts/lib/codex-dispatch-lib.mjs'

const LIB_PATH = join(__dirname, '../../scripts/lib/codex-dispatch-lib.mjs')

function makeWorktree() {
  const hub = mkdtempSync(join(tmpdir(), 'codex-dispatch-'))
  const worktree = join(hub, 'writer')
  const brief = join(hub, 'brief.txt')
  const out = join(hub, 'out.txt')
  execFileSync('git', ['init'], { cwd: hub })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: hub })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: hub })
  writeFileSync(join(hub, 'README.md'), 'fixture\n')
  execFileSync('git', ['add', 'README.md'], { cwd: hub })
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: hub })
  execFileSync('git', ['worktree', 'add', '-b', 'writer', worktree], { cwd: hub })
  mkdirSync(join(worktree, 'node_modules', '.vite-temp'), { recursive: true })
  writeFileSync(brief, 'reply with ok')
  return { hub, worktree, brief, out, cleanup: () => rmSync(hub, { recursive: true, force: true }) }
}

describe('codex dispatch argument builder', () => {
  it('builds a fresh writer command with its real Git and Vite paths', () => {
    const fixture = makeWorktree()
    try {
      const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: fixture.worktree,
        encoding: 'utf8',
      }).trim()
      const commonDir = execFileSync(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        {
          cwd: fixture.worktree,
          encoding: 'utf8',
        },
      ).trim()
      const args = buildCodexArgs({
        worktreePath: fixture.worktree,
        model: 'gpt-5.6-terra',
        effort: 'low',
        gitDir,
        commonGitDir: commonDir,
        briefText: 'reply with ok',
        outPath: fixture.out,
      })

      const viteTempDir = join(fixture.worktree, 'node_modules', '.vite-temp')
      const writableRootsArg = `sandbox_workspace_write.writable_roots=${JSON.stringify([
        commonDir,
        gitDir,
        viteTempDir,
      ])}`
      const writableRootsIndex = args.indexOf(writableRootsArg)

      expect(args).toContain('approval_policy=never')
      expect(args).toContain('-s')
      expect(args[args.indexOf('-s') + 1]).toBe('workspace-write')
      expect(writableRootsIndex).toBeGreaterThan(0)
      expect(args[writableRootsIndex - 1]).toBe('-c')
      expect(args.some((arg) => arg.startsWith('--'))).toBe(false)
      expect(args.at(-1)).toBe('reply with ok')
    } finally {
      fixture.cleanup()
    }
  })

  it('deduplicates the common and worktree Git directory when they are equal', () => {
    const args = buildCodexArgs({
      worktreePath: '/tmp/codex-dispatch-worktree',
      model: 'gpt-5.6-terra',
      effort: 'low',
      gitDir: '/repo/.git',
      commonGitDir: '/repo/.git',
      briefText: 'reply with ok',
      outPath: '/tmp/codex-dispatch-out.txt',
    })

    expect(args).toContain(
      `sandbox_workspace_write.writable_roots=${JSON.stringify([
        '/repo/.git',
        '/tmp/codex-dispatch-worktree/node_modules/.vite-temp',
      ])}`,
    )
  })

  it('omits fresh sandbox plumbing when resuming', () => {
    const fixture = makeWorktree()
    try {
      const args = buildCodexArgs({
        worktreePath: fixture.worktree,
        model: 'gpt-5.6-terra',
        effort: 'low',
        briefText: 'reply with ok',
        outPath: fixture.out,
        resumeSessionId: 'session-123',
      })

      expect(args.slice(0, 3)).toEqual(['exec', 'resume', 'session-123'])
      expect(args).not.toContain('-s')
      expect(args.some((arg) => arg.startsWith('sandbox_workspace_write.'))).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  it('builds read-only reviewer commands without writer directories', () => {
    const args = buildCodexReviewArgs({
      model: 'gpt-5.6-terra',
      effort: 'low',
      outPath: '/tmp/review.txt',
    })

    expect(args).toContain('-s')
    expect(args[args.indexOf('-s') + 1]).toBe('read-only')
    expect(args.some((arg) => arg.startsWith('sandbox_workspace_write.'))).toBe(false)
    expect(args).toContain('approval_policy=never')
  })

  it('stays a pure argv builder (CANON-25 proof for its fail-closed-audit exemption)', () => {
    // codex-dispatch-lib.mjs is exempted from the fail-closed try/catch contract on the
    // claim that it does no I/O at all — the caller (codex-dispatch.mjs, which owns the
    // try/catch) resolves every path and reads the brief before calling in. A regex allowlist
    // over the raw text (#2770's first fix attempt) still parses source with a hand-rolled
    // grammar: a comment between `from` and the string (`from/* x */'node:fs'`), a bare
    // `import 'node:fs'`, or `export * from 'node:fs'` all slip through `/from\s+['"]/`
    // because `\s` isn't "whatever JS treats as whitespace between tokens" — a real parser
    // is. Walk the AST instead (TypeScript's compiler, already a devDependency) so every
    // static import/re-export form is caught by construction, not by an ad hoc pattern.
    const source = readFileSync(LIB_PATH, 'utf8')
    const sourceFile = ts.createSourceFile(LIB_PATH, source, ts.ScriptTarget.Latest, true)
    const specifiers: string[] = []
    let hasDynamicImport = false
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifiers.push(node.moduleSpecifier.text)
      }
      if (
        node.kind === ts.SyntaxKind.ImportKeyword &&
        node.parent &&
        ts.isCallExpression(node.parent)
      ) {
        hasDynamicImport = true
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    expect(specifiers).toEqual(['node:path'])
    expect(hasDynamicImport).toBe(false)
    // Defense-in-depth against the two known import-free Node escape hatches (no import
    // statement exists for a parser to catch): the CommonJS interop global and the
    // builtin-module lookup added in Node 20/22.
    // ponytail: substring check, not exhaustive against every future Node API — the AST walk
    // above is the real proof for static imports; this only closes the two known holes.
    expect(source).not.toMatch(/\brequire\s*\(/)
    expect(source).not.toMatch(/\bprocess\.getBuiltinModule\b/)
  })
})
