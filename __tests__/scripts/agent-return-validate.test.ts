// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the shared JSON Schema subset validator in scripts/lib/agent-return-validate.mjs (#2509).
 *
 * The validator backs `check-agent-return.mjs`, `check-id-registry.mjs` (INV-140),
 * `check-forma-contract.mjs` (INV-143) and — via every registered ontology schema —
 * the `post-edit-artifact-schema.mjs` hook (INV-142). It previously implemented a
 * documented subset and SILENTLY SKIPPED every other keyword, so three shipped schemas
 * declared constraints that never executed:
 *
 *   id-registry.schema.json        minItems
 *   cross-model-dispatch.schema.json  maxItems
 *   vendor/c4-model.schema.json    anyOf, minItems
 *
 * Two properties are under test here, and the second is the load-bearing one:
 *   1. the previously-missing keywords are enforced;
 *   2. an unimplemented keyword FAILS CLOSED rather than passing the document — without
 *      this, the next schema author reintroduces the bug and nothing notices.
 *
 * Existing Code Survey (CANON-16):
 *   - grep 'validateSchema' __tests__/: no direct test of this lib existed; only
 *     check-agent-return.test.ts exercised it transitively through one gate.
 *     New test file justified (test files are outside the refactor-first rule).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import ejs from 'ejs'
import { validateSchema } from '../../scripts/lib/agent-return-validate.mjs'

/** Validate `value` against a self-contained schema, returning the violation list. */
function check(schema: Record<string, unknown>, value: unknown): string[] {
  return validateSchema(value, schema, schema, 'test')
}

describe('validateSchema — previously-supported keywords still hold (regression)', () => {
  it('accepts a conforming object', () => {
    const schema = {
      type: 'object',
      required: ['a'],
      additionalProperties: false,
      properties: { a: { type: 'string', minLength: 2, pattern: '^x' } },
    }
    expect(check(schema, { a: 'xy' })).toEqual([])
  })

  it('reports missing required, bad pattern and additional properties', () => {
    const schema = {
      type: 'object',
      required: ['a'],
      additionalProperties: false,
      properties: { a: { type: 'string', pattern: '^x' } },
    }
    expect(check(schema, { b: 1 }).length).toBeGreaterThan(0)
    expect(check(schema, { a: 'zz' }).length).toBe(1)
  })

  it('resolves $ref into definitions', () => {
    const schema = {
      type: 'object',
      properties: { a: { $ref: '#/definitions/leaf' } },
      definitions: { leaf: { type: 'integer' } },
    }
    expect(check(schema, { a: 1 })).toEqual([])
    expect(check(schema, { a: 'no' }).length).toBe(1)
  })
})

describe('validateSchema — array cardinality (#2509)', () => {
  const schema = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 }

  it('rejects an array below minItems', () => {
    const errs = check(schema, [])
    expect(errs.length).toBe(1)
    expect(errs[0]).toMatch(/minItems/)
  })

  it('rejects an array above maxItems', () => {
    expect(check(schema, ['a', 'b', 'c']).length).toBe(1)
  })

  it('accepts an array within bounds', () => {
    expect(check(schema, ['a'])).toEqual([])
  })

  it('enforces uniqueItems', () => {
    const uniq = { type: 'array', items: { type: 'string' }, uniqueItems: true }
    expect(check(uniq, ['a', 'b'])).toEqual([])
    expect(check(uniq, ['a', 'a']).length).toBe(1)
  })
})

describe('validateSchema — exclusive numeric bounds (#2509)', () => {
  it('rejects a value equal to exclusiveMinimum', () => {
    const schema = { type: 'number', exclusiveMinimum: 0 }
    expect(check(schema, 0).length).toBe(1)
    expect(check(schema, -1).length).toBe(1)
    expect(check(schema, 0.5)).toEqual([])
  })

  it('rejects a value equal to exclusiveMaximum', () => {
    const schema = { type: 'number', exclusiveMaximum: 10 }
    expect(check(schema, 10).length).toBe(1)
    expect(check(schema, 9.9)).toEqual([])
  })
})

describe('validateSchema — boolean combinators (#2509)', () => {
  it('allOf requires every branch', () => {
    const schema = {
      allOf: [
        { type: 'object', required: ['a'] },
        { type: 'object', required: ['b'] },
      ],
    }
    expect(check(schema, { a: 1, b: 2 })).toEqual([])
    expect(check(schema, { a: 1 }).length).toBeGreaterThan(0)
  })

  it('anyOf requires at least one branch', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'integer' }] }
    expect(check(schema, 'x')).toEqual([])
    expect(check(schema, 3)).toEqual([])
    expect(check(schema, true).length).toBe(1)
  })

  it('oneOf requires exactly one branch', () => {
    const schema = { oneOf: [{ type: 'integer' }, { type: 'number' }] }
    // 1 matches BOTH integer and number — oneOf must reject it.
    expect(check(schema, 1).length).toBe(1)
    expect(check(schema, 1.5)).toEqual([])
    expect(check(schema, 'x').length).toBe(1)
  })

  it('not inverts its branch', () => {
    const schema = { not: { required: ['due'] } }
    expect(check(schema, { horizon: 'later' })).toEqual([])
    expect(check(schema, { due: '2026-01-01' }).length).toBe(1)
  })
})

