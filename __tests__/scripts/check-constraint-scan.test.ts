import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-constraint-scan.mjs')
const REPO = resolve('.')

// Enforcer-existence checks resolve against the repo root (cwd), while --docs/--src/--map
// point at fixtures. So we always run with cwd=REPO and pass absolute fixture paths.
function run(args: string[]) {
  return runIn(REPO, args)
}

function runIn(cwd: string, args: string[]) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function fixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'constraint-scan-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeDoc(dir: string, body: string): string {
  const p = join(dir, 'GOV.md')
  writeFileSync(p, body)
  return p
}

function writeSrc(dir: string, files: Record<string, string>): string {
  const srcDir = join(dir, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(srcDir, name), content)
  return srcDir
}

function writeMap(dir: string, map: Record<string, { enforcer: string; kind: string }>): string {
  const p = join(dir, 'map.json')
  writeFileSync(p, JSON.stringify(map))
  return p
}

describe('check-constraint-scan.mjs (INV-115) — derivation & classification', () => {
  it('1. derivable prohibition with a live source hit → VIOLATION, exit 1', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenSentinelToken()`\n')
      const src = writeSrc(dir, { 'bad.ts': 'export const x = forbiddenSentinelToken()\n' })
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('VIOLATION')
      expect(r.stdout).toContain('forbiddenSentinelToken')
    } finally {
      cleanup()
    }
  })

  it('2. regex-meta token (.unwrap()) is escaped: matches the call, not a lookalike, no crash', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Add `.unwrap()` somewhere\n')
      const src = writeSrc(dir, {
        'hit.ts': 'const v = res.unwrap()\n',
        'miss.ts': 'const unwrapHelper = 1\n',
      })
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('hit.ts')
      expect(r.stdout).not.toContain('miss.ts')
    } finally {
      cleanup()
    }
  })

  it('3. mapped token whose enforcer EXISTS → COVERED, no violation, exit 0', () => {
    const { dir, cleanup } = fixture()
    try {
      // child_process is genuinely gated by a real hook in this repo.
      const doc = writeDoc(dir, '- must use the wrapper, never `child_process` directly\n')
      const src = writeSrc(dir, { 'wrap.ts': 'import cp from "child_process"\n' })
      const map = writeMap(dir, {
        child_process: { enforcer: 'check-no-direct-spawn.mjs', kind: 'hook' },
      })
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('COVERED')
      expect(r.stdout).toContain('child_process')
      expect(r.stdout).not.toContain('VIOLATION')
    } finally {
      cleanup()
    }
  })

  it('4. map entry pointing at a NON-EXISTENT enforcer → MAP-FICTION fail, exit 1', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '- never `child_process` directly\n')
      const src = writeSrc(dir, {})
      const map = writeMap(dir, {
        child_process: { enforcer: 'does-not-exist-enforcer.mjs', kind: 'hook' },
      })
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('MAP-FICTION')
    } finally {
      cleanup()
    }
  })

  it('5. directive with a path-like token (debt-baseline.json) → UNENFORCEABLE warn, exit 0', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Rule:** Never manually edit `debt-baseline.json` to loosen\n')
      const src = writeSrc(dir, { 'a.ts': 'const p = "debt-baseline.json"\n' })
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('UNENFORCEABLE')
      expect(r.stdout).not.toContain('VIOLATION')
    } finally {
      cleanup()
    }
  })

  it('6. prose rejection: **Why:** narrative and a "whenever" line are NOT extracted', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(
        dir,
        '**Why:** the gate was never called, so `someToken()` slipped\n\n' +
          '**Enforcement:** verify whenever `AGENTS.md` changes\n',
      )
      const src = writeSrc(dir, { 'a.ts': 'someToken()\n' })
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(0)
      expect(r.stdout).not.toContain('VIOLATION')
      expect(r.stdout).not.toContain('someToken')
    } finally {
      cleanup()
    }
  })

  it('7. live source hit with --enforce=false → WARN (not violation), exit 0', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenSentinelToken()`\n')
      const src = writeSrc(dir, { 'bad.ts': 'forbiddenSentinelToken()\n' })
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`, '--enforce=false'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('WARN')
      expect(r.stdout).not.toContain('[VIOLATION]')
    } finally {
      cleanup()
    }
  })

  it('8. --help exits 0 and prints usage', () => {
    const r = run(['--help'])
    expect(r.status).toBe(0)
    expect(r.stdout.toLowerCase()).toContain('usage')
  })

  it('9. derivable token with NO live hit → green (the scan itself IS the wiring)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `zzzAbsentToken()`\n')
      const src = writeSrc(dir, { 'a.ts': 'const ok = 1\n' })
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(0)
      expect(r.stdout).not.toContain('zzzAbsentToken') // not a violation, not unenforceable
    } finally {
      cleanup()
    }
  })

  it('10. inline multi-token prohibition catches the SECOND token too', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '- You MUST NOT use `alphaToken()` or `betaToken()`\n')
      const src = writeSrc(dir, { 'b.ts': 'betaToken()\n' })
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('betaToken')
    } finally {
      cleanup()
    }
  })

  it('11. lint enforcer set to "off" is MAP-FICTION (disabled rule ≠ covered)', () => {
    const { dir, cleanup } = fixture()
    try {
      // Run with cwd=fixture so enforcer resolution reads the fixture eslint config.
      writeFileSync(join(dir, '.eslintrc.json'), JSON.stringify({ rules: { 'no-var': 'off' } }))
      const doc = writeDoc(dir, 'Prefer const, never `var`\n')
      writeSrc(dir, {})
      const map = writeMap(dir, { var: { enforcer: 'no-var', kind: 'lint' } })
      const r = runIn(dir, [`--docs=${doc}`, `--src=${join(dir, 'src')}`, `--map=${map}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('MAP-FICTION')
    } finally {
      cleanup()
    }
  })

  it('12. lint enforcer set to "error" is COVERED', () => {
    const { dir, cleanup } = fixture()
    try {
      writeFileSync(join(dir, '.eslintrc.json'), JSON.stringify({ rules: { 'no-var': 'error' } }))
      const doc = writeDoc(dir, 'Prefer const, never `var`\n')
      writeSrc(dir, {})
      const map = writeMap(dir, { var: { enforcer: 'no-var', kind: 'lint' } })
      const r = runIn(dir, [`--docs=${doc}`, `--src=${join(dir, 'src')}`, `--map=${map}`])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('COVERED')
    } finally {
      cleanup()
    }
  })

  it('13. zero governance docs found → fail-closed (not vacuously green)', () => {
    const { dir, cleanup } = fixture()
    try {
      const map = writeMap(dir, {})
      const r = run([`--docs=${join(dir, 'absent.md')}`, `--src=${dir}`, `--map=${map}`])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('no governance docs found')
    } finally {
      cleanup()
    }
  })
})

