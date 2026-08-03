// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-unwired-guards.mjs')

function run(cwd: string, args: string[] = []) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'unwired-guards-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-unwired-guards.mjs (INV-89, #2159)', () => {
  it('exits 1 and names the file when a real orphan guard script exists, referenced nowhere', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'verify-requirements-matrix.sh'), '#!/bin/sh\necho hi\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('scripts/verify-requirements-matrix.sh')
    } finally {
      cleanup()
    }
  })

  it('exits 0 (GREEN) once the same orphan is referenced by scripts/check-all.mjs', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'verify-requirements-matrix.sh'), '#!/bin/sh\necho hi\n')
      writeFileSync(
        join(dir, 'scripts', 'check-all.mjs'),
        "runCheck('requirements matrix', 'sh', ['scripts/verify-requirements-matrix.sh'])\n",
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the orphan is referenced via run.sh', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'verify-requirements-matrix.sh'), '#!/bin/sh\necho hi\n')
      writeFileSync(join(dir, 'run.sh'), '#!/bin/bash\nsh scripts/verify-requirements-matrix.sh\n')
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the orphan is referenced by another scripts/** file', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'check-foo.sh'), '#!/bin/sh\necho hi\n')
      writeFileSync(
        join(dir, 'scripts', 'orchestrator.mjs'),
        "spawnSync('sh', ['scripts/check-foo.sh'])\n",
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 with ALLOWLISTED stdout when the orphan is listed in optional-emissions.json (shared with INV-123)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'check-orphan.mjs'), '// orphan\n')
      writeFileSync(
        join(dir, 'scripts', 'optional-emissions.json'),
        JSON.stringify({
          optional: [{ path: 'scripts/check-orphan.mjs', rationale: 'intentional overlay, #0000' }],
        }),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('ALLOWLISTED')
      expect(result.stdout).toContain('scripts/check-orphan.mjs')
    } finally {
      cleanup()
    }
  })

  it('exits 2 when an optional-emissions.json entry has an empty rationale', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'scripts', 'optional-emissions.json'),
        JSON.stringify({ optional: [{ path: 'scripts/check-orphan.mjs', rationale: '' }] }),
      )
      const result = run(dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('rationale')
    } finally {
      cleanup()
    }
  })

  it('exits 2 when optional-emissions.json is malformed', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'optional-emissions.json'), '{not json')
      const result = run(dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('not valid JSON')
    } finally {
      cleanup()
    }
  })

  it('exits 0 SKIP (vacuous) when there is no scripts/ directory at all', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })

  it('exits 0 with --help', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage')
  })

  it('finds scripts/qa/check-* orphans (broader glob than check-emission-coherence)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts', 'qa'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'qa', 'check-something'), '#!/bin/sh\necho hi\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('scripts/qa/check-something')
    } finally {
      cleanup()
    }
  })

  // ─── #2228 — .claude/hooks/*.mjs widened candidate set ───────────────────────

  it('#2228 exits 1 and names the hook when a .claude/hooks/*.mjs file is wired nowhere', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
      writeFileSync(join(dir, '.claude/hooks', 'check-orphan-hook.mjs'), '// orphan hook\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('.claude/hooks/check-orphan-hook.mjs')
    } finally {
      cleanup()
    }
  })

  it('#2228 exits 0 once the same hook is wired in .claude/settings.json (full-path match)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
      writeFileSync(join(dir, '.claude/hooks', 'check-orphan-hook.mjs'), '// orphan hook\n')
      writeFileSync(
        join(dir, '.claude/settings.json'),
        JSON.stringify({
          hooks: {
            PostToolUse: [
              {
                matcher: 'Edit|Write',
                hooks: [
                  {
                    type: 'command',
                    command: 'node .claude/hooks/check-orphan-hook.mjs',
                  },
                ],
              },
            ],
          },
        }),
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('#2228 exits 0 when a hook is wired by bare name in the hooks.mjs HANDLERS table', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
      writeFileSync(join(dir, '.claude/hooks', 'check-dispatcher-hook.mjs'), '// hook\n')
      writeFileSync(
        join(dir, '.claude/hooks', 'hooks.mjs'),
        "const HANDLERS = { 'PostToolUse:Edit|Write': ['check-dispatcher-hook.mjs'] }\n",
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('#2228 never flags hooks.mjs or lib.mjs as unwired (dispatcher/helper excluded by name)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
      writeFileSync(join(dir, '.claude/hooks', 'hooks.mjs'), '// dispatcher entrypoint\n')
      writeFileSync(join(dir, '.claude/hooks', 'lib.mjs'), '// shared helper\n')
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain('hooks.mjs')
      expect(result.stdout).not.toContain('lib.mjs')
    } finally {
      cleanup()
    }
  })

  it('#2228 exits 0 when a hook is imported (relative specifier) by a hook that is itself wired', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
      writeFileSync(join(dir, '.claude/hooks', 'check-importer.mjs'), '// wired hook\n')
      writeFileSync(
        join(dir, '.claude/hooks', 'check-imported.mjs'),
        "// imported helper\nimport { helper } from './check-importer.mjs'\n",
      )
      writeFileSync(
        join(dir, '.claude/settings.json'),
        JSON.stringify({
          hooks: {
            PostToolUse: [
              {
                matcher: 'Edit|Write',
                hooks: [
                  {
                    type: 'command',
                    command: 'node .claude/hooks/check-importer.mjs',
                  },
                ],
              },
            ],
          },
        }),
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('#2228 exits 0 with ALLOWLISTED stdout when an unwired hook is listed in optional-emissions.json', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
      writeFileSync(join(dir, '.claude/hooks', 'check-language-hook.mjs'), '// language-specific hook\n')
      writeFileSync(
        join(dir, 'scripts', 'optional-emissions.json'),
        JSON.stringify({
          optional: [
            {
              path: '.claude/hooks/check-language-hook.mjs',
              rationale: 'language-inapplicable to this repo, #2228',
            },
          ],
        }),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('ALLOWLISTED')
      expect(result.stdout).toContain('.claude/hooks/check-language-hook.mjs')
    } finally {
      cleanup()
    }
  })
})
