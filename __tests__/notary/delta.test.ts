import { describe, it, expect } from 'vitest'
import { diffMarkdownSections } from '../../src/notary/delta.js'

describe('diffMarkdownSections', () => {
  it('returns empty array when content is identical', () => {
    const md = '# Heading\n\nSome content.\n'
    expect(diffMarkdownSections(md, md)).toEqual([])
  })

  it('detects an added section', () => {
    const before = '# Existing\n\nContent.\n'
    const after = '# Existing\n\nContent.\n\n# New Section\n\nNew content.\n'
    const diffs = diffMarkdownSections(before, after)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({
      section: 'New Section',
      type: 'add',
    })
  })

  it('detects a deleted section', () => {
    const before = '# Existing\n\nContent.\n\n# ToRemove\n\nOld text.\n'
    const after = '# Existing\n\nContent.\n'
    const diffs = diffMarkdownSections(before, after)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({
      section: 'ToRemove',
      type: 'delete',
    })
  })

  it('detects a modified section (content change)', () => {
    const before = '# Section\n\nOriginal text here.\n'
    const after = '# Section\n\nModified text here with more.\n'
    const diffs = diffMarkdownSections(before, after)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({
      section: 'Section',
      type: 'modify',
    })
  })

  it('includes line delta for modified section', () => {
    const before = '# Section\n\nLine one.\nLine two.\n'
    const after = '# Section\n\nLine one.\nLine two.\nLine three.\nLine four.\n'
    const diffs = diffMarkdownSections(before, after)
    expect(diffs[0]).toMatchObject({
      type: 'modify',
      added: 2,
      removed: 0,
    })
  })

  it('handles h2 sections (## heading)', () => {
    const before = '# Doc\n\n## Section A\n\nContent A.\n'
    const after = '# Doc\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.\n'
    const diffs = diffMarkdownSections(before, after)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ section: 'Section B', type: 'add' })
  })

  it('returns delta with added/removed line counts', () => {
    const before = '# S\n\nA\nB\nC\n'
    const after = '# S\n\nA\n'
    const diffs = diffMarkdownSections(before, after)
    expect(diffs[0]).toMatchObject({ type: 'modify', removed: 2, added: 0 })
  })
})
