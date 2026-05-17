// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { detectTracks, TRACK_PATTERNS } from '../../scripts/detect-track.mjs'

describe('TRACK_PATTERNS', () => {
  it('exports FE_RE, BE_RE, DOCS_RE', () => {
    expect(TRACK_PATTERNS.FE_RE).toBeInstanceOf(RegExp)
    expect(TRACK_PATTERNS.BE_RE).toBeInstanceOf(RegExp)
    expect(TRACK_PATTERNS.DOCS_RE).toBeInstanceOf(RegExp)
  })
})

describe('detectTracks()', () => {
  it('empty list returns no tracks', () => {
    expect(detectTracks([])).toEqual({ tracks: [], hasFE: false, hasBE: false, hasDocs: false })
  })

  it('pure FE by extension', () => {
    const r = detectTracks(['web/App.tsx', 'src/styles.scss'])
    expect(r).toMatchObject({ hasFE: true, hasBE: false, hasDocs: false })
    expect(r.tracks).toEqual(['frontend'])
  })

  it('pure FE by path prefix', () => {
    const r = detectTracks(['frontend/index.html'])
    expect(r).toMatchObject({ hasFE: true, hasBE: false, hasDocs: false })
  })

  it('pure BE by extension (.go)', () => {
    const r = detectTracks(['api/server.go'])
    expect(r).toMatchObject({ hasFE: false, hasBE: true, hasDocs: false })
    expect(r.tracks).toEqual(['backend'])
  })

  it('pure BE by extension (.py)', () => {
    expect(detectTracks(['cmd/main.py'])).toMatchObject({ hasBE: true })
  })

  it('pure BE by extension (.java)', () => {
    expect(detectTracks(['src/Main.java'])).toMatchObject({ hasBE: true })
  })

  it('pure BE by extension (.rs)', () => {
    expect(detectTracks(['src/lib.rs'])).toMatchObject({ hasBE: true })
  })

  it('pure BE by extension (.rb)', () => {
    expect(detectTracks(['app/model.rb'])).toMatchObject({ hasBE: true })
  })

  it('pure Docs by extension (.md)', () => {
    const r = detectTracks(['docs/INDEX.md'])
    expect(r).toMatchObject({ hasFE: false, hasBE: false, hasDocs: true })
    expect(r.tracks).toEqual(['docs'])
  })

  it('pure Docs by path prefix', () => {
    expect(detectTracks(['docs/guide.txt'])).toMatchObject({ hasDocs: true })
  })

  it('mixed FE+BE', () => {
    const r = detectTracks(['web/App.tsx', 'api/server.go'])
    expect(r).toMatchObject({ hasFE: true, hasBE: true, hasDocs: false })
    expect(r.tracks).toEqual(['frontend', 'backend'])
  })

  it('all three tracks', () => {
    const r = detectTracks(['web/App.tsx', 'api/server.go', 'docs/INDEX.md'])
    expect(r).toMatchObject({ hasFE: true, hasBE: true, hasDocs: true })
    expect(r.tracks).toEqual(['frontend', 'backend', 'docs'])
  })

  it('track order is always frontend, backend, docs', () => {
    // docs-only then add FE — order must be stable
    const r = detectTracks(['docs/X.md', 'src/styles.css', 'api/s.go'])
    expect(r.tracks).toEqual(['frontend', 'backend', 'docs'])
  })

  it('ambiguous: frontend/server.go — path prefix wins for FE (extension wins for BE too)', () => {
    // Both FE path prefix and BE extension match — both tracks emitted
    const r = detectTracks(['frontend/server.go'])
    expect(r.hasFE).toBe(true)
    expect(r.hasBE).toBe(true)
  })

  it('ignores non-source files (json, lock files, binaries)', () => {
    const r = detectTracks(['package-lock.json', 'yarn.lock', 'README.md'])
    // README.md is in root, not docs/ — still matches .md extension? No: DOCS_RE matches .md
    expect(r.hasFE).toBe(false)
    expect(r.hasBE).toBe(false)
    // README.md DOES match .md → hasDocs true (correct: any .md is docs-adjacent)
    expect(r.hasDocs).toBe(true)
  })

  it('ignores ambiguous: *.tsx.bak does not match tsx extension (no path prefix)', () => {
    // src/ has no FE path prefix and .tsx.bak does not end in .tsx — hasFE must be false
    const r = detectTracks(['src/App.tsx.bak'])
    expect(r.hasFE).toBe(false)
  })

  it('CRLF in file paths is stripped before matching', () => {
    const r = detectTracks(['web/App.tsx\r', 'api/server.go\r'])
    expect(r.hasFE).toBe(true)
    expect(r.hasBE).toBe(true)
  })

  it('Unicode/whitespace in paths does not crash', () => {
    expect(() => detectTracks(['src/été.tsx', '  spa ces.go  '])).not.toThrow()
  })

  it('.jsx matches FE', () => {
    expect(detectTracks(['src/App.jsx'])).toMatchObject({ hasFE: true })
  })

  it('.vue matches FE', () => {
    expect(detectTracks(['src/App.vue'])).toMatchObject({ hasFE: true })
  })

  it('.svelte matches FE', () => {
    expect(detectTracks(['src/App.svelte'])).toMatchObject({ hasFE: true })
  })

  it('.css matches FE', () => {
    expect(detectTracks(['src/styles.css'])).toMatchObject({ hasFE: true })
  })

  it('web/ prefix matches FE', () => {
    expect(detectTracks(['web/index.html'])).toMatchObject({ hasFE: true })
  })

  it('backend/ prefix matches BE (handler.ts also triggers FE via .ts extension)', () => {
    // backend/ path prefix → hasBE; .ts extension → hasFE; both tracks emitted
    expect(detectTracks(['backend/handler.ts'])).toMatchObject({ hasBE: true, hasFE: true })
  })

  it('server/ prefix matches BE', () => {
    expect(detectTracks(['server/main.go'])).toMatchObject({ hasBE: true, hasFE: false })
  })
})
