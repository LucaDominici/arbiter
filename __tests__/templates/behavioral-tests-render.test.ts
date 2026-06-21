import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { Language, GovernanceLevel } from '../../src/wizard/types.js'

const DUMMY_DIR = '/tmp/arbiter-behavioral-render-test'

function renderBehavioral(template: string, overrides: Record<string, unknown> = {}): string {
  const config = makeConfig(DUMMY_DIR)
  return renderTemplate(template, { ...config, ...overrides })
}

describe('behavioral-tests templates rendering', () => {
  // ─── Java ─────────────────────────────────────────────────────────────────

  describe('ExampleBehavioralTest.java.ejs', () => {
    it('renders without error for java', () => {
      expect(() =>
        renderBehavioral('behavioral-tests/ExampleBehavioralTest.java.ejs', {
          language: 'java',
        }),
      ).not.toThrow()
    })

    it('contains @Nested annotation', () => {
      const out = renderBehavioral('behavioral-tests/ExampleBehavioralTest.java.ejs', {
        language: 'java',
      })
      expect(out).toContain('@Nested')
    })

    it('contains @DisplayName annotation', () => {
      const out = renderBehavioral('behavioral-tests/ExampleBehavioralTest.java.ejs', {
        language: 'java',
      })
      expect(out).toContain('@DisplayName')
    })

    it('contains @Test annotation', () => {
      const out = renderBehavioral('behavioral-tests/ExampleBehavioralTest.java.ejs', {
        language: 'java',
      })
      expect(out).toContain('@Test')
    })
  })

  // ─── TypeScript ───────────────────────────────────────────────────────────

  describe('example.behavioral.test.ts.ejs', () => {
    it('renders without error for typescript', () => {
      expect(() =>
        renderBehavioral('behavioral-tests/example.behavioral.test.ts.ejs', {
          language: 'typescript',
        }),
      ).not.toThrow()
    })

    it('contains describe block', () => {
      const out = renderBehavioral('behavioral-tests/example.behavioral.test.ts.ejs', {
        language: 'typescript',
      })
      expect(out).toContain('describe(')
    })

    it('contains it block', () => {
      const out = renderBehavioral('behavioral-tests/example.behavioral.test.ts.ejs', {
        language: 'typescript',
      })
      expect(out).toContain('it(')
    })

    it('contains vitest import', () => {
      const out = renderBehavioral('behavioral-tests/example.behavioral.test.ts.ejs', {
        language: 'typescript',
      })
      expect(out).toContain('vitest')
    })
  })

  // ─── Rust ─────────────────────────────────────────────────────────────────

  describe('example_behavioral_test.rs.ejs', () => {
    it('renders without error for rust', () => {
      expect(() =>
        renderBehavioral('behavioral-tests/example_behavioral_test.rs.ejs', {
          language: 'rust',
        }),
      ).not.toThrow()
    })

    it('contains #[cfg(test)]', () => {
      const out = renderBehavioral('behavioral-tests/example_behavioral_test.rs.ejs', {
        language: 'rust',
      })
      expect(out).toContain('#[cfg(test)]')
    })

    it('contains #[test] attribute', () => {
      const out = renderBehavioral('behavioral-tests/example_behavioral_test.rs.ejs', {
        language: 'rust',
      })
      expect(out).toContain('#[test]')
    })
  })

  // ─── Go ───────────────────────────────────────────────────────────────────

  describe('example_behavioral_test.go.ejs', () => {
    it('renders without error for go', () => {
      expect(() =>
        renderBehavioral('behavioral-tests/example_behavioral_test.go.ejs', {
          language: 'go',
        }),
      ).not.toThrow()
    })

    it('contains package declaration', () => {
      const out = renderBehavioral('behavioral-tests/example_behavioral_test.go.ejs', {
        language: 'go',
      })
      expect(out).toContain('package ')
    })

    it('contains t.Run for subtests', () => {
      const out = renderBehavioral('behavioral-tests/example_behavioral_test.go.ejs', {
        language: 'go',
      })
      expect(out).toContain('t.Run(')
    })
  })

  // ─── Python ───────────────────────────────────────────────────────────────

  describe('test_example_behavioral.py.ejs', () => {
    it('renders without error for python', () => {
      expect(() =>
        renderBehavioral('behavioral-tests/test_example_behavioral.py.ejs', {
          language: 'python',
        }),
      ).not.toThrow()
    })

    it('contains class with Test prefix', () => {
      const out = renderBehavioral('behavioral-tests/test_example_behavioral.py.ejs', {
        language: 'python',
      })
      expect(out).toContain('class Test')
    })

    it('contains def test_ methods', () => {
      const out = renderBehavioral('behavioral-tests/test_example_behavioral.py.ejs', {
        language: 'python',
      })
      expect(out).toContain('def test_')
    })
  })

  // ─── TESTING_POLICY.md ────────────────────────────────────────────────────

  describe('TESTING_POLICY.md.ejs', () => {
    const LANGUAGES: Language[] = ['typescript', 'java', 'rust', 'go', 'python']
    const LEVELS: GovernanceLevel[] = ['L1', 'L2', 'L3']

    for (const language of LANGUAGES) {
      for (const level of LEVELS) {
        it(`renders for ${language}/${level} without error`, () => {
          expect(() =>
            renderBehavioral('behavioral-tests/TESTING_POLICY.md.ejs', {
              language,
              governanceLevel: level,
            }),
          ).not.toThrow()
        })
      }
    }

    it('contains project name', () => {
      const out = renderBehavioral('behavioral-tests/TESTING_POLICY.md.ejs', {
        projectName: 'acme-service',
      })
      expect(out).toContain('acme-service')
    })

    it('contains mock policy section', () => {
      const out = renderBehavioral('behavioral-tests/TESTING_POLICY.md.ejs', {})
      expect(out.toLowerCase()).toContain('mock')
    })

    it('contains test naming section', () => {
      const out = renderBehavioral('behavioral-tests/TESTING_POLICY.md.ejs', {})
      expect(out.toLowerCase()).toContain('naming')
    })

    it('L1 renders without L2+ sections causing error', () => {
      const out = renderBehavioral('behavioral-tests/TESTING_POLICY.md.ejs', {
        governanceLevel: 'L1',
      })
      expect(out).toContain('Test Pyramid')
    })

    it('L2+ includes E2E policy section', () => {
      const out = renderBehavioral('behavioral-tests/TESTING_POLICY.md.ejs', {
        governanceLevel: 'L2',
      })
      expect(out.toLowerCase()).toContain('e2e')
    })
  })

  // ─── eslint-playwright.json ───────────────────────────────────────────────

  describe('eslint-playwright.json.ejs', () => {
    it('renders without error', () => {
      expect(() =>
        renderBehavioral('behavioral-tests/eslint-playwright.json.ejs', {}),
      ).not.toThrow()
    })

    it('contains no-force-option rule', () => {
      const out = renderBehavioral('behavioral-tests/eslint-playwright.json.ejs', {})
      expect(out).toContain('no-force-option')
    })

    it('contains no-wait-for-timeout rule', () => {
      const out = renderBehavioral('behavioral-tests/eslint-playwright.json.ejs', {})
      expect(out).toContain('no-wait-for-timeout')
    })

    it('contains no-page-pause rule', () => {
      const out = renderBehavioral('behavioral-tests/eslint-playwright.json.ejs', {})
      expect(out).toContain('no-page-pause')
    })

    it('contains prefer-web-first-assertions rule', () => {
      const out = renderBehavioral('behavioral-tests/eslint-playwright.json.ejs', {})
      expect(out).toContain('prefer-web-first-assertions')
    })

    it('is valid JSON', () => {
      const out = renderBehavioral('behavioral-tests/eslint-playwright.json.ejs', {})
      expect(() => JSON.parse(out)).not.toThrow()
    })
  })

  // ─── check-test-naming.mjs ────────────────────────────────────────────────

  describe('check-test-naming.mjs.ejs', () => {
    const LANGUAGES: Language[] = ['typescript', 'java', 'rust', 'go', 'python']

    for (const language of LANGUAGES) {
      it(`renders for ${language} without error`, () => {
        expect(() =>
          renderBehavioral('scripts/check-test-naming.mjs.ejs', { language }),
        ).not.toThrow()
      })
    }

    it('typescript variant checks .test.ts', () => {
      const out = renderBehavioral('scripts/check-test-naming.mjs.ejs', {
        language: 'typescript',
      })
      expect(out).toContain('.test.ts')
    })

    it('java variant checks Test.java', () => {
      const out = renderBehavioral('scripts/check-test-naming.mjs.ejs', {
        language: 'java',
      })
      expect(out).toContain('Test.java')
    })

    it('python variant checks test_ prefix', () => {
      const out = renderBehavioral('scripts/check-test-naming.mjs.ejs', {
        language: 'python',
      })
      expect(out).toContain('test_')
    })

    it('go variant checks _test.go', () => {
      const out = renderBehavioral('scripts/check-test-naming.mjs.ejs', {
        language: 'go',
      })
      expect(out).toContain('_test.go')
    })

    it('rust variant checks _test.rs', () => {
      const out = renderBehavioral('scripts/check-test-naming.mjs.ejs', {
        language: 'rust',
      })
      expect(out).toContain('_test.rs')
    })
  })
})

