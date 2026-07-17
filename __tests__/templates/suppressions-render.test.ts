import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

interface SuppressionEntrySchema {
  required?: string[]
  properties?: Record<string, { type?: string; pattern?: string; minLength?: number }>
}

interface SuppressionsSchema {
  type?: string
  items?: { $ref?: string }
  $ref?: string
  definitions: { SuppressionEntry: SuppressionEntrySchema }
}

/**
 * Minimal, dependency-free structural validator for the generated
 * suppressions-schema.json shape (#1981). Mirrors the real-world contract
 * enforced by scripts/check-suppressions.mjs.ejs: a top-level array of
 * SuppressionEntry objects. Not a general JSON-Schema engine — just enough
 * to prove the array-wrapper regression and required-field enforcement.
 */
function validateAgainstSuppressionsSchema(
  schema: SuppressionsSchema,
  payload: unknown,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const isArraySchema = schema.type === 'array' && schema.items?.$ref != null
  if (!isArraySchema) {
    errors.push('schema: root is not declared as an array of SuppressionEntry')
    return { valid: false, errors }
  }
  if (!Array.isArray(payload)) {
    errors.push(`root: expected array, got ${typeof payload}`)
    return { valid: false, errors }
  }
  const entryDef = schema.definitions.SuppressionEntry
  const required = entryDef.required ?? []
  payload.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`items[${i}]: expected object, got ${typeof entry}`)
      return
    }
    for (const field of required) {
      if (!(field in (entry as Record<string, unknown>))) {
        errors.push(`items[${i}]: missing required field '${field}'`)
      }
    }
  })
  return { valid: errors.length === 0, errors }
}

describe('suppressions template rendering (#166)', () => {
  describe('gitleaksignore.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('suppressions/gitleaksignore.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName', () => {
      const out = renderTemplate('suppressions/gitleaksignore.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains suppression format instructions', () => {
      const out = renderTemplate('suppressions/gitleaksignore.ejs', cfg())
      expect(out).toContain('expiresAt')
    })
  })

  describe('pii-allowlist.json.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('suppressions/pii-allowlist.json.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('renders valid JSON array', () => {
      const out = renderTemplate('suppressions/pii-allowlist.json.ejs', cfg())
      expect(() => JSON.parse(out)).not.toThrow()
    })
  })

  describe('suppressions-schema.json.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains $schema field', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      expect(out).toContain('"$schema"')
    })

    // #1981 — pii-allowlist.json / archunit-baseline.json are top-level `[]`-arrays
    // of suppression entries (see suppressions/*.json.ejs, both render as `[]`), but
    // the schema's root $ref pointed straight at the SuppressionEntry object, so
    // validating a real (possibly empty) suppressions array against it failed.
    it('declares a top-level array schema, not a bare SuppressionEntry object (#1981)', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      const schema = JSON.parse(out) as {
        type?: string
        items?: { $ref?: string }
        $ref?: string
      }
      expect(schema.type).toBe('array')
      expect(schema.items?.$ref).toBe('#/definitions/SuppressionEntry')
    })

    it('validates an empty suppressions array ([]) — the real generated file shape (#1981)', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      const schema = JSON.parse(out) as {
        type?: string
        definitions: { SuppressionEntry: unknown }
      }
      expect(validateAgainstSuppressionsSchema(schema, [])).toEqual({ valid: true, errors: [] })
    })

    it('validates a populated suppressions array with valid entries (#1981)', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      const schema = JSON.parse(out) as {
        type?: string
        definitions: { SuppressionEntry: unknown }
      }
      const entries = [
        {
          reason: 'False positive — tracked in issue #1981',
          owner: '@octocat',
          expiresAt: '2099-01-01',
          scope: 'left-pad',
        },
      ]
      expect(validateAgainstSuppressionsSchema(schema, entries)).toEqual({
        valid: true,
        errors: [],
      })
    })

    it('rejects a non-array payload against the schema (#1981)', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      const schema = JSON.parse(out) as {
        type?: string
        definitions: { SuppressionEntry: unknown }
      }
      const result = validateAgainstSuppressionsSchema(schema, {
        reason: 'not an array — this is the old (broken) top-level shape',
        owner: '@octocat',
        expiresAt: '2099-01-01',
        scope: 'left-pad',
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('root: expected array, got object')
    })

    it('rejects an array entry missing a required field (#1981)', () => {
      const out = renderTemplate('suppressions/suppressions-schema.json.ejs', cfg())
      const schema = JSON.parse(out) as {
        type?: string
        definitions: { SuppressionEntry: unknown }
      }
      const result = validateAgainstSuppressionsSchema(schema, [
        { reason: 'missing owner/expiresAt/scope' },
      ])
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('owner'))).toBe(true)
    })
  })

  describe('archunit-baseline.json.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('suppressions/archunit-baseline.json.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('renders valid JSON array', () => {
      const out = renderTemplate('suppressions/archunit-baseline.json.ejs', cfg())
      expect(() => JSON.parse(out)).not.toThrow()
    })
  })

  describe('trivyignore.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('suppressions/trivyignore.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('documents the mandatory exp:/reason=/owner= format (INV-31)', () => {
      const out = renderTemplate('suppressions/trivyignore.ejs', cfg())
      expect(out).toContain('exp:')
      expect(out).toContain('reason=')
      expect(out).toContain('owner=')
    })
  })
})
