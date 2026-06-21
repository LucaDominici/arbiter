// SPDX-License-Identifier: Apache-2.0
// TDD: terminal colour-capability gate (#1475, epic #1469).
import { describe, it, expect } from 'vitest'
import { colorEnabled, asciiOnly, paint } from '../../src/utils/tty.js'

describe('colorEnabled (#1475)', () => {
  it('true on a TTY with a clean env', () => {
    expect(colorEnabled({ isTTY: true }, {})).toBe(true)
  })
  it('false when not a TTY (piped / redirected)', () => {
    expect(colorEnabled({ isTTY: false }, {})).toBe(false)
    expect(colorEnabled({}, {})).toBe(false)
  })
  it('false when NO_COLOR is set (any value, per no-color.org)', () => {
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: '1' })).toBe(false)
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: '' })).toBe(false)
  })
  it('false in CI', () => {
    expect(colorEnabled({ isTTY: true }, { CI: 'true' })).toBe(false)
  })
  it("false when TERM is 'dumb'", () => {
    expect(colorEnabled({ isTTY: true }, { TERM: 'dumb' })).toBe(false)
    expect(colorEnabled({ isTTY: true }, { TERM: 'xterm-256color' })).toBe(true)
  })
})

describe('asciiOnly (#1475)', () => {
  it('true when explicitly requested', () => {
    expect(asciiOnly(true, {})).toBe(true)
  })
  it('true for a C / POSIX locale', () => {
    expect(asciiOnly(false, { LANG: 'C' })).toBe(true)
    expect(asciiOnly(false, { LC_ALL: 'POSIX' })).toBe(true)
  })
  it('false for a UTF-8 locale', () => {
    expect(asciiOnly(false, { LANG: 'en_US.UTF-8' })).toBe(false)
    expect(asciiOnly(false, {})).toBe(false)
  })
})

describe('paint (#1475)', () => {
  it('wraps in ANSI when on, leaves untouched when off', () => {
    expect(paint('x', 'green', true)).toBe('\x1b[32mx\x1b[0m')
    expect(paint('x', 'green', false)).toBe('x')
  })
  it('the off form contains ZERO ANSI escapes (byte-deterministic)', () => {
    expect(paint('hello', 'red', false)).not.toContain('\x1b')
  })
})
