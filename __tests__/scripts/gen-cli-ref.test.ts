import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/gen-cli-ref.mjs')

interface RunResult {
  status: number
  stdout: string
}

function run(args: string[], cwd: string): RunResult {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: (r.stdout ?? '') + (r.stderr ?? '') }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gen-cli-ref-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const MARKERS = { begin: '<!-- BEGIN GENERATED:cli -->', end: '<!-- END GENERATED:cli -->' }

function makeCliTs(dir: string, commands: { name: string; desc: string }[]): void {
  const cmds = commands
    .map((c) => `  program.command('${c.name}').description('${c.desc}')`)
    .join('\n')
  writeFileSync(
    join(dir, 'cli.ts'),
    `import { Command } from 'commander'\nconst program = new Command()\n${cmds}\nprogram.parse()\n`,
  )
}

function makeCliMd(dir: string, generatedBody: string): void {
  writeFileSync(
    join(dir, 'cli.md'),
    `# CLI Reference\n\nIntro prose.\n\n${MARKERS.begin}\n${generatedBody}${MARKERS.end}\n\n## Common Workflows\n\nPreserved.\n`,
  )
}

describe('gen-cli-ref.mjs', () => {
  it('exits 2 when cli.ts does not exist', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeCliMd(dir, '')
      const { status, stdout } = run(
        [`--cli=${join(dir, 'cli.ts')}`, `--doc=${join(dir, 'cli.md')}`],
        dir,
      )
      expect(status).toBe(2)
      expect(stdout.toLowerCase()).toMatch(/not found|enoent|missing|does not exist/i)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when registered commands match generated region exactly (write then check)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeCliTs(dir, [
        { name: 'init', desc: 'Initialize arbiter' },
        { name: 'doctor', desc: 'Diagnose the project' },
      ])
      makeCliMd(dir, '')
      // Write mode: generates region
      const writeResult = run([`--cli=${join(dir, 'cli.ts')}`, `--doc=${join(dir, 'cli.md')}`], dir)
      expect(writeResult.status).toBe(0)
      // Check mode: should pass immediately after write
      const checkResult = run(
        ['--check', `--cli=${join(dir, 'cli.ts')}`, `--doc=${join(dir, 'cli.md')}`],
        dir,
      )
      expect(checkResult.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 in --check when a registered command is missing from the generated region', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeCliTs(dir, [{ name: 'init', desc: 'Initialize arbiter' }])
      makeCliMd(dir, '')
      // Write mode first (seeds the region for 'init')
      run([`--cli=${join(dir, 'cli.ts')}`, `--doc=${join(dir, 'cli.md')}`], dir)
      // Now add a new command to cli.ts without regenerating
      makeCliTs(dir, [
        { name: 'init', desc: 'Initialize arbiter' },
        { name: 'report', desc: 'Show a report' },
      ])
      // Check should detect 'report' is missing
      const { status, stdout } = run(
        ['--check', `--cli=${join(dir, 'cli.ts')}`, `--doc=${join(dir, 'cli.md')}`],
        dir,
      )
      expect(status).toBe(1)
      expect(stdout).toContain('report')
    } finally {
      cleanup()
    }
  })

  it('exits 1 in --check when generated region has a phantom command', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeCliTs(dir, [
        { name: 'init', desc: 'Initialize arbiter' },
        { name: 'ghost', desc: 'Ghost command' },
      ])
      makeCliMd(dir, '')
      // Write mode seeds region with 'init' + 'ghost'
      run([`--cli=${join(dir, 'cli.ts')}`, `--doc=${join(dir, 'cli.md')}`], dir)
      // Remove 'ghost' from cli.ts
      makeCliTs(dir, [{ name: 'init', desc: 'Initialize arbiter' }])
      // Check should detect 'ghost' is phantom
      const { status, stdout } = run(
        ['--check', `--cli=${join(dir, 'cli.ts')}`, `--doc=${join(dir, 'cli.md')}`],
        dir,
      )
      expect(status).toBe(1)
      expect(stdout).toContain('ghost')
    } finally {
      cleanup()
    }
  })

  it('write mode preserves prose outside the markers', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeCliTs(dir, [{ name: 'init', desc: 'Init project' }])
      makeCliMd(dir, '')
      run([`--cli=${join(dir, 'cli.ts')}`, `--doc=${join(dir, 'cli.md')}`], dir)
      const content = readFileSync(join(dir, 'cli.md'), 'utf-8')
      expect(content).toContain('Intro prose.')
      expect(content).toContain('## Common Workflows')
      expect(content).toContain('Preserved.')
    } finally {
      cleanup()
    }
  })

  it('exits 1 in --check when markers are absent from doc', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeCliTs(dir, [{ name: 'init', desc: 'Init project' }])
      // cli.md without markers
      writeFileSync(join(dir, 'cli.md'), '# CLI Reference\n\nNo markers here.\n')
      const { status, stdout } = run(
        ['--check', `--cli=${join(dir, 'cli.ts')}`, `--doc=${join(dir, 'cli.md')}`],
        dir,
      )
      expect(status).toBe(1)
      expect(stdout.toLowerCase()).toMatch(/marker|begin generated/i)
    } finally {
      cleanup()
    }
  })

  it('generated region includes the command name and description', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeCliTs(dir, [{ name: 'explain', desc: 'Explain a concept' }])
      makeCliMd(dir, '')
      run([`--cli=${join(dir, 'cli.ts')}`, `--doc=${join(dir, 'cli.md')}`], dir)
      const content = readFileSync(join(dir, 'cli.md'), 'utf-8')
      expect(content).toContain('explain')
      expect(content).toContain('Explain a concept')
    } finally {
      cleanup()
    }
  })
})
