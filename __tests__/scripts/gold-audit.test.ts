import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/gold-audit.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** A registry with one of each verdict-producing check type. All SAFE by default. */
const REGISTRY = `version: '1.0.0'
profile: tooling
dimensions:
  - id: D-DOCS
    title: Documentation
  - id: D-META
    title: Meta-test discipline
checks:
  - id: GA-01
    dimension: D-DOCS
    title: README present
    type: file_exists
    args: { path: README.md }
    weight: 1
    risk: SAFE
    anchor: INV-00
  - id: GA-02
    dimension: D-DOCS
    title: README mentions install
    type: file_contains
    args: { path: README.md, pattern: 'install' }
    weight: 1
    risk: SAFE
  - id: GA-03
    dimension: D-META
    title: api-only overlay doc
    type: file_exists
    args: { path: docs/api.md }
    applies_if: has-api
    weight: 1
    risk: SAFE
  - id: GA-04
    dimension: D-META
    title: human attestation of release process
    type: manual
    weight: 1
    risk: SAFE
`

function makeRepo(
  registry: string = REGISTRY,
  profile?: string,
): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gold-audit-test-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-registry.yml'), registry)
  if (profile) {
    writeFileSync(join(dir, 'standards', 'gold-profile'), profile)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('gold-audit (#1373)', () => {
  it('--help exits 0', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('resolves an absolute --registry and writes --json to an absolute path (regression: join→resolve)', () => {
    const { dir, cleanup } = makeRepo()
    const ext = mkdtempSync(join(tmpdir(), 'gold-audit-ext-'))
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const regAbs = join(ext, 'my-registry.yml')
      writeFileSync(regAbs, REGISTRY)
      const outAbs = join(ext, 'out.json')
      const r = run(dir, ['--registry', regAbs, '--json', outAbs])
      expect(r.status).toBe(0)
      expect(r.stdout).not.toMatch(/SKIP/) // absolute registry must be found, not concatenated onto CWD
      expect(existsSync(outAbs)).toBe(true) // absolute --json must write to that exact path
      const j = JSON.parse(readFileSync(outAbs, 'utf-8'))
      expect(typeof j.score).toBe('number')
    } finally {
      cleanup()
      rmSync(ext, { recursive: true, force: true })
    }
  })

  it('--json emits a scored payload with score, yCount, riskyCount, dimensions, checks', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const r = run(dir, ['--json'])
      expect(r.status).toBe(0)
      const j = JSON.parse(r.stdout)
      expect(typeof j.score).toBe('number')
      expect(typeof j.yCount).toBe('number')
      expect(typeof j.riskyCount).toBe('number')
      expect(Array.isArray(j.checks)).toBe(true)
      expect(typeof j.dimensions).toBe('object')
    } finally {
      cleanup()
    }
  })

  it('verdicts: present→Y, absent→N, applies_if-false→NA, manual→NV', () => {
    const { dir, cleanup } = makeRepo() // no overlay → GA-03 is NA
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId: Record<string, { verdict: string }> = Object.fromEntries(
        j.checks.map((c: { id: string }) => [c.id, c]),
      )
      expect(byId['GA-01'].verdict).toBe('Y') // README exists
      expect(byId['GA-02'].verdict).toBe('Y') // README contains "install"
      expect(byId['GA-03'].verdict).toBe('NA') // has-api overlay off
      expect(byId['GA-04'].verdict).toBe('NV') // manual → not verified by code
    } finally {
      cleanup()
    }
  })

  it('absent file_exists → N', () => {
    const { dir, cleanup } = makeRepo()
    try {
      // README missing entirely → GA-01 N, GA-02 N
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId: Record<string, { verdict: string }> = Object.fromEntries(
        j.checks.map((c: { id: string }) => [c.id, c]),
      )
      expect(byId['GA-01'].verdict).toBe('N')
      expect(byId['GA-02'].verdict).toBe('N')
    } finally {
      cleanup()
    }
  })

  it('file_exists distinguishes empty, whitespace-only, substantive, and missing files', () => {
    const { dir, cleanup } = makeRepo(
      `version: '1.0.0'
checks:
  - id: EMPTY
    type: file_exists
    args: { path: empty.md }
  - id: WHITESPACE
    type: file_exists
    args: { path: whitespace.md }
  - id: CONTENT
    type: file_exists
    args: { path: content.md }
  - id: MISSING
    type: file_exists
    args: { path: missing.md }
`,
    )
    try {
      writeFileSync(join(dir, 'empty.md'), '')
      writeFileSync(join(dir, 'whitespace.md'), '\n\n  \n')
      writeFileSync(join(dir, 'content.md'), '# substantive\n')
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId: Record<string, { verdict: string; evidence: { detail?: string } }> =
        Object.fromEntries(j.checks.map((c: { id: string }) => [c.id, c]))

      expect(byId.EMPTY).toMatchObject({ verdict: 'P', evidence: { detail: 'present but empty' } })
      expect(byId.WHITESPACE).toMatchObject({
        verdict: 'P',
        evidence: { detail: 'present but empty' },
      })
      expect(byId.CONTENT).toMatchObject({ verdict: 'Y' })
      expect(byId.MISSING).toMatchObject({ verdict: 'N', evidence: { detail: 'missing' } })
    } finally {
      cleanup()
    }
  })

  it('every non-NA/NV verdict carries evidence with a file', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId = Object.fromEntries(j.checks.map((c: { id: string }) => [c.id, c]))
      expect(byId['GA-01'].evidence.file).toBe('README.md')
      expect(byId['GA-02'].evidence.file).toBe('README.md')
      expect(typeof byId['GA-02'].evidence.line).toBe('number')
    } finally {
      cleanup()
    }
  })

  it('overlay on → applies_if check becomes applicable', () => {
    const { dir, cleanup } = makeRepo(REGISTRY, 'overlays:\n  - has-api\n')
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const j = JSON.parse(run(dir, ['--json']).stdout)
      const byId = Object.fromEntries(j.checks.map((c: { id: string }) => [c.id, c]))
      expect(byId['GA-03'].verdict).toBe('N') // now applies, doc missing
    } finally {
      cleanup()
    }
  })

  it('is deterministic — byte-identical JSON for identical inputs', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const a = run(dir, ['--json']).stdout
      const b = run(dir, ['--json']).stdout
      expect(a).toBe(b)
    } finally {
      cleanup()
    }
  })

  it('--check bootstraps a missing baseline and exits 0', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const r = run(dir, ['--check'])
      expect(r.status).toBe(0)
      expect(existsSync(join(dir, '.gold-audit-baseline.json'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('--check no-regress: a higher baseline score fails (exit 1)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      // Seed a baseline that demands a higher score/yCount than current.
      writeFileSync(
        join(dir, '.gold-audit-baseline.json'),
        JSON.stringify({ score: 100, yCount: 99, dimensions: {} }, null, 2) + '\n',
      )
      const r = run(dir, ['--check'])
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/regress/i)
    } finally {
      cleanup()
    }
  })

  it('--check passes (exit 0) when score meets the baseline', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      writeFileSync(
        join(dir, '.gold-audit-baseline.json'),
        JSON.stringify({ score: 0, yCount: 0, dimensions: {} }, null, 2) + '\n',
      )
      const r = run(dir, ['--check'])
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('--update-baseline is monotonic — never lowers a recorded field', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      // Existing baseline already higher than what the current tree scores.
      writeFileSync(
        join(dir, '.gold-audit-baseline.json'),
        JSON.stringify({ score: 100, yCount: 99, dimensions: {} }, null, 2) + '\n',
      )
      const r = run(dir, ['--update-baseline'])
      expect(r.status).toBe(0)
      const bl = JSON.parse(readFileSync(join(dir, '.gold-audit-baseline.json'), 'utf-8'))
      expect(bl.score).toBe(100) // not lowered
      expect(bl.yCount).toBe(99) // not lowered
    } finally {
      cleanup()
    }
  })

  it('false-gap meta-gate: a RISKY check fails --strict (exit 1)', () => {
    const risky = REGISTRY.replace('risk: SAFE\n    anchor: INV-00', 'risk: RISKY')
    const { dir, cleanup } = makeRepo(risky)
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const r = run(dir, ['--strict'])
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/risky/i)
    } finally {
      cleanup()
    }
  })

  it('false-gap meta-gate: all SAFE passes --strict (exit 0)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const r = run(dir, ['--strict'])
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  // ── N1 (fail-closed disarm, #1412): a configured engine whose baseline was deleted must NOT
  //    silently re-bootstrap and pass — that erases the regression record (a disarm vector).
  it('N1: --check --require-baseline with a missing baseline → HARD FAIL (exit 1)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      // No baseline file: configured registry + --require-baseline ⇒ disarm refusal.
      const r = run(dir, ['--check', '--require-baseline'])
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/baseline/i)
    } finally {
      cleanup()
    }
  })

  it('N1: --check --require-baseline with a present baseline still gates normally (exit 0)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      writeFileSync(
        join(dir, '.gold-audit-baseline.json'),
        JSON.stringify({ score: 0, yCount: 0, dimensions: {} }, null, 2) + '\n',
      )
      const r = run(dir, ['--check', '--require-baseline'])
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('N1: --check (no --require-baseline) still bootstraps a missing baseline (exit 0)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const r = run(dir, ['--check'])
      expect(r.status).toBe(0)
      expect(existsSync(join(dir, '.gold-audit-baseline.json'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  // ── #1414: level band + gap render in the engine output ────────────────────────────────────
  it('--json --class heavy includes a level band keyed by brownfieldClass', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const j = JSON.parse(run(dir, ['--json', '--class', 'heavy']).stdout)
      expect(j.level).toBeTruthy()
      expect(j.level.brownfieldClass).toBe('heavy')
      expect(['L0', 'L1', 'L2', 'L3']).toContain(j.level.level)
    } finally {
      cleanup()
    }
  })

  it('--json includes a gaps array (the N/P "what is missing" view) by family', () => {
    const { dir, cleanup } = makeRepo() // README missing → GA-01/GA-02 are N
    try {
      const j = JSON.parse(run(dir, ['--json']).stdout)
      expect(Array.isArray(j.gaps)).toBe(true)
      const docs = j.gaps.find((g: { dimension: string }) => g.dimension === 'D-DOCS')
      expect(docs).toBeTruthy()
      expect(docs.checks.length).toBeGreaterThan(0)
      expect(docs.checks[0].evidence).toBeTruthy()
    } finally {
      cleanup()
    }
  })

  it('--class overrides the detected class deterministically', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
      const a = run(dir, ['--json', '--class', 'gold']).stdout
      const b = run(dir, ['--json', '--class', 'gold']).stdout
      expect(a).toBe(b)
    } finally {
      cleanup()
    }
  })
})

