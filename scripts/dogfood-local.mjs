#!/usr/bin/env node
// Local replica of .github/workflows/real-project-matrix.yml.
// For each fixture × declared level: stage to tmpdir, install lang deps,
// run `arbiter init --yes --no-verify --level=$LEVEL`, `arbiter verify`,
// then the generated `scripts/check-all.mjs $LEVEL` inside the staged project.
// Writes results.json + report.md under .arbiter/evidence/dogfood/<ts>/.
// Exit 0 if pass count ≥ MIN_PASS (default 10, mirrors workflow aggregate floor).

import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const REPO = resolve(dirname(__filename), '..')
const DIST_CLI = join(REPO, 'dist', 'cli.js')

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=')
      return [k, v ?? 'true']
    }),
)

const LEVELS_FILTER = args.levels ? args.levels.split(',') : null
const FIXTURE_FILTER = args.filter ?? null
const MIN_PASS = Number(args['min-pass'] ?? 10)
const CELL_TIMEOUT_MS = Number(args['cell-timeout'] ?? 30 * 60 * 1000)
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const WORKDIR = args.workdir ?? join('/tmp', `arbiter-dogfood-${STAMP}`)
const EVIDENCE_DIR = join(REPO, '.arbiter', 'evidence', 'dogfood', STAMP)

mkdirSync(WORKDIR, { recursive: true })
mkdirSync(EVIDENCE_DIR, { recursive: true })

// Toolchain PATH injection — must match Phase 0 install locations.
const HOME = homedir()
const EXTRA_PATH = [
  join(HOME, '.local', 'go', 'bin'),
  join(HOME, 'go', 'bin'),
  join(HOME, '.sdkman', 'candidates', 'gradle', 'current', 'bin'),
  join(HOME, '.local', 'bin'),
  join(HOME, '.cargo', 'bin'),
  join(HOME, 'tools', 'bin'),
].join(':')
const CHILD_ENV = {
  ...process.env,
  PATH: `${EXTRA_PATH}:${process.env.PATH ?? ''}`,
  GOPATH: process.env.GOPATH ?? join(HOME, 'go'),
}

if (!existsSync(DIST_CLI)) {
  console.error(`error: ${DIST_CLI} missing — run \`npm run build\` first`)
  process.exit(2)
}

// 1. Build matrix
const matrixOut = execFileSync('node', [join(REPO, 'scripts', 'build-matrix.mjs')], {
  cwd: REPO,
  encoding: 'utf-8',
})
const matrixJson = JSON.parse(matrixOut.replace(/^matrix=/, ''))
let cells = matrixJson.include

if (FIXTURE_FILTER) {
  const re = new RegExp('^' + FIXTURE_FILTER.replace(/\*/g, '.*') + '$')
  cells = cells.filter((c) => re.test(c.fixture))
}
if (LEVELS_FILTER) {
  cells = cells.filter((c) => LEVELS_FILTER.includes(c.level))
}

if (cells.length === 0) {
  console.error('error: no cells match filters')
  process.exit(2)
}

console.log(`▶ ${cells.length} cells | workdir=${WORKDIR} | evidence=${EVIDENCE_DIR}`)

// 2. Per-cell execution
const results = []
const t0 = Date.now()

function step(name, cmd, argv, cwd) {
  const sT = Date.now()
  const r = spawnSync(cmd, argv, {
    cwd,
    env: CHILD_ENV,
    encoding: 'utf-8',
    timeout: CELL_TIMEOUT_MS,
    maxBuffer: 50 * 1024 * 1024,
  })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  return {
    step: name,
    ok: r.status === 0,
    exit: r.status,
    durationMs: Date.now() - sT,
    tail: out.split('\n').slice(-30).join('\n'),
  }
}

function preInitDeps(language, cwd) {
  // Plain `npm install` — strict peer resolution on. The `--legacy-peer-deps` escape
  // hatch was dropped (#1557): it was inherited from arbiter's own .npmrc to mask a
  // single dev-tree peer clash and does not belong in a generated project's install.
  if (language === 'typescript') return step('npm-install', 'npm', ['install'], cwd)
  if (language === 'python')
    return step(
      'pip-install',
      'pip',
      ['install', '--user', '--break-system-packages', '-e', '.[test]'],
      cwd,
    )
  if (language === 'go') return step('go-mod-download', 'go', ['mod', 'download'], cwd)
  if (language === 'java') {
    const grw = join(cwd, 'gradlew')
    if (existsSync(grw)) {
      execFileSync('chmod', ['+x', grw])
    }
    return { step: 'java-prep', ok: true, exit: 0, durationMs: 0, tail: '' }
  }
  return { step: 'no-pre-init', ok: true, exit: 0, durationMs: 0, tail: '' }
}

