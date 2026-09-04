import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, readFileSync } from 'node:fs'
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

describe('check-constraint-scan.mjs (INV-115) — fail-closed on a MISSING map (#2037)', () => {
  it('14. map file does not exist (not merely empty) → FAIL exit 1 with actionable message', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenSentinelToken()`\n')
      const src = writeSrc(dir, {})
      const missingMap = join(dir, 'does-not-exist.json') // never written — absent by construction
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${missingMap}`])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain(missingMap)
      expect(r.stderr).toMatch(/missing/i)
      expect(r.stderr).toContain('arbiter update')
    } finally {
      cleanup()
    }
  })

  it('15. a present-but-empty map ({}) still WARNS (not FAILs) — only absence fails', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenSentinelToken()`\n')
      const src = writeSrc(dir, { 'bad.ts': 'export const x = forbiddenSentinelToken()\n' })
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`, '--enforce=false'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('[WARN-SCAN]')
    } finally {
      cleanup()
    }
  })

  it('16. governance.constraintScan="off" in arbiter.json → SKIP exit 0 even with no map', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenSentinelToken()`\n')
      writeFileSync(
        join(dir, 'arbiter.json'),
        JSON.stringify({ governance: { constraintScan: 'off' } }),
      )
      const r = runIn(dir, [`--docs=${doc}`])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })

  it('17. malformed arbiter.json → FAIL exit 2 (schema error, not silently ignored)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenSentinelToken()`\n')
      writeFileSync(join(dir, 'arbiter.json'), '{ not valid json')
      const r = runIn(dir, [`--docs=${doc}`])
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/invalid arbiter\.json/i)
    } finally {
      cleanup()
    }
  })

  // Red-team (regression pass): a shape-valid-JSON-but-schema-invalid map (array, string,
  // null) previously parsed successfully and was silently treated as an empty {} map —
  // indistinguishable from a legitimately empty, fresh-project map. Must fail closed the
  // same way invalid JSON does (exit 2), not degrade silently to a false OK/green.
  it('18. constraint-map.json that is a JSON array (not an object) → FAIL exit 2', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenSentinelToken()`\n')
      const mapPath = join(dir, 'map.json')
      writeFileSync(mapPath, '[]')
      const r = run([`--docs=${doc}`, `--map=${mapPath}`, '--enforce=false'])
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/invalid map/i)
    } finally {
      cleanup()
    }
  })

  it('19. constraint-map.json that is the JSON literal null → FAIL exit 2 (not a crash)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenSentinelToken()`\n')
      const mapPath = join(dir, 'map.json')
      writeFileSync(mapPath, 'null')
      const r = run([`--docs=${doc}`, `--map=${mapPath}`, '--enforce=false'])
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/invalid map/i)
    } finally {
      cleanup()
    }
  })

  it('20. constraint-map.json entry that is null (not {enforcer,kind}) → FAIL exit 2 (not a crash)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenSentinelToken()`\n')
      const mapPath = join(dir, 'map.json')
      writeFileSync(mapPath, JSON.stringify({ forbiddenSentinelToken: null }))
      const r = run([`--docs=${doc}`, `--map=${mapPath}`, '--enforce=false'])
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/invalid map/i)
    } finally {
      cleanup()
    }
  })

  // Red-team (self-review pass, x2 corroborated): the scaffolded starter map
  // (src/templates/scripts/constraint-map.json.ejs) documents itself via "//N"
  // comment-keys whose VALUES are strings — which the shape validator (test 18-20
  // above) would reject as "not an object", making a freshly-scaffolded project's
  // own gate hard-fail immediately. Comment keys must be ignorable, not schema-valid.
  it('21. the real scaffolded starter map ("//" comment keys) passes shape validation (WARN, not FAIL)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, '**Never:**\n\n- Call `forbiddenSentinelToken()`\n')
      const src = writeSrc(dir, {})
      const scaffold = readFileSync(
        resolve('src/templates/scripts/constraint-map.json.ejs'),
        'utf8',
      )
      const mapPath = join(dir, 'map.json')
      writeFileSync(mapPath, scaffold)
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${mapPath}`, '--enforce=false'])
      expect(r.status).toBe(0)
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
    // Since #2384 the pure-prose ones (commit to main, root-cause discipline) are triaged into
    // the ACCEPTED bucket rather than left untriaged — still pinned to the doc, so a broken
    // block parser cannot pass on AGENTS.md/CANON.md classifications alone.
    expect(r.stdout).toMatch(/\[ACCEPTED\].*CLAUDE\.md/)
  })
})

describe('check-constraint-scan.mjs (INV-115) — #2410 extraction-quality follow-ups', () => {
  it('a `- _Enforcement:_` italic-bullet field is excluded like `**Enforcement:**` (not a prohibition)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(
        dir,
        '- _Enforcement:_ reads `manifest.json`; never false-fail when `required:true` is absent or `uses:` is unset\n',
      )
      const src = writeSrc(dir, {})
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.stdout).not.toContain('UNENFORCEABLE')
      expect(r.stdout).not.toContain('required:true')
    } finally {
      cleanup()
    }
  })

  it('tokensAfter clips at the sentence boundary — a token in the NEXT clause is not swept in', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(
        dir,
        '- must NOT contain `push.branches`. Unrelated text mentions `cosign copy` too.\n',
      )
      const src = writeSrc(dir, {})
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.stdout).toContain('push.branches')
      expect(r.stdout).not.toContain('cosign copy')
    } finally {
      cleanup()
    }
  })
})

// ─── #2384: prose triage, the accepted bucket, and the coverage ratchet ──────────────────
// INV-115 could only ever mark a prohibition COVERED when it carried a grep-able code
// token, so every judgment-level rule ("Skip the gate before committing") was stuck in the
// UNENFORCEABLE bucket regardless of whether a real enforcer existed. These tests pin the
// three honest outcomes of triage — mapped-to-a-real-enforcer, explicitly ACCEPTED with a
// rationale, or still untriaged — plus the one-way ratchet that stops the ratio drifting back.
const PROSE = 'Skip the gate before committing'

function writeRawMap(dir: string, map: unknown): string {
  const p = join(dir, 'map.json')
  writeFileSync(p, JSON.stringify(map))
  return p
}

function writeBaseline(dir: string, metrics: Record<string, unknown>): string {
  const p = join(dir, 'baseline.json')
  writeFileSync(p, JSON.stringify({ version: 1, capturedAt: '2026-01-01T00:00:00Z', metrics }))
  return p
}

function count(n: number, direction: string) {
  return { value: n, unit: 'count', direction }
}

describe('check-constraint-scan.mjs (INV-115) — #2384 prose triage + coverage ratchet', () => {
  it('22. a token-less prohibition mapped by its prose key resolves to COVERED, not UNENFORCEABLE', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const map = writeRawMap(dir, {
        [`prose:- ${PROSE}`]: { kind: 'hook', enforcer: 'check-no-orphan-todo.mjs' },
      })
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('[COVERED]')
      expect(r.stdout).not.toContain('[UNENFORCEABLE]')
    } finally {
      cleanup()
    }
  })

  it('23. kind "accepted" + a rationale reports ACCEPTED (triaged), not UNENFORCEABLE', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const map = writeRawMap(dir, {
        [`prose:- ${PROSE}`]: {
          kind: 'accepted',
          rationale: 'Judgment-level rule with no mechanical enforcer; reviewed by a human at PR time.',
        },
      })
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('[ACCEPTED]')
      expect(r.stdout).not.toContain('[UNENFORCEABLE]')
    } finally {
      cleanup()
    }
  })

  it('24. kind "accepted" with no rationale is MAP-INVALID and FAILS (acceptance is never free)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const map = writeRawMap(dir, { [`prose:- ${PROSE}`]: { kind: 'accepted' } })
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[MAP-INVALID]')
    } finally {
      cleanup()
    }
  })

  it('25. a prose entry naming a non-existent enforcer is still MAP-FICTION (AC-2)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const map = writeRawMap(dir, {
        [`prose:- ${PROSE}`]: { kind: 'script', enforcer: 'check-does-not-exist-2384.mjs' },
      })
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[MAP-FICTION]')
    } finally {
      cleanup()
    }
  })

  it('26. a prose entry matching no extracted prohibition is MAP-DEAD and FAILS (map cannot rot)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const map = writeRawMap(dir, {
        [`prose:- ${PROSE}`]: { kind: 'hook', enforcer: 'check-no-orphan-todo.mjs' },
        'prose:- A prohibition nobody wrote': { kind: 'hook', enforcer: 'check-no-orphan-todo.mjs' },
      })
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[MAP-DEAD]')
    } finally {
      cleanup()
    }
  })

  it('27. kind "githook" resolves under .githooks/ (and a missing one is MAP-FICTION)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const ok = writeRawMap(dir, {
        [`prose:- ${PROSE}`]: { kind: 'githook', enforcer: 'pre-commit' },
      })
      expect(run([`--docs=${doc}`, `--src=${src}`, `--map=${ok}`]).stdout).toContain('[COVERED]')
      const bad = join(dir, 'bad.json')
      writeFileSync(
        bad,
        JSON.stringify({ [`prose:- ${PROSE}`]: { kind: 'githook', enforcer: 'no-such-hook' } }),
      )
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${bad}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[MAP-FICTION]')
    } finally {
      cleanup()
    }
  })

  it('28. `**Extended to:**` is an explanatory metadata field, not a prohibition', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(
        dir,
        '**Extended to:** INV-115 — generalised to free-text prohibitions (NEVER / MUST NOT / DO NOT).\n',
      )
      const src = writeSrc(dir, {})
      const map = writeMap(dir, {})
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`])
      expect(r.status).toBe(0)
      expect(r.stdout).not.toContain('[UNENFORCEABLE]')
    } finally {
      cleanup()
    }
  })

  it('29. the ratchet FAILS when the unenforceable count rises above the baseline', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const map = writeMap(dir, {})
      const base = writeBaseline(dir, {
        covered: count(0, 'higher-is-better'),
        unenforceable: count(0, 'lower-is-better'),
      })
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`, `--baseline=${base}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[RATCHET]')
    } finally {
      cleanup()
    }
  })

  it('30. the ratchet FAILS when the covered count falls below the baseline', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const map = writeRawMap(dir, {
        [`prose:- ${PROSE}`]: {
          kind: 'accepted',
          rationale: 'Judgment-level rule with no mechanical enforcer; reviewed by a human at PR time.',
        },
      })
      const base = writeBaseline(dir, {
        covered: count(5, 'higher-is-better'),
        unenforceable: count(0, 'lower-is-better'),
      })
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`, `--baseline=${base}`])
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('[RATCHET]')
    } finally {
      cleanup()
    }
  })

  it('31. an absent baseline does not fail the gate — it reports RATCHET-UNSET', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const map = writeMap(dir, {})
      const missing = join(dir, 'no-such-baseline.json')
      const r = run([`--docs=${doc}`, `--src=${src}`, `--map=${map}`, `--baseline=${missing}`])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('[RATCHET-UNSET]')
    } finally {
      cleanup()
    }
  })

  it('32. --update-baseline REFUSES to record a regression (a ratchet that loosens is not a ratchet)', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const map = writeMap(dir, {})
      const base = writeBaseline(dir, {
        covered: count(3, 'higher-is-better'),
        unenforceable: count(0, 'lower-is-better'),
      })
      const before = readFileSync(base, 'utf8')
      const r = run([
        `--docs=${doc}`,
        `--src=${src}`,
        `--map=${map}`,
        `--baseline=${base}`,
        '--update-baseline',
      ])
      expect(r.status).toBe(1)
      expect(readFileSync(base, 'utf8')).toBe(before)
    } finally {
      cleanup()
    }
  })

  it('33. --update-baseline TIGHTENS when the numbers improved', () => {
    const { dir, cleanup } = fixture()
    try {
      const doc = writeDoc(dir, `**Never:**\n\n- ${PROSE}\n`)
      const src = writeSrc(dir, {})
      const map = writeRawMap(dir, {
        [`prose:- ${PROSE}`]: { kind: 'hook', enforcer: 'check-no-orphan-todo.mjs' },
      })
      const base = writeBaseline(dir, {
        covered: count(0, 'higher-is-better'),
        unenforceable: count(9, 'lower-is-better'),
      })
      const r = run([
        `--docs=${doc}`,
        `--src=${src}`,
        `--map=${map}`,
        `--baseline=${base}`,
        '--update-baseline',
      ])
      expect(r.status).toBe(0)
      const updated = JSON.parse(readFileSync(base, 'utf8'))
      expect(updated.metrics.covered.value).toBe(1)
      expect(updated.metrics.unenforceable.value).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('34. the arbiter self-repo has ZERO untriaged prohibitions (AC-1/AC-3)', () => {
    const r = run([])
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain('[UNENFORCEABLE]')
    expect(r.stdout).toMatch(/0 unenforceable/)
  })
})
