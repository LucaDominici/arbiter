// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/gen-llms-txt.test.ts
// #1721: generator-emitted llms.txt with --check drift mode (dogfood).
// Tests: exported buildLlmsTxt() + readDocCount() + findMissingPaths() + runCli() --check CLI.

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildLlmsTxt,
  readDocCount,
  readInvMax,
  buildCommandsRunbookList,
  findMissingPaths,
  runCli,
} from '../../scripts/gen-llms-txt.mjs'

const SCRIPT = resolve('scripts/gen-llms-txt.mjs')

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gen-llms-txt-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Minimal valid config: one section, one entry, {{docCount}} in the description. */
function minimalConfig(root: string) {
  writeFileSync(join(root, 'real-file.md'), '# hi\n')
  return {
    title: 'arbiter',
    summary: 'Summary text.',
    intro: 'Intro paragraph.',
    sections: [
      {
        heading: 'Core governance',
        entries: [
          { label: 'real-file.md', path: 'real-file.md', description: 'Has {{docCount}} docs.' },
        ],
      },
    ],
  }
}

function writeIndex(root: string, count: number): string {
  const indexPath = join(root, 'INDEX.md')
  writeFileSync(indexPath, `# Documentation Index\n\n${count} documents.\n`)
  return indexPath
}

// ---------------------------------------------------------------------------
// idempotency guard — the RED anchor: generator output must equal the
// committed repo-root llms.txt, built from the committed llms-txt.config.json
// and the LIVE docs/INDEX.md doc count.
// ---------------------------------------------------------------------------