for (let i = 0; i < cells.length; i++) {
  const cell = cells[i]
  const tag = `[${i + 1}/${cells.length}] ${cell.fixture}@${cell.level}`
  const cellWork = join(WORKDIR, `${cell.fixture}-${cell.level}`)
  const cellStart = Date.now()
  const steps = []
  let failingStep = null

  process.stdout.write(`${tag} ... `)

  try {
    rmSync(cellWork, { recursive: true, force: true })
    cpSync(join(REPO, '__tests__', 'fixtures', 'real-projects', cell.fixture), cellWork, {
      recursive: true,
    })

    const order = [
      () => preInitDeps(cell.language, cellWork),
      () =>
        step(
          'init',
          'node',
          [DIST_CLI, 'init', '--yes', '--no-verify', `--level=${cell.level}`],
          cellWork,
        ),
      () => step('verify', 'node', [DIST_CLI, 'verify'], cellWork),
      () => step('check-all', 'node', [join('scripts', 'check-all.mjs'), cell.level], cellWork),
    ]

    for (const s of order) {
      const r = s()
      steps.push(r)
      if (!r.ok) {
        failingStep = r.step
        break
      }
    }
  } catch (e) {
    steps.push({ step: 'driver-exception', ok: false, exit: -1, durationMs: 0, tail: String(e) })
    failingStep = 'driver-exception'
  }

  const status = failingStep ? 'fail' : 'pass'
  const durationMs = Date.now() - cellStart
  const dur = `${(durationMs / 1000).toFixed(1)}s`
  const verdict = status === 'pass' ? '\x1b[32mPASS\x1b[0m' : `\x1b[31mFAIL\x1b[0m (${failingStep})`
  console.log(`${verdict} ${dur}`)

  results.push({
    fixture: cell.fixture,
    language: cell.language,
    archetype: cell.archetype,
    level: cell.level,
    status,
    failingStep,
    durationMs,
    steps,
    workdir: cellWork,
  })

  // Persist incrementally — survive driver crashes.
  writeFileSync(join(EVIDENCE_DIR, 'results.json'), JSON.stringify({ results }, null, 2))
}

const totalMs = Date.now() - t0
const passes = results.filter((r) => r.status === 'pass').length
const fails = results.length - passes

// 3. Report markdown
const fixtures = [...new Set(results.map((r) => r.fixture))].sort()
const levels = [...new Set(results.map((r) => r.level))].sort()
const cellByKey = new Map(results.map((r) => [`${r.fixture}::${r.level}`, r]))

let md = `# Dogfood Local Run — ${STAMP}\n\n`
md += `- Cells: ${results.length}\n- Pass: ${passes}\n- Fail: ${fails}\n- Wall-clock: ${(totalMs / 1000 / 60).toFixed(1)} min\n- Pass floor (MIN_PASS=${MIN_PASS}): **${passes >= MIN_PASS ? 'MET' : 'NOT MET'}**\n\n`

md += `## Matrix\n\n| Fixture | Language | ${levels.join(' | ')} |\n`
md += `|---|---|${levels.map(() => '---').join('|')}|\n`
for (const f of fixtures) {
  const lang = results.find((r) => r.fixture === f)?.language ?? ''
  const cellsCols = levels.map((lv) => {
    const r = cellByKey.get(`${f}::${lv}`)
    if (!r) return '—'
    if (r.status === 'pass') return `✅ ${(r.durationMs / 1000).toFixed(0)}s`
    return `❌ ${r.failingStep}`
  })
  md += `| ${f} | ${lang} | ${cellsCols.join(' | ')} |\n`
}

md += `\n## Failures\n\n`
const failed = results.filter((r) => r.status === 'fail')
if (failed.length === 0) md += '_None._\n'
else {
  for (const r of failed) {
    md += `### ${r.fixture} @ ${r.level} — failed at \`${r.failingStep}\`\n\n`
    const lastStep = r.steps[r.steps.length - 1]
    md += '```\n' + (lastStep?.tail ?? '(no tail)') + '\n```\n\n'
  }
}

writeFileSync(join(EVIDENCE_DIR, 'report.md'), md)

console.log(`\n▶ ${passes}/${results.length} pass | ${(totalMs / 1000 / 60).toFixed(1)} min`)
console.log(`▶ report: ${join(EVIDENCE_DIR, 'report.md')}`)

process.exit(passes >= MIN_PASS ? 0 : 1)