// ─── BDD templates (F2/#361) ─────────────────────────────────────────────────

describe('BDD templates — real Gherkin + framework bindings', () => {
  it('example.feature.ejs: contains Feature: and Scenario:', () => {
    const out = renderBehavioral('behavioral-tests/bdd/example.feature.ejs')
    expect(out).toContain('Feature:')
    expect(out).toContain('Scenario:')
  })

  it('example.steps.ts.ejs: uses @cucumber/cucumber Given/When/Then', () => {
    const out = renderBehavioral('behavioral-tests/bdd/example.steps.ts.ejs', {
      language: 'typescript',
    })
    expect(out).toContain('@cucumber/cucumber')
    expect(out).toContain('Given(')
    expect(out).toContain('When(')
    expect(out).toContain('Then(')
  })

  it('test_example_bdd.py.ejs: uses pytest_bdd scenarios()', () => {
    const out = renderBehavioral('behavioral-tests/bdd/test_example_bdd.py.ejs', {
      language: 'python',
    })
    expect(out).toContain('pytest_bdd')
    expect(out).toContain('scenarios(')
  })

  it('example_test.go.ejs: uses godog TestSuite', () => {
    const out = renderBehavioral('behavioral-tests/bdd/example_test.go.ejs', {
      language: 'go',
    })
    expect(out).toContain('godog')
    expect(out).toContain('TestSuite')
  })

  it('example_test.go.ejs: is guarded by a //go:build bdd tag (#1042)', () => {
    // The godog import is unresolvable until the project wires the dependency.
    // Without a build tag the file breaks the DEFAULT build, cascading into
    // `go vet ./...`, `go test ./...`, staticcheck, coverage and complexity —
    // every whole-module check fails. A `//go:build bdd` constraint excludes it
    // from the default build, so the freshly-scaffolded gate is green; the bdd
    // check runs it explicitly with `-tags bdd`. Mirrors Python's importorskip.
    const out = renderBehavioral('behavioral-tests/bdd/example_test.go.ejs', {
      language: 'go',
    })
    const firstLine = out.split('\n')[0]
    expect(firstLine).toBe('//go:build bdd')
    // Legacy-Go build-constraint twin must accompany the new directive.
    expect(out).toContain('// +build bdd')
  })

  it('ExampleBddIT.java.ejs: uses cucumber-junit-platform-engine @Suite', () => {
    const out = renderBehavioral('behavioral-tests/bdd/ExampleBddIT.java.ejs', {
      language: 'java',
    })
    expect(out).toContain('@Suite')
    expect(out).toContain('@SelectClasspathResource')
  })

  it('example_bdd_test.rs.ejs: uses cucumber::World derive', () => {
    const out = renderBehavioral('behavioral-tests/bdd/example_bdd_test.rs.ejs', {
      language: 'rust',
    })
    expect(out).toContain('cucumber')
    expect(out).toContain('World')
  })

  it('example_bdd_test.rs.ejs: is gated behind the `bdd` cargo feature (#1042)', () => {
    // `cargo test` compiles every file under tests/ as an integration crate, so
    // the unresolved `cucumber`/`tokio` imports break the DEFAULT `unit tests`
    // check. A crate-level `#![cfg(feature = "bdd")]` compiles the file to empty
    // unless the project declares the `bdd` feature — the gate runs it with
    // `cargo test --features bdd`. Same graceful-skip contract as Go/Python.
    const out = renderBehavioral('behavioral-tests/bdd/example_bdd_test.rs.ejs', {
      language: 'rust',
    })
    const firstNonComment = out
      .split('\n')
      .find((l) => l.trim() !== '' && !l.trim().startsWith('//'))
    expect(firstNonComment).toBe('#![cfg(feature = "bdd")]')
  })

  it('no BDD template contains @ignore tag', () => {
    const templates = [
      'behavioral-tests/bdd/example.steps.ts.ejs',
      'behavioral-tests/bdd/test_example_bdd.py.ejs',
      'behavioral-tests/bdd/example_test.go.ejs',
      'behavioral-tests/bdd/ExampleBddIT.java.ejs',
      'behavioral-tests/bdd/example_bdd_test.rs.ejs',
    ]
    for (const tpl of templates) {
      const out = renderBehavioral(tpl)
      expect(out, `${tpl} must not contain @ignore`).not.toContain('@ignore')
    }
  })
})