describe('check-constraint-scan.mjs (INV-115) — #1215 follow-ups', () => {
  it('14. Never-block bullet: "use `x`, never `y`" — only `y` extracted (not `x`)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Use `approvedHelper()`, never `forbiddenCall()`\n')
      const src = writeSrc(dir, { 'good.ts': 'approvedHelper()\n' })
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      // approvedHelper is the approved token BEFORE the never marker — must NOT be extracted
      expect(r.stdout).not.toContain('approvedHelper')
      // forbiddenCall appears in source but is not in the output because there is no hit
      // (the src only has approvedHelper). The test proves approvedHelper is not treated as prohibited.
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('15. IO error: unreadable src dir + --enforce → exit 1 + [SCAN-INCOMPLETE] in stderr', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenIOToken()`\n')
      const srcDir = join(dir, 'src')
      mkdirSync(srcDir, { recursive: true })
      // Skip on CI where processes may run as root (root ignores chmod)
      if (process.getuid?.() === 0) return
      // make the src dir unreadable so walk() readdirSync fails
      chmodSync(srcDir, 0o000)
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${srcDir}`, `--map=${map}`, '--enforce'])
      chmodSync(srcDir, 0o755) // restore for cleanup
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('[SCAN-INCOMPLETE]')
    } finally {
      cleanup()
    }
  })

  it('16. IO error: unreadable source file + --enforce → exit 1 + [SCAN-INCOMPLETE] in stderr', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `unreadableHit()`\n')
      const srcDir = writeSrc(dir, { 'secret.ts': 'unreadableHit()\n' })
      // Skip on CI where processes may run as root (root ignores chmod)
      if (process.getuid?.() === 0) return
      // make the file unreadable so liveHit() readFileSync fails
      chmodSync(join(srcDir, 'secret.ts'), 0o000)
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${srcDir}`, `--map=${map}`, '--enforce'])
      chmodSync(join(srcDir, 'secret.ts'), 0o644) // restore for cleanup
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('[SCAN-INCOMPLETE]')
    } finally {
      cleanup()
    }
  })
})

describe('check-constraint-scan.mjs (INV-115) — real-doc canary (false-negative guard)', () => {
  // The v1 bug was: extraction silently matched ~nothing on the REAL docs, so the gate was
  // green for the wrong reason. This canary runs the scanner against arbiter's actual
  // governance and asserts the known prohibitions are extracted AND classified correctly.
  it('extracts + classifies arbiter real prohibitions, and the full self-scan is GREEN', () => {
    const r = run([]) // all defaults: real docs, real map, real src
    expect(r.status).toBe(0)
    // child_process (CANON.md), any & var (AGENTS.md) must be recognised as COVERED —
    // assert the CLASSIFICATION, not mere string presence (a VIOLATION line also contains the token).
    expect(r.stdout).toMatch(/\[COVERED\].*child_process/)
    expect(r.stdout).toMatch(/\[COVERED\].*\bany\b/)
    expect(r.stdout).toMatch(/\[COVERED\].*\bvar\b/)
    // The `**Never:**` block in .claude/CLAUDE.md must yield prohibitions (not be skipped).
    // Pure-prose ones (skip the gate / commit to main) are UNENFORCEABLE, sourced from CLAUDE.md —
    // pinned to the doc so a broken block parser can't pass on AGENTS.md/CANON.md unenforceables.
    expect(r.stdout).toMatch(/UNENFORCEABLE.*CLAUDE\.md/)
  })
})
