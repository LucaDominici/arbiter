import { describe, it, expect } from 'vitest'
import { mergeSettingsJson } from '../../src/utils/fs.js'

describe('mergeSettingsJson', () => {
  it('preserves existing keys not in incoming', () => {
    const existing = { customKey: 'myvalue' }
    const incoming = { newKey: 'newvalue' }
    const result = mergeSettingsJson(existing, incoming)
    expect(result).toEqual({ customKey: 'myvalue', newKey: 'newvalue' })
  })

  it('does not overwrite existing non-special keys', () => {
    const existing = { theme: 'dark' }
    const incoming = { theme: 'light' }
    const result = mergeSettingsJson(existing, incoming)
    expect(result.theme).toBe('dark')
  })

  it('unions hook entries by matcher', () => {
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'existing.sh' }],
          },
        ],
      },
    }
    const incoming = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'new.sh' }] },
          {
            matcher: 'Edit',
            hooks: [{ type: 'command', command: 'edit-hook.sh' }],
          },
        ],
      },
    }
    const result = mergeSettingsJson(existing, incoming) as Record<string, unknown>
    const hooks = result.hooks as Record<
      string,
      { matcher: string; hooks: { command: string }[] }[]
    >
    const preToolUse = hooks.PreToolUse

    // Existing Bash matcher should have both hooks
    const bashEntry = preToolUse.find((e) => e.matcher === 'Bash')
    expect(bashEntry!.hooks).toHaveLength(2)
    expect(bashEntry!.hooks.map((h) => h.command)).toContain('existing.sh')
    expect(bashEntry!.hooks.map((h) => h.command)).toContain('new.sh')

    // New Edit matcher should be added
    const editEntry = preToolUse.find((e) => e.matcher === 'Edit')
    expect(editEntry).toBeDefined()
  })

  it('does not duplicate hooks with same command', () => {
    const existing = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'stop.sh' }] }],
      },
    }
    const incoming = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'stop.sh' }] }],
      },
    }
    const result = mergeSettingsJson(existing, incoming) as Record<string, unknown>
    const hooks = result.hooks as Record<
      string,
      { matcher: string; hooks: { command: string }[] }[]
    >
    expect(hooks.PreToolUse[0].hooks).toHaveLength(1)
  })

  it('unions permission arrays', () => {
    const existing = { permissions: { allow: ['read'], deny: ['admin'] } }
    const incoming = {
      permissions: { allow: ['read', 'write'], deny: ['admin', 'delete'] },
    }
    const result = mergeSettingsJson(existing, incoming) as Record<string, unknown>
    const perms = result.permissions as { allow: string[]; deny: string[] }
    expect(perms.allow).toEqual(expect.arrayContaining(['read', 'write']))
    expect(perms.deny).toEqual(expect.arrayContaining(['admin', 'delete']))
  })

  it('handles empty existing object', () => {
    const incoming = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x.sh' }] }],
      },
    }
    const result = mergeSettingsJson({}, incoming)
    expect(result).toEqual(incoming)
  })
})
