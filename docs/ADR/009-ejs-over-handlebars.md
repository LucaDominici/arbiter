# ADR-009: EJS over Handlebars (and other template engines)

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

Arbiter generates 32 output files from templates. A template engine is needed to interpolate `ProjectConfig` values (project name, language, framework, tool selections, governance level, etc.) into these files.

The main candidates were:

- **EJS** — Embedded JavaScript. Uses `<%= %>` and `<% %>` tags; logic is plain JavaScript.
- **Handlebars** — Logic-less by default; custom helpers required for conditionals beyond simple `{{#if}}`.
- **Mustache** — Strictly logic-less; no conditionals or loops without lambdas.
- **Nunjucks** — Jinja2-style; full-featured but introduces a custom syntax.

## Decision

Use EJS as the sole template engine. All 32 template files use the `.ejs` extension (or are static files requiring no interpolation, rendered by the same `ejs.render` call as a no-op).

## Rationale

1. **No new syntax** — EJS expressions are plain JavaScript. Anyone who can read TypeScript can read and modify a template without learning a DSL. `<% if (language === 'typescript') %>` is immediately understandable.
2. **Already the de facto choice** — all 32 templates in `src/templates/` were written using EJS syntax. There is no migration cost.
3. **Simple API surface** — `renderTemplate()` in `src/utils/render.ts` wraps `ejs.render(string, data)`. The entire rendering pipeline is ~20 lines. Adding a new template requires no engine registration or helper setup.
4. **Sufficient power** — arbiter templates need conditionals (language/framework/level branching) and loops (iterating over tools or hooks). EJS handles both with native JS expressions. Handlebars and Mustache would require custom helpers for the same logic.

### Alternatives rejected

- **Handlebars** — conditionals beyond simple `{{#if}}` require custom helpers. The helper registration boilerplate adds complexity without benefit over plain JS.
- **Mustache** — logic-less by design. Arbiter templates need conditionals; Mustache would force all conditional logic into the data layer, making the templates harder to read.
- **Nunjucks** — full-featured and capable, but introduces a Jinja2-style syntax that contributors must learn. The additional capability (macros, inheritance) is not needed.

## Consequences

**Positive:**

- Minimal learning curve for template contributors.
- No engine-specific helper registration or configuration.
- Static files (no EJS tags) are handled transparently by the same render call.

**Negative:**

- EJS allows arbitrary JavaScript in templates, which could in principle introduce logic that belongs in the generator layer. Contributors must keep template logic minimal — branching on config fields is acceptable; complex computations should live in the generator.