// ── #1413: per-stack registry (value-op reads pre-generated reports + threshold_ref per class) ────
//
// gold-audit --stack java selects standards/gold-registry.java.yml and resolves each value check's
// bar from standards/thresholds.yml keyed by --class. Reports are PRE-GENERATED (no spawn). A check
// whose report file is absent scores NA (never a false-N). The shipped registries live in the repo,
// so this suite points the engine at the real standards/ via --registry/--thresholds.

const ROOT = resolve('.')
const JAVA_REGISTRY = join(ROOT, 'standards', 'gold-registry.java.yml')
const THRESHOLDS = join(ROOT, 'standards', 'thresholds.yml')

// The jacoco.xml a JaCoCo tool emits (#1629). Its report-TOTAL counters (last in document order)
// encode the given percents directly: covered=pct, missed=100-pct ⇒ covered*100/(covered+missed)=pct.
// arbiter's Maven generator writes it to target/coverage/jacoco.xml, not the JaCoCo default (#1682).
const JACOCO_PATH = 'target/coverage/jacoco.xml'
function jacocoXml(pct: { line: number; branch: number; instruction: number }): string {
  const counter = (type: string, p: number): string =>
    `<counter type="${type}" missed="${100 - p}" covered="${p}"/>`
  return (
    '<report name="demo">' +
    counter('INSTRUCTION', pct.instruction) +
    counter('LINE', pct.line) +
    counter('BRANCH', pct.branch) +
    '</report>'
  )
}

