// #2571: the whole-repo `prettier --check .` cannot infer a parser for `*.<ext>.ejs`
// and silently exits 0 on every one of them — this gate checks the content each
// template EMITS (the tag-free half) instead of skipping it.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-emitted-formatting.mjs')

function run(
  templatesDir: string,
  baselineFile: string,
  extraArgs: string[] = [],
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    'node',
    [SCRIPT, `--templates=${templatesDir}`, `--baseline=${baselineFile}`, ...extraArgs],
    { encoding: 'utf-8', cwd: resolve('.') },
  )
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'canon2571-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-emitted-formatting.mjs (#2571)', () => {
  it('exits 0 when every tag-free, parsable template is prettier-clean', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tmplDir = join(dir, 'templates')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tmplDir)
      writeFileSync(join(tmplDir, 'clean.json.ejs'), '{ "a": 1 }\n')
      writeFileSync(baseline, '0')
      expect(run(tmplDir, baseline).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 and names the template when a tag-free template is mis-formatted (regression)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tmplDir = join(dir, 'templates')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tmplDir)
      // Two spaces of indent + no trailing newline — prettier reformats this.
      writeFileSync(join(tmplDir, 'dirty.json.ejs'), '{\n  "a":1\n}')
      writeFileSync(baseline, '0')
      const result = run(tmplDir, baseline)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('regression')
      expect(result.stdout).toContain('dirty.json.ejs')
    } finally {
      cleanup()
    }
  })

  it('skips a tag-bearing template (contains EJS tags) instead of failing on it', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tmplDir = join(dir, 'templates')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tmplDir)
      // Not valid JSON on its own (EJS tag) and mis-indented — must not count against the gate.
      writeFileSync(join(tmplDir, 'tagged.json.ejs'), '{\n  "a": <%- value %>\n}')
      writeFileSync(baseline, '0')
      const result = run(tmplDir, baseline)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('is fail-closed: a template prettier cannot parse counts as mis-formatted, named', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tmplDir = join(dir, 'templates')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tmplDir)
      // .json extension but not valid JSON and no EJS tag — prettier throws parsing it.
      writeFileSync(join(tmplDir, 'broken.json.ejs'), '{ not valid json')
      writeFileSync(baseline, '0')
      const result = run(tmplDir, baseline)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('broken.json.ejs')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when the mis-formatted count improves below baseline without being banked', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tmplDir = join(dir, 'templates')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tmplDir)
      writeFileSync(join(tmplDir, 'clean.json.ejs'), '{ "a": 1 }\n')
      writeFileSync(baseline, '3')
      const r = run(tmplDir, baseline)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('unbanked improvement')
      const banked = run(tmplDir, baseline, ['--update-baseline'])
      expect(banked.status).toBe(0)
      expect(run(tmplDir, baseline).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails closed when the baseline file is blank/malformed instead of parsing to NaN and passing', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tmplDir = join(dir, 'templates')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tmplDir)
      writeFileSync(join(tmplDir, 'clean.json.ejs'), '{ "a": 1 }\n')
      writeFileSync(baseline, '') // blank — must not parse to NaN and silently pass
      const result = run(tmplDir, baseline)
      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toContain('baseline')
    } finally {
      cleanup()
    }
  })

  it('passes against the real templates and committed baseline', () => {
    const result = run(resolve('src/templates'), resolve('.emitted-formatting-baseline.txt'))
    expect(result.status).toBe(0)
  })
})