describe('idempotency guard (repo-root artifacts)', () => {
  it('generator output equals the committed repo-root llms.txt', () => {
    const configPath = resolve('llms-txt.config.json')
    const indexPath = resolve('docs/INDEX.md')
    const outPath = resolve('llms.txt')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const docCount = readDocCount(indexPath)
    const invMax = readInvMax(resolve('src/invariants/catalog.ts'))
    const names = readdirSync(resolve('.claude/commands'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort()
    const selfOnly = JSON.parse(
      readFileSync(resolve('scripts/data/self-only-surfaces.json'), 'utf-8'),
    )
    const commandsList = buildCommandsRunbookList(names, selfOnly)
    const generated = buildLlmsTxt(config, { docCount, invMax, commandsList })
    const committed = readFileSync(outPath, 'utf-8')
    expect(generated).toBe(committed)
  })
})

// ---------------------------------------------------------------------------
// buildLlmsTxt()
// ---------------------------------------------------------------------------

describe('buildLlmsTxt()', () => {
  it('produces output with no trailing newline', () => {
    const config = {
      title: 'x',
      summary: 's',
      intro: 'i',
      sections: [{ heading: 'H', entries: [{ label: 'a', path: 'a', description: 'd' }] }],
    }
    const out = buildLlmsTxt(config, { docCount: 1 })
    expect(out.endsWith('\n')).toBe(false)
  })

  it('renders the H1, blockquote summary, and intro paragraph in order', () => {
    const config = {
      title: 'arbiter',
      summary: 'My summary.',
      intro: 'My intro.',
      sections: [{ heading: 'H', entries: [{ label: 'a', path: 'a', description: 'd' }] }],
    }
    const out = buildLlmsTxt(config, { docCount: 1 })
    expect(out.startsWith('# arbiter\n\n> My summary.\n\nMy intro.\n\n')).toBe(true)
  })

  it('renders each section as a ## heading followed by uniform bullets', () => {
    const config = {
      title: 'arbiter',
      summary: 's',
      intro: 'i',
      sections: [
        {
          heading: 'Core governance',
          entries: [{ label: 'AGENTS.md', path: 'AGENTS.md', description: 'Read first.' }],
        },
        {
          heading: 'Optional',
          entries: [{ label: 'wiki/', path: 'wiki/', description: 'Generated wiki.' }],
        },
      ],
    }
    const out = buildLlmsTxt(config, { docCount: 1 })
    expect(out).toContain('## Core governance\n\n- [AGENTS.md](AGENTS.md): Read first.')
    expect(out).toContain('## Optional\n\n- [wiki/](wiki/): Generated wiki.')
    // sections are separated by a single blank line
    expect(out).toContain('Read first.\n\n## Optional')
  })

  it('substitutes {{docCount}} with the injected count and leaves no token behind', () => {
    const config = {
      title: 'arbiter',
      summary: 's',
      intro: 'i',
      sections: [
        {
          heading: 'H',
          entries: [
            { label: 'docs/INDEX.md', path: 'docs/INDEX.md', description: '{{docCount}} docs.' },
          ],
        },
      ],
    }
    const out = buildLlmsTxt(config, { docCount: 166 })
    expect(out).toContain('166 docs.')
    expect(out).not.toContain('{{docCount}}')
  })

  it('renders extraLinks entries with multiple embedded links before the colon', () => {
    const config = {
      title: 'arbiter',
      summary: 's',
      intro: 'i',
      sections: [
        {
          heading: 'Optional',
          entries: [
            {
              label: 'CHANGELOG.md',
              path: 'CHANGELOG.md',
              extraLinks: [
                ['ROADMAP.md', 'ROADMAP.md'],
                ['CONTRIBUTING.md', 'CONTRIBUTING.md'],
              ],
              description: 'Standard project metadata.',
            },
          ],
        },
      ],
    }
    const out = buildLlmsTxt(config, { docCount: 1 })
    expect(out).toContain(
      '- [CHANGELOG.md](CHANGELOG.md), [ROADMAP.md](ROADMAP.md), [CONTRIBUTING.md](CONTRIBUTING.md): Standard project metadata.',
    )
  })

  it('the real committed config renders exactly 20 bullets', () => {
    const config = JSON.parse(readFileSync(resolve('llms-txt.config.json'), 'utf-8'))
    const invMax = readInvMax(resolve('src/invariants/catalog.ts'))
    const names = readdirSync(resolve('.claude/commands'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort()
    const selfOnly = JSON.parse(
      readFileSync(resolve('scripts/data/self-only-surfaces.json'), 'utf-8'),
    )
    const commandsList = buildCommandsRunbookList(names, selfOnly)
    const out = buildLlmsTxt(config, { docCount: 1, invMax, commandsList })
    const bulletLines = out.split('\n').filter((l) => l.startsWith('- '))
    expect(bulletLines).toHaveLength(20)
  })
})

// ---------------------------------------------------------------------------
// readDocCount()
// ---------------------------------------------------------------------------

describe('readDocCount()', () => {
  it('parses the doc count from a well-formed docs/INDEX.md', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const indexPath = writeIndex(dir, 166)
      expect(readDocCount(indexPath)).toBe(166)
    } finally {
      cleanup()
    }
  })

  it('throws on a malformed INDEX.md (fail-closed)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const indexPath = join(dir, 'INDEX.md')
      writeFileSync(indexPath, '# no count line here\n')
      expect(() => readDocCount(indexPath)).toThrow()
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// readInvMax() — #2417: invariant range read from the catalog max, never
// hand-typed.
// ---------------------------------------------------------------------------

describe('readInvMax()', () => {
  it('parses the highest INV-NN id from a catalog.ts fixture', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalogPath = join(dir, 'catalog.ts')
      writeFileSync(
        catalogPath,
        "export const catalog = [{ id: 'INV-01' }, { id: 'INV-07' }, { id: 'INV-139' }, { id: 'INV-42' }]\n",
      )
      expect(readInvMax(catalogPath)).toBe(139)
    } finally {
      cleanup()
    }
  })

  it('throws when no INV-NN id is found (fail-closed)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalogPath = join(dir, 'catalog.ts')
      writeFileSync(catalogPath, 'export const catalog = []\n')
      expect(() => readInvMax(catalogPath)).toThrow()
    } finally {
      cleanup()
    }
  })

  it('the real src/invariants/catalog.ts max matches the live catalog', () => {
    // Cross-check against the same extraction the repo's own parity gate uses
    // (scripts/check-catalog-agents-parity.mjs) so this never silently drifts.
    const src = readFileSync(resolve('src/invariants/catalog.ts'), 'utf-8')
    const ids = [...src.matchAll(/id:\s*'INV-(\d+)'/g)].map((m) => Number(m[1]))
    const expectedMax = Math.max(...ids)
    expect(readInvMax(resolve('src/invariants/catalog.ts'))).toBe(expectedMax)
  })
})

// ---------------------------------------------------------------------------
// buildCommandsRunbookList() — #2417 AC-1/AC-2: self-only manifest consumed
// by the runbook list, marking self-only commands instead of hand-listing.
// ---------------------------------------------------------------------------

describe('buildCommandsRunbookList()', () => {
  it('marks self-only commands and leaves emitted ones unmarked', () => {
    const list = buildCommandsRunbookList(['drain', 'gap', 'ship'], { commands: ['gap'] })
    expect(list).toContain('[drain.md](.claude/commands/drain.md)')
    expect(list).not.toMatch(/drain\.md\)[^,]*self-only/)
    expect(list).toMatch(/gap\.md\).*self-only/)
  })

  it('the real .claude/commands/ + self-only-surfaces.json produce a mark for every self-only command', () => {
    const names = readdirSync(resolve('.claude/commands'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort()
    const selfOnly = JSON.parse(
      readFileSync(resolve('scripts/data/self-only-surfaces.json'), 'utf-8'),
    )
    const list = buildCommandsRunbookList(names, selfOnly)
    for (const name of selfOnly.commands) {
      expect(list).toMatch(new RegExp(`${name}\\.md\\).*self-only`))
    }
  })
})

// ---------------------------------------------------------------------------
// findMissingPaths()
// ---------------------------------------------------------------------------

describe('findMissingPaths()', () => {
  it('returns [] when every entry path (file or dir, trailing-slash stripped) exists', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'somedir'))
      writeFileSync(join(dir, 'somefile.md'), 'x')
      const config = {
        title: 't',
        summary: 's',
        intro: 'i',
        sections: [
          {
            heading: 'H',
            entries: [
              { label: 'somefile.md', path: 'somefile.md', description: 'd' },
              { label: 'somedir/', path: 'somedir/', description: 'd' },
            ],
          },
        ],
      }
      expect(findMissingPaths(config, dir)).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('reports a non-existent entry path', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const config = {
        title: 't',
        summary: 's',
        intro: 'i',
        sections: [
          {
            heading: 'H',
            entries: [{ label: 'ghost.md', path: 'ghost.md', description: 'd' }],
          },
        ],
      }
      expect(findMissingPaths(config, dir)).toEqual(['ghost.md'])
    } finally {
      cleanup()
    }
  })

  it('validates relative markdown links embedded in description prose', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'commands'))
      const config = {
        title: 't',
        summary: 's',
        intro: 'i',
        sections: [
          {
            heading: 'H',
            entries: [
              {
                label: 'commands/',
                path: 'commands',
                description: 'See [ship.md](.claude/commands/ship.md) for details.',
              },
            ],
          },
        ],
      }
      expect(findMissingPaths(config, dir)).toEqual(['.claude/commands/ship.md'])
    } finally {
      cleanup()
    }
  })

  it('ignores http(s) URLs and anchor-only links inside description prose', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'commands'))
      const config = {
        title: 't',
        summary: 's',
        intro: 'i',
        sections: [
          {
            heading: 'H',
            entries: [
              {
                label: 'commands/',
                path: 'commands',
                description:
                  'See [llmstxt.org](https://llmstxt.org) and [anchor](#section) for details.',
              },
            ],
          },
        ],
      }
      expect(findMissingPaths(config, dir)).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('validates extraLinks paths too', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeFileSync(join(dir, 'a.md'), 'x')
      const config = {
        title: 't',
        summary: 's',
        intro: 'i',
        sections: [
          {
            heading: 'H',
            entries: [
              {
                label: 'a.md',
                path: 'a.md',
                extraLinks: [['ghost.md', 'ghost.md']],
                description: 'd',
              },
            ],
          },
        ],
      }
      expect(findMissingPaths(config, dir)).toEqual(['ghost.md'])
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// runCli() — exported CLI logic (in-process)
// ---------------------------------------------------------------------------

describe('runCli()', () => {
  it('write mode: writes llms.txt and returns 0', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const configPath = join(dir, 'llms-txt.config.json')
      writeFileSync(configPath, JSON.stringify(minimalConfig(dir)))
      const indexPath = writeIndex(dir, 3)
      const outPath = join(dir, 'llms.txt')
      const code = await runCli(configPath, indexPath, outPath, false)
      expect(code).toBe(0)
      expect(existsSync(outPath)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('--check: returns 0 when fresh', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const configPath = join(dir, 'llms-txt.config.json')
      writeFileSync(configPath, JSON.stringify(minimalConfig(dir)))
      const indexPath = writeIndex(dir, 3)
      const outPath = join(dir, 'llms.txt')
      await runCli(configPath, indexPath, outPath, false)
      const code = await runCli(configPath, indexPath, outPath, true)
      expect(code).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('--check: returns 1 and mentions "stale" when llms.txt drifts', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const configPath = join(dir, 'llms-txt.config.json')
      writeFileSync(configPath, JSON.stringify(minimalConfig(dir)))
      const indexPath = writeIndex(dir, 3)
      const outPath = join(dir, 'llms.txt')
      await runCli(configPath, indexPath, outPath, false)
      writeFileSync(outPath, 'mutated content')
      const result = spawnSync(
        'node',
        [SCRIPT, '--check', `--config=${configPath}`, `--index=${indexPath}`, `--out=${outPath}`],
        { encoding: 'utf-8' },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('stale')
    } finally {
      cleanup()
    }
  })

  it('--check: returns 1 when the docs/INDEX.md count drifts after llms.txt was written', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const configPath = join(dir, 'llms-txt.config.json')
      writeFileSync(configPath, JSON.stringify(minimalConfig(dir)))
      const indexPath = writeIndex(dir, 3)
      const outPath = join(dir, 'llms.txt')
      await runCli(configPath, indexPath, outPath, false)
      writeIndex(dir, 4) // a doc was added/removed but llms.txt was not regenerated
      const code = await runCli(configPath, indexPath, outPath, true)
      expect(code).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('returns 2 when the config file is missing', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const indexPath = writeIndex(dir, 3)
      const code = await runCli(join(dir, 'nope.json'), indexPath, join(dir, 'llms.txt'), false)
      expect(code).toBe(2)
    } finally {
      cleanup()
    }
  })

  it('returns 2 on invalid JSON in the config file', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const configPath = join(dir, 'llms-txt.config.json')
      writeFileSync(configPath, '{ not json')
      const indexPath = writeIndex(dir, 3)
      const code = await runCli(configPath, indexPath, join(dir, 'llms.txt'), false)
      expect(code).toBe(2)
    } finally {
      cleanup()
    }
  })

  it('returns 2 when docs/INDEX.md is unparseable', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const configPath = join(dir, 'llms-txt.config.json')
      writeFileSync(configPath, JSON.stringify(minimalConfig(dir)))
      const indexPath = join(dir, 'INDEX.md')
      writeFileSync(indexPath, '# no count\n')
      const code = await runCli(configPath, indexPath, join(dir, 'llms.txt'), false)
      expect(code).toBe(2)
    } finally {
      cleanup()
    }
  })

  it('returns 2 when a config entry references a non-existent path', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const configPath = join(dir, 'llms-txt.config.json')
      const config = minimalConfig(dir)
      config.sections[0].entries.push({
        label: 'ghost.md',
        path: 'ghost.md',
        description: 'missing',
      })
      writeFileSync(configPath, JSON.stringify(config))
      const indexPath = writeIndex(dir, 3)
      const code = await runCli(configPath, indexPath, join(dir, 'llms.txt'), false)
      expect(code).toBe(2)
    } finally {
      cleanup()
    }
  })
})