/** A repo with the has-java overlay enabled and a configurable set of pre-generated reports. */
function makeJavaRepo(reports: Record<string, string> = {}): {
  dir: string
  cleanup: () => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'gold-java-test-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-profile'), 'overlays:\n  - has-java\n')
  for (const [rel, content] of Object.entries(reports)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function runJava(
  dir: string,
  cls: string,
): { status: number; byId: Record<string, { verdict: string; evidence: unknown }> } {
  const r = run(dir, [
    '--json',
    '--registry',
    JAVA_REGISTRY,
    '--thresholds',
    THRESHOLDS,
    '--class',
    cls,
  ])
  const j = JSON.parse(r.stdout)
  const byId = Object.fromEntries(
    j.checks.map((c: { id: string }) => [(c as { id: string }).id, c]),
  )
  return { status: r.status, byId }
}

describe('gold-audit --stack java (#1413 per-stack registry)', () => {
  it('absent reports → value checks score NA (no false-N), config checks score N', () => {
    const { dir, cleanup } = makeJavaRepo() // no reports, no config files at all
    try {
      const { byId } = runJava(dir, 'light')
      // value-op report check with an absent report file ⇒ NA
      expect(byId['JA-STYLE-02'].verdict).toBe('NA')
      expect(byId['JA-COV-03'].verdict).toBe('NA')
      expect(byId['JA-MUT-02'].verdict).toBe('NA')
      // a plain file_exists config check with the file absent ⇒ N (correctly a verified gap)
      expect(byId['JA-STYLE-01'].verdict).toBe('N')
    } finally {
      cleanup()
    }
  })

  it('non-java repo (overlay off) → every report check is NA (no false gaps)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-nojava-'))
    try {
      // no profile ⇒ has-java overlay is OFF ⇒ applies_if gates all checks to NA
      const { byId } = runJava(dir, 'gold')
      for (const id of Object.keys(byId)) {
        expect(byId[id].verdict).toBe('NA')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('present reports under the per-class bar → Y with evidence', () => {
    const { dir, cleanup } = makeJavaRepo({
      'target/checkstyle-result.xml': '<checkstyle><file><error/><error/></file></checkstyle>',
      [JACOCO_PATH]: jacocoXml({ line: 85, branch: 75, instruction: 85 }),
    })
    try {
      const { byId } = runJava(dir, 'light') // checkstyle bar 25, coverage.line 80, branch 70
      expect(byId['JA-STYLE-02'].verdict).toBe('Y') // 2 errors <= 25
      expect(byId['JA-COV-02'].verdict).toBe('Y') // line 85 >= 80
      expect(byId['JA-COV-03'].verdict).toBe('Y') // instruction 85 >= 80
      expect(byId['JA-COV-04'].verdict).toBe('Y') // branch 75 >= 70
      expect(byId['JA-STYLE-02'].evidence).toBeTruthy()
      expect((byId['JA-COV-02'].evidence as { file?: string }).file).toBe(JACOCO_PATH)
    } finally {
      cleanup()
    }
  })

  it('threshold_ref resolves per class — gold bar fails what light passes (same report)', () => {
    const reports = {
      [JACOCO_PATH]: jacocoXml({ line: 85, branch: 75, instruction: 85 }),
      'target/checkstyle-result.xml': '<checkstyle><file><error/><error/></file></checkstyle>',
    }
    const a = makeJavaRepo(reports)
    const b = makeJavaRepo(reports)
    try {
      const light = runJava(a.dir, 'light')
      const gold = runJava(b.dir, 'gold')
      // line coverage 85: light bar 80 ⇒ Y, gold bar 90 ⇒ N
      expect(light.byId['JA-COV-02'].verdict).toBe('Y')
      expect(gold.byId['JA-COV-02'].verdict).toBe('N')
      // checkstyle 2 errors: light bar 25 ⇒ Y, gold bar 0 ⇒ N
      expect(light.byId['JA-STYLE-02'].verdict).toBe('Y')
      expect(gold.byId['JA-STYLE-02'].verdict).toBe('N')
    } finally {
      a.cleanup()
      b.cleanup()
    }
  })

  it('is byte-stable across two runs (determinism)', () => {
    const { dir, cleanup } = makeJavaRepo({
      [JACOCO_PATH]: jacocoXml({ line: 85, branch: 75, instruction: 85 }),
    })
    try {
      const args = [
        '--json',
        '--registry',
        JAVA_REGISTRY,
        '--thresholds',
        THRESHOLDS,
        '--class',
        'medium',
      ]
      const a = run(dir, args).stdout
      const b = run(dir, args).stdout
      expect(a).toBe(b)
    } finally {
      cleanup()
    }
  })

  it('the shipped java registry has zero RISKY checks (--strict passes)', () => {
    const { dir, cleanup } = makeJavaRepo()
    try {
      const r = run(dir, ['--strict', '--registry', JAVA_REGISTRY, '--thresholds', THRESHOLDS])
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ── #1682: JaCoCo coverage path must match arbiter's emitted location (Maven vs Gradle) ──────────
//
// arbiter's Java generator emits JaCoCo XML to target/coverage/jacoco.xml (Maven) and
// build/coverage/coverage.xml (Gradle) — NOT the JaCoCo default target/site/jacoco/. The registry
// splits JA-COV into Maven (01-04) + Gradle (05-08) variants, each pointing at the REAL emitted
// path. file_exists report-present checks are gated by the build manifest (pom.xml / build.gradle)
// so the non-matching build tool NA's instead of false-N'ing; value-report checks self-gate (an
// absent report ⇒ NA, never a false-N). Only the active build tool's coverage is graded.
const MAVEN_JACOCO = 'target/coverage/jacoco.xml'
const GRADLE_JACOCO = 'build/coverage/coverage.xml'

describe('gold-audit --stack java: JaCoCo path matches the generator (#1682)', () => {
  it('Maven project: coverage report at target/coverage/jacoco.xml is found (NA→Y)', () => {
    const { dir, cleanup } = makeJavaRepo({
      'pom.xml': '<project/>',
      [MAVEN_JACOCO]: jacocoXml({ line: 85, branch: 75, instruction: 85 }),
    })
    try {
      const { byId } = runJava(dir, 'light') // coverage.line bar 80, coverage.branch bar 70
      // report-present (Maven, gated by pom.xml) ⇒ Y at the REAL emitted path
      expect(byId['JA-COV-01'].verdict).toBe('Y')
      // value-report checks read the REAL Maven path ⇒ Y (would be NA at the old default path)
      expect(byId['JA-COV-02'].verdict).toBe('Y') // line 85 >= 80
      expect(byId['JA-COV-03'].verdict).toBe('Y') // instruction 85 >= 80
      expect(byId['JA-COV-04'].verdict).toBe('Y') // branch 75 >= 70
      expect((byId['JA-COV-02'].evidence as { file?: string }).file).toBe(MAVEN_JACOCO)
      // the Gradle variants do not apply / find no report ⇒ NA, never a false-N
      expect(byId['JA-COV-05'].verdict).toBe('NA')
      expect(byId['JA-COV-06'].verdict).toBe('NA')
      expect(byId['JA-COV-07'].verdict).toBe('NA')
      expect(byId['JA-COV-08'].verdict).toBe('NA')
    } finally {
      cleanup()
    }
  })

  it('Gradle project: coverage report at build/coverage/coverage.xml is found (NA→Y)', () => {
    const { dir, cleanup } = makeJavaRepo({
      'build.gradle': "apply plugin: 'java'\n",
      [GRADLE_JACOCO]: jacocoXml({ line: 85, branch: 75, instruction: 85 }),
    })
    try {
      const { byId } = runJava(dir, 'light')
      // report-present (Gradle, gated by build.gradle) ⇒ Y at the REAL emitted path
      expect(byId['JA-COV-05'].verdict).toBe('Y')
      // value-report checks read the REAL Gradle path ⇒ Y (would be NA at the old default path)
      expect(byId['JA-COV-06'].verdict).toBe('Y') // line 85 >= 80
      expect(byId['JA-COV-07'].verdict).toBe('Y') // instruction 85 >= 80
      expect(byId['JA-COV-08'].verdict).toBe('Y') // branch 75 >= 70
      expect((byId['JA-COV-06'].evidence as { file?: string }).file).toBe(GRADLE_JACOCO)
      // the Maven variants do not apply / find no report ⇒ NA, never a false-N
      expect(byId['JA-COV-01'].verdict).toBe('NA')
      expect(byId['JA-COV-02'].verdict).toBe('NA')
      expect(byId['JA-COV-03'].verdict).toBe('NA')
      expect(byId['JA-COV-04'].verdict).toBe('NA')
    } finally {
      cleanup()
    }
  })
})
