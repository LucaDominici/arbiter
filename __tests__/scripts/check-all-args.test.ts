import { describe, it, expect } from 'vitest'
import {
  effectiveGateLevel,
  parseCheckArgs,
  SUBCOMMANDS,
  LEVELS,
} from '../../scripts/lib/parse-check-args.mjs'

describe('parseCheckArgs — subcommands', () => {
  it('defaults to gate subcommand when no args given', () => {
    expect(parseCheckArgs([]).subcommand).toBe('gate')
  })

  it.each(SUBCOMMANDS)('recognises explicit subcommand %s', (sub) => {
    expect(parseCheckArgs([sub]).subcommand).toBe(sub)
  })

  it('uses last explicit subcommand when multiple given', () => {
    expect(parseCheckArgs(['check', 'full']).subcommand).toBe('full')
  })
})

describe('parseCheckArgs — back-compat aliases', () => {
  it('L1 maps to check subcommand with level L1', () => {
    const r = parseCheckArgs(['L1'])
    expect(r.subcommand).toBe('check')
    expect(r.level).toBe('L1')
  })

  it('L2 maps to gate subcommand with level L2', () => {
    const r = parseCheckArgs(['L2'])
    expect(r.subcommand).toBe('gate')
    expect(r.level).toBe('L2')
  })

  it('L3 maps to gate subcommand with level L3', () => {
    const r = parseCheckArgs(['L3'])
    expect(r.subcommand).toBe('gate')
    expect(r.level).toBe('L3')
  })

  it('explicit subcommand takes precedence over back-compat level alias', () => {
    const r = parseCheckArgs(['check', 'L2'])
    expect(r.subcommand).toBe('check')
    expect(r.level).toBe('L2')
  })

  it('check evidence is always L1, even when a higher level is supplied', () => {
    expect(effectiveGateLevel(parseCheckArgs(['check']))).toBe('L1')
    expect(effectiveGateLevel(parseCheckArgs(['check', '--level', 'L3']))).toBe('L1')
  })
})

describe('parseCheckArgs — --level flag', () => {
  it('defaults to L2 when no level given', () => {
    expect(parseCheckArgs([]).level).toBe('L2')
  })

  it.each(LEVELS)('--level %s sets level', (lv) => {
    expect(parseCheckArgs(['--level', lv]).level).toBe(lv)
  })

  it('--level overrides back-compat alias position', () => {
    const r = parseCheckArgs(['L1', '--level', 'L3'])
    expect(r.level).toBe('L3')
    expect(r.subcommand).toBe('check')
  })
})

describe('parseCheckArgs — --lang flag', () => {
  it('defaults to null (all langs)', () => {
    expect(parseCheckArgs([]).langs).toBeNull()
  })

  it('parses comma-separated langs', () => {
    expect(parseCheckArgs(['--lang', 'java,go']).langs).toEqual(['java', 'go'])
  })

  it('parses single lang', () => {
    expect(parseCheckArgs(['--lang', 'rust']).langs).toEqual(['rust'])
  })
})

describe('parseCheckArgs — --no-mutation flag', () => {
  it('defaults to false', () => {
    expect(parseCheckArgs([]).noMutation).toBe(false)
  })

  it('sets noMutation true', () => {
    expect(parseCheckArgs(['--no-mutation']).noMutation).toBe(true)
  })
})

describe('parseCheckArgs — --json flag', () => {
  it('defaults to null (write to default path)', () => {
    expect(parseCheckArgs([]).jsonPath).toBeNull()
  })

  it('--json with path sets jsonPath', () => {
    expect(parseCheckArgs(['--json', '/tmp/out.json']).jsonPath).toBe('/tmp/out.json')
  })

  it('--json without path sets jsonPath to empty string (trigger default path)', () => {
    expect(parseCheckArgs(['--json']).jsonPath).toBe('')
  })

  it('--json followed by another flag uses default path', () => {
    expect(parseCheckArgs(['--json', '--level', 'L1']).jsonPath).toBe('')
  })
})