describe('validateSchema — if/then/else (#2509)', () => {
  // The milestone granularity-decay rule: `later` forbids a due date.
  const schema = {
    type: 'object',
    properties: { horizon: { type: 'string' }, due: { type: 'string' } },
    allOf: [
      {
        if: { properties: { horizon: { const: 'now' } }, required: ['horizon'] },
        then: { required: ['due'] },
      },
      {
        if: { properties: { horizon: { const: 'later' } }, required: ['horizon'] },
        then: { not: { required: ['due'] } },
      },
    ],
  }

  it('requires due when the if-branch matches', () => {
    expect(check(schema, { horizon: 'now', due: '2026-10-31' })).toEqual([])
    expect(check(schema, { horizon: 'now' }).length).toBeGreaterThan(0)
  })

  it('forbids due when the later-branch matches', () => {
    expect(check(schema, { horizon: 'later' })).toEqual([])
    expect(check(schema, { horizon: 'later', due: '2026-10-31' }).length).toBeGreaterThan(0)
  })

  it('applies neither branch when the condition does not match', () => {
    expect(check(schema, { horizon: 'next' })).toEqual([])
    expect(check(schema, { horizon: 'next', due: '2026-10-31' })).toEqual([])
  })

  it('honours else when present', () => {
    const withElse = {
      if: { properties: { k: { const: 'a' } }, required: ['k'] },
      then: { required: ['x'] },
      else: { required: ['y'] },
    }
    expect(check(withElse, { k: 'a', x: 1 })).toEqual([])
    expect(check(withElse, { k: 'b', y: 1 })).toEqual([])
    expect(check(withElse, { k: 'b' }).length).toBeGreaterThan(0)
  })
})

describe('validateSchema — fails closed on an unimplemented keyword (#2509)', () => {
  it('reports a keyword it cannot enforce instead of skipping it', () => {
    const schema = { type: 'object', patternProperties: { '^a': { type: 'string' } } }
    const errs = check(schema, { alpha: 1 })
    expect(errs.length).toBeGreaterThan(0)
    expect(errs.join('\n')).toMatch(/patternProperties/)
    expect(errs.join('\n')).toMatch(/does not support/i)
  })

  it('does not mistake annotation keywords for constraints', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'x.schema.json',
      title: 'A title',
      description: 'A description',
      examples: [{ a: 'x' }],
      default: {},
      type: 'object',
      properties: { a: { type: 'string' } },
      definitions: {},
    }
    expect(check(schema, { a: 'x' })).toEqual([])
  })
})

describe('validateSchema — the three shipped schemas whose constraints were dead (#2509)', () => {
  it('enforces minItems the way id-registry.schema.json declares it', () => {
    const schema = { type: 'object', properties: { schemes: { type: 'array', minItems: 1 } } }
    expect(check(schema, { schemes: [] }).length).toBe(1)
  })

  it('enforces anyOf the way the vendored c4-model schema declares it', () => {
    const schema = { anyOf: [{ type: 'object', required: ['id'] }, { type: 'null' }] }
    expect(check(schema, { id: 'c1' })).toEqual([])
    expect(check(schema, { nope: 1 }).length).toBe(1)
  })
})

describe.each(['self', 'emitted'])('#2632 citation arguments (%s)', (projection) => {
  it('treats citation arguments literally and retains immutable content/line checks', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-citation-2632-'))
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
      git(['init', '-q'])
      git(['config', 'user.name', 'Fixture'])
      git(['config', 'user.email', 'fixture@example.invalid'])
      for (const file of ['source.txt', 'literal space.txt', 'literal$(true).txt']) {
        writeFileSync(join(root, file), 'first\nsecond\n')
      }
      git(['add', '.'])
      git(['commit', '-qm', 'citation fixture', '--no-gpg-sign'])
      const sha = git(['rev-parse', 'HEAD'])
      writeFileSync(join(root, 'source.txt'), 'working tree changed\n')
      let helper = resolve('scripts/lib/agent-return-validate.mjs')
      if (projection === 'emitted') {
        helper = join(root, 'emitted-validator.mjs')
        writeFileSync(
          helper,
          ejs.render(
            readFileSync(
              resolve('src/templates/scripts/lib/agent-return-validate.mjs.ejs'),
              'utf8',
            ),
          ),
        )
      }
      const calls = [
        [sha, 'source.txt', 2],
        [sha, 'literal space.txt', 2],
        [sha, 'literal$(true).txt', 1],
        [sha, 'absent.txt', 1],
        [sha, 'source.txt', 99],
        [sha, 'source.txt$(touch citation-side-effect)', 1],
        [sha + '$(touch sha-side-effect)', 'source.txt', 1],
      ]
      const program = `import {resolveCitation} from ${JSON.stringify(pathToFileURL(helper).href)};
        console.log(JSON.stringify(${JSON.stringify(calls)}.map(args => resolveCitation(process.cwd(), ...args))));`
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', program], {
        cwd: root,
        encoding: 'utf8',
        timeout: 15000,
      })
      const results = JSON.parse(output) as Array<{ ok: boolean }>
      expect(existsSync(join(root, 'citation-side-effect'))).toBe(false)
      expect(existsSync(join(root, 'sha-side-effect'))).toBe(false)
      expect(results.map((result) => result.ok)).toEqual([
        true,
        true,
        true,
        false,
        false,
        false,
        false,
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
