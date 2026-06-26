// SPDX-License-Identifier: Apache-2.0
// TDD guard for #1331 — emission-coherence gate. Static lint of a generated tree:
// every referenced scripts/*.mjs / hooks.mjs handler / githook node script /
// workflow-invoked script EXISTS in the emission; workflows are SHA-pinned and
// every job is named. Unguarded-missing => always FAIL; guarded-missing => FAIL
// unless declared in optional-emissions.json (RT-02). Manifest entries require a
// rationale (RT-03). uses: ./ and docker:// skip the SHA-pin rule (RT-01).
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkEmissionCoherence } from '../../scripts/check-emission-coherence.mjs'

function makeTree(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'emission-coherence-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('checkEmissionCoherence (#1331)', () => {
  it('returns zero problems for a fully coherent tree', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': `runCheck('x', 'node', ['scripts/check-x.mjs'])`,
      'scripts/check-x.mjs': '// ok',
      '.claude/hooks/hooks.mjs': `const H = { Bash: ['stop-dangerous.mjs'] }`,
      '.claude/hooks/stop-dangerous.mjs': '// ok',
      '.githooks/pre-commit': `#!/bin/sh\nnode scripts/check-x.mjs`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('FAILs on an UNGUARDED missing script referenced by check-all (ghost)', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': `runCheck('x', 'node', ['scripts/check-ghost.mjs'])`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('check-ghost.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('a GUARDED missing reference NOT in the manifest still FAILs', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': `if (existsSync('scripts/check-opt.mjs')) { runCheck('o','node',['scripts/check-opt.mjs']); }`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('check-opt.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('a GUARDED missing reference listed in the manifest PASSes', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': `if (existsSync('scripts/check-opt.mjs')) { runCheck('o','node',['scripts/check-opt.mjs']); }`,
      'scripts/optional-emissions.json': JSON.stringify({
        optional: [{ path: 'scripts/check-opt.mjs', rationale: 'industry overlay only' }],
      }),
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('the manifest can NEVER silence an UNGUARDED missing reference (RT-02)', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': `runCheck('g', 'node', ['scripts/check-ghost.mjs'])`,
      'scripts/optional-emissions.json': JSON.stringify({
        optional: [{ path: 'scripts/check-ghost.mjs', rationale: 'sneaky' }],
      }),
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('check-ghost.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('FAILs a manifest entry with an empty/missing rationale (RT-03)', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': `if (existsSync('scripts/check-opt.mjs')) { runCheck('o','node',['scripts/check-opt.mjs']); }`,
      'scripts/optional-emissions.json': JSON.stringify({
        optional: [{ path: 'scripts/check-opt.mjs', rationale: '' }],
      }),
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => /rationale/i.test(p))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('FAILs on a hooks.mjs handler that is not emitted (dead config)', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// no script refs',
      '.claude/hooks/hooks.mjs': `const H = { Stop: ['ghost-banner.mjs'] }`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('ghost-banner.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('a githook node ref guarded by [ -f ] and listed in the manifest PASSes', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      'scripts/optional-emissions.json': JSON.stringify({
        optional: [{ path: 'scripts/ci-opt.mjs', rationale: 'L2+ only' }],
      }),
      '.githooks/pre-push': `#!/bin/sh\nif [ -f "scripts/ci-opt.mjs" ]; then\n  node scripts/ci-opt.mjs\nfi`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('a githook node ref guarded by [ -f ] but NOT in the manifest still FAILs', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      '.githooks/pre-push': `#!/bin/sh\nif [ -f "scripts/ci-opt.mjs" ]; then\n  node scripts/ci-opt.mjs\nfi`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('ci-opt.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('FAILs on a githook node script that is missing', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      '.githooks/pre-push': `#!/bin/sh\nnode scripts/ci-ghost.mjs`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('ci-ghost.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('FAILs on a non-SHA-pinned action in a workflow', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      '.github/workflows/ci.yml': `jobs:\n  build:\n    name: Build\n    steps:\n      - uses: actions/checkout@v4\n`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => /non-SHA pin/i.test(p))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('does NOT flag local (./) or docker:// uses refs as unpinned (RT-01)', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      '.github/workflows/ci.yml':
        `jobs:\n  build:\n    name: Build\n    steps:\n` +
        `      - uses: ./.github/actions/setup\n` +
        `      - uses: docker://alpine:3.20\n`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.filter((p) => /non-SHA pin/i.test(p))).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('FAILs on a workflow job with no name:', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      '.github/workflows/ci.yml': `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => /job "build" has no name/i.test(p))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('FAILs on a workflow-invoked scripts/*.mjs that is missing', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      '.github/workflows/ci.yml': `jobs:\n  build:\n    name: Build\n    steps:\n      - run: node scripts/ci-classify-changes.mjs\n`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('ci-classify-changes.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  // #1345 — Makefile recipe references are scanned; they are unguarded by
  // construction (a recipe line carries no existsSync/[ -f ] guard).
  it('FAILs on a Makefile recipe invoking a missing scripts/*.mjs (ghost)', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      Makefile: `evidence:\n\tnode scripts/done-evidence.mjs\n`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('done-evidence.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('PASSes a Makefile recipe whose referenced scripts/*.mjs is emitted', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      'scripts/done-evidence.mjs': '// ok',
      Makefile: `evidence:\n\tnode scripts/done-evidence.mjs\n`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('a Makefile reference can NEVER be silenced by the manifest (unguarded by construction)', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      'scripts/optional-emissions.json': JSON.stringify({
        optional: [{ path: 'scripts/done-evidence.mjs', rationale: 'sneaky' }],
      }),
      Makefile: `evidence:\n\tnode scripts/done-evidence.mjs\n`,
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('done-evidence.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  // #1345 — .claude/commands/*.md playbooks are scanned; command-doc references
  // are unguarded by construction.
  it('FAILs on a .claude/commands/*.md playbook referencing a missing scripts/*.mjs (ghost)', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      '.claude/commands/ship.md': 'Run `node scripts/route-auditors.mjs --size-floor Standard`.',
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('route-auditors.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('PASSes a command playbook whose referenced scripts/*.mjs is emitted', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      'scripts/done-evidence.mjs': '// ok',
      '.claude/commands/ship.md': 'Complete: `node scripts/done-evidence.mjs`.',
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('FAILs on a command playbook referencing a missing .claude/hooks/*.mjs', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      '.claude/commands/ship.md': 'See `.claude/hooks/ghost-hook.mjs` for details.',
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('ghost-hook.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('FAILs on a .claude/settings.json hook command pointing at a missing file', () => {
    const { dir, cleanup } = makeTree({
      'scripts/check-all.mjs': '// none',
      '.claude/settings.json': JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ command: 'node .claude/hooks/ghost.mjs' }] }] },
      }),
    })
    try {
      const { problems } = checkEmissionCoherence(dir)
      expect(problems.some((p) => p.includes('ghost.mjs'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  // #1518 — REVERSE coherence: an emitted gate script invoked by nothing is a dead
  // emission (the broader-than-template registry predicate case the forward gate misses).
  describe('reverse direction — emitted-but-unreferenced gate scripts (#1518)', () => {
    it('FAILs on a scripts/check-*.mjs that nothing references (dead emission)', () => {
      const { dir, cleanup } = makeTree({
        'scripts/check-all.mjs': '// references nothing',
        'scripts/check-orphan.mjs': '// emitted but never invoked',
      })
      try {
        const { problems } = checkEmissionCoherence(dir)
        expect(
          problems.some((p) => p.includes('check-orphan.mjs') && /never referenced/.test(p)),
        ).toBe(true)
      } finally {
        cleanup()
      }
    })

    it('PASSes when check-all.mjs references the emitted gate script', () => {
      const { dir, cleanup } = makeTree({
        'scripts/check-all.mjs': `runCheck('o', 'node', ['scripts/check-orphan.mjs'])`,
        'scripts/check-orphan.mjs': '// invoked',
      })
      try {
        const { problems } = checkEmissionCoherence(dir)
        expect(problems).toEqual([])
      } finally {
        cleanup()
      }
    })

    it('PASSes when only a workflow references the emitted gate script', () => {
      const { dir, cleanup } = makeTree({
        'scripts/check-all.mjs': '// none',
        'scripts/check-orphan.mjs': '// invoked by CI only',
        '.github/workflows/ci.yml': `jobs:\n  g:\n    name: Gate\n    steps:\n      - run: node scripts/check-orphan.mjs\n`,
      })
      try {
        const { problems } = checkEmissionCoherence(dir)
        expect(problems).toEqual([])
      } finally {
        cleanup()
      }
    })

    it('PASSes when another emitted script references it transitively', () => {
      const { dir, cleanup } = makeTree({
        'scripts/check-all.mjs': `runCheck('h', 'node', ['scripts/check-hub.mjs'])`,
        'scripts/check-hub.mjs': `import './check-orphan.mjs'`,
        'scripts/check-orphan.mjs': '// invoked transitively via the hub',
      })
      try {
        const { problems } = checkEmissionCoherence(dir)
        expect(problems).toEqual([])
      } finally {
        cleanup()
      }
    })

    it('PASSes a dead gate script that is allowlisted in optional-emissions.json', () => {
      const { dir, cleanup } = makeTree({
        'scripts/check-all.mjs': '// none',
        'scripts/check-overlay.mjs': '// industry overlay, referenced only in some configs',
        'scripts/optional-emissions.json': JSON.stringify({
          optional: [{ path: 'scripts/check-overlay.mjs', rationale: 'frontend overlay only' }],
        }),
      })
      try {
        const { problems } = checkEmissionCoherence(dir)
        expect(problems).toEqual([])
      } finally {
        cleanup()
      }
    })
  })
})
