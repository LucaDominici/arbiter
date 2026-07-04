import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve('.')

function readTrackModel(): string {
  // #1242: TRACK_MODEL folded into the consolidated docs/internal/METHOD/PROCESS.md.
  // The `## Tracks` / `### \`name\`` substructure is preserved verbatim there.
  return readFileSync(resolve(REPO_ROOT, 'docs/internal/METHOD/PROCESS.md'), 'utf-8')
}

function readLabelsYaml(): string {
  return readFileSync(resolve(REPO_ROOT, '.github/labels.yml'), 'utf-8')
}

/**
 * Extract track names from TRACK_MODEL.md. Tracks are documented as
 * `### \`<name>\`` headings under a top-level `## Tracks` section.
 */
function extractTrackNames(doc: string): string[] {
  const lines = doc.split('\n')
  let inTracks = false
  const names: string[] = []
  for (const raw of lines) {
    if (/^##\s+Tracks\s*$/.test(raw)) {
      inTracks = true
      continue
    }
    if (inTracks && /^##\s+/.test(raw) && !/^##\s+Tracks\s*$/.test(raw)) {
      break
    }
    if (!inTracks) continue
    const m = /^###\s+`([^`]+)`\s*$/.exec(raw)
    if (m) names.push(m[1])
  }
  return names
}

/**
 * For a given track name, find its section and return bullet body map.
 */
function readTrackSection(doc: string, name: string): Record<string, string> {
  const lines = doc.split('\n')
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headingRe = new RegExp(`^###\\s+\`${escaped}\``)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) return {}
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###\s+`/.test(lines[i]) || /^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  const body = lines.slice(start, end).join('\n')
  const out: Record<string, string> = {}
  const bulletRe = /^-\s+\*\*([^*]+):\*\*\s+(.+?)$/gm
  let m: RegExpExecArray | null
  while ((m = bulletRe.exec(body)) !== null) {
    out[m[1].trim()] = m[2].trim()
  }
  return out
}

describe('docs/METHOD/TRACK_MODEL.md track-coverage (#975)', () => {
  it('extracts at least 6 named tracks (core/templates/kit/docs/ci/meta)', () => {
    const doc = readTrackModel()
    const tracks = extractTrackNames(doc)
    expect(tracks).toEqual(
      expect.arrayContaining(['core', 'templates', 'kit', 'docs', 'ci', 'meta']),
    )
  })

  it('every track has a matching label in .github/labels.yml', () => {
    const tracks = extractTrackNames(readTrackModel())
    const labels = readLabelsYaml()
    for (const t of tracks) {
      const re = new RegExp(`^\\s*-\\s+name:\\s*"track:\\s*${t}"\\s*$`, 'm')
      expect(re.test(labels), `expected track label for ${t}`).toBe(true)
    }
  })

  it('every track label uses color cccccc and has a non-empty description', () => {
    const tracks = extractTrackNames(readTrackModel())
    const labels = readLabelsYaml()
    for (const t of tracks) {
      const blockRe = new RegExp(
        `^\\s*-\\s+name:\\s*"track:\\s*${t}"\\s*\\n\\s*color:\\s*"([0-9a-fA-F]{6})"\\s*\\n\\s*description:\\s*"([^"]+)"`,
        'm',
      )
      const m = blockRe.exec(labels)
      expect(m, `track ${t} label block missing color or description`).not.toBeNull()
      if (m) {
        expect(m[1].toLowerCase()).toBe('cccccc')
        expect(m[2].length).toBeGreaterThan(0)
      }
    }
  })

  it('every track defines Scope, Owners, and CI gate subset', () => {
    const doc = readTrackModel()
    const tracks = extractTrackNames(doc)
    for (const t of tracks) {
      const section = readTrackSection(doc, t)
      expect(section, `track ${t} must have Scope bullet`).toHaveProperty('Scope')
      expect(section, `track ${t} must have Owners bullet`).toHaveProperty('Owners')
      expect(section, `track ${t} must have CI gate subset bullet`).toHaveProperty('CI gate subset')
      expect(section['Scope']?.length ?? 0).toBeGreaterThan(0)
      expect(section['Owners']?.length ?? 0).toBeGreaterThan(0)
      expect(section['CI gate subset']?.length ?? 0).toBeGreaterThan(0)
    }
  })
})
