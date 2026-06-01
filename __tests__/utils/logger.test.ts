// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { Writable } from 'node:stream'
import { Logger } from '../../src/utils/logger.js'

class CapturingStream extends Writable {
  chunks: string[] = []
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.chunks.push(chunk.toString())
    cb()
  }
  lines(): string[] {
    return this.chunks
      .join('')
      .split('\n')
      .filter((l) => l.length > 0)
  }
}

describe('Logger level filtering', () => {
  it('drops records below configured minimum level', () => {
    const stream = new CapturingStream()
    const logger = new Logger({ level: 'warn', format: 'text', stream })
    logger.error('err-event')
    logger.warn('warn-event')
    logger.info('info-event')
    logger.debug('debug-event')
    const lines = stream.lines()
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain('err-event')
    expect(lines[1]).toContain('warn-event')
  })

  it('emits all levels when set to trace', () => {
    const stream = new CapturingStream()
    const logger = new Logger({ level: 'trace', format: 'text', stream })
    logger.error('a')
    logger.warn('b')
    logger.info('c')
    logger.debug('d')
    logger.trace('e')
    expect(stream.lines().length).toBe(5)
  })
})

describe('Logger JSON format', () => {
  it('emits one JSON object per line with ts, level, event', () => {
    const stream = new CapturingStream()
    const logger = new Logger({ level: 'info', format: 'json', stream })
    logger.info('hello', { count: 3 }, 'first message')
    const [line] = stream.lines()
    expect(line).toBeDefined()
    const obj = JSON.parse(line!) as Record<string, unknown>
    expect(obj.level).toBe('info')
    expect(obj.event).toBe('hello')
    expect(obj.msg).toBe('first message')
    expect(obj.count).toBe(3)
    expect(typeof obj.ts).toBe('string')
    expect(new Date(obj.ts as string).toString()).not.toBe('Invalid Date')
  })

  it('includes runId when set on logger', () => {
    const stream = new CapturingStream()
    const logger = new Logger({ level: 'info', format: 'json', stream, runId: 'abc-123' })
    logger.info('event')
    const obj = JSON.parse(stream.lines()[0]!) as Record<string, unknown>
    expect(obj.runId).toBe('abc-123')
  })

  it('omits runId when not set', () => {
    const stream = new CapturingStream()
    const logger = new Logger({ level: 'info', format: 'json', stream })
    logger.info('event')
    const obj = JSON.parse(stream.lines()[0]!) as Record<string, unknown>
    expect(obj).not.toHaveProperty('runId')
  })

  it('reserved keys cannot be overwritten via attrs', () => {
    const stream = new CapturingStream()
    const logger = new Logger({ level: 'info', format: 'json', stream })
    logger.info('event', { level: 'fake' as unknown as string, attacker: 'yes' })
    const obj = JSON.parse(stream.lines()[0]!) as Record<string, unknown>
    expect(obj.level).toBe('info')
    expect(obj.attacker).toBe('yes')
  })
})

describe('Logger text format', () => {
  it('emits [level] event msg key=value', () => {
    const stream = new CapturingStream()
    const logger = new Logger({ level: 'info', format: 'text', stream })
    logger.warn('thing-happened', { count: 2 }, 'short msg')
    const [line] = stream.lines()
    expect(line).toContain('[warn]')
    expect(line).toContain('thing-happened')
    expect(line).toContain('short msg')
    expect(line).toContain('count=2')
  })
})
