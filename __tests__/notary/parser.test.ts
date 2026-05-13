import { describe, it, expect } from 'vitest'
import { parseNotaryFooter, validateNotaryFooter } from '../../src/notary/parser.js'

const VALID_FOOTER = `feat(#256): add notary system

Some commit body.

Notary:
- Delta: docs/SYSTEM/CANON.md §Overview (modify, +3 -1)
- Intent: extend canon list per #256
- Patch: docs/SSOT_CORE_SET.md (update), docs/KNOWLEDGE_MAP.md (N/A)`

describe('parseNotaryFooter', () => {
  it('returns null when no Notary: block present', () => {
    expect(parseNotaryFooter('feat: no footer here')).toBeNull()
  })

  it('parses a complete Notary block', () => {
    const result = parseNotaryFooter(VALID_FOOTER)
    expect(result).not.toBeNull()
    expect(result?.deltas).toHaveLength(1)
    expect(result?.intent).toBe('extend canon list per #256')
    expect(result?.patches).toHaveLength(2)
  })

  it('parses delta fields correctly', () => {
    const result = parseNotaryFooter(VALID_FOOTER)
    const delta = result?.deltas[0]
    expect(delta?.file).toBe('docs/SYSTEM/CANON.md')
    expect(delta?.section).toBe('Overview')
    expect(delta?.changeType).toBe('modify')
    expect(delta?.added).toBe(3)
    expect(delta?.removed).toBe(1)
  })

  it('parses patch entries', () => {
    const result = parseNotaryFooter(VALID_FOOTER)
    expect(result?.patches[0]).toMatchObject({ file: 'docs/SSOT_CORE_SET.md', status: 'update' })
    expect(result?.patches[1]).toMatchObject({ file: 'docs/KNOWLEDGE_MAP.md', status: 'N/A' })
  })

  it('handles multiple Delta lines', () => {
    const msg = `feat: multi delta

Notary:
- Delta: docs/A.md §Section1 (add, +5 -0)
- Delta: docs/B.md §Section2 (modify, +1 -2)
- Intent: document two changes
- Patch: docs/INDEX.md (update)`
    const result = parseNotaryFooter(msg)
    expect(result?.deltas).toHaveLength(2)
  })
})

describe('validateNotaryFooter', () => {
  it('passes a valid footer', () => {
    const parsed = parseNotaryFooter(VALID_FOOTER)
    expect(parsed).not.toBeNull()
    const errors = validateNotaryFooter(parsed!)
    expect(errors).toEqual([])
  })

  it('fails when deltas is empty', () => {
    const errors = validateNotaryFooter({
      deltas: [],
      intent: 'some intent',
      patches: [{ file: 'docs/INDEX.md', status: 'update' }],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/delta/i)
  })

  it('fails when intent is empty', () => {
    const errors = validateNotaryFooter({
      deltas: [{ file: 'docs/A.md', section: 'S', changeType: 'modify', added: 1, removed: 0 }],
      intent: '',
      patches: [{ file: 'docs/X.md', status: 'N/A' }],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/intent/i)
  })

  it('fails when patches is empty', () => {
    const errors = validateNotaryFooter({
      deltas: [{ file: 'docs/A.md', section: 'S', changeType: 'add', added: 3, removed: 0 }],
      intent: 'add new section',
      patches: [],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/patch/i)
  })
})
