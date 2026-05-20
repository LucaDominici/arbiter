---
title: 'ADR-031: Plugin API v1'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-031: Plugin API v1

**Date:** 2026-04-19
**Status:** Accepted
**Supersedes:** N/A

---

## Context

Arbiter ships built-in generators for Claude, Codex, Cursor, Copilot, Gemini, Windsurf, and Aider. Organizations routinely need framework-specific generators (Spring Boot, Rails, Django, NestJS) that are too opinionated for the core project. Forking arbiter to add them violates ADR-020 (CLI-first, single binary). A plugin API lets organizations ship generators as normal npm packages without forking.

---

## Decision

Introduce a first-party Plugin API v1 consisting of:

1. **Contract types** (`src/types/plugin.ts`, exported as `@arbiter/cli/plugin`):
   - `ArbiterPlugin` — plugin identity and entry points
   - `PluginContext` — runtime context injected by arbiter
   - `PluginFile` / `PluginResult` — file generation output shape

2. **Plugin loader** (`src/utils/plugin-loader.ts`):
   - Resolves packages from `targetDir/node_modules` using `createRequire` anchored to the target project
   - Validates shape (name, apiVersion, generate) at load time with descriptive errors
   - Validates `apiVersion === "1"` (literal string, not semver)

3. **Plugin runner** (`runPlugins` in `src/commands/init.ts`):
   - Per-plugin try/catch — one plugin failure does not abort the run
   - Injects `renderTemplate` context function that renders EJS from the plugin's own `templateRoot`
   - First-writer-wins conflict: the second plugin writing the same path is silently skipped (safe because all generators are idempotent)

4. **Config field** (`plugins?: string[]` in `ArbiterConfig`):
   - Optional, additive — v0.1 configs without `plugins` behave identically
   - Plugins are run in declared array order during `arbiter update`

5. **CLI subcommand** (`arbiter plugin add | remove | list`):
   - `add` validates the package is resolvable before persisting
   - `add` emits a security advisory (plugins execute Node code with arbiter's privileges)
   - `remove` is idempotent (no-op if not in list)
   - `list` shows configured packages with resolved/not-found status

---

## Rationale

### Loading mechanism

Plugins are resolved from `targetDir/node_modules`, not from arbiter's own `node_modules`. This ensures:

- Plugin version is controlled by the target project's `package.json`
- Multiple projects on the same machine can use different plugin versions
- The target project's standard npm tooling manages the lifecycle

`createRequire(pathToFileURL(join(targetDir, "__arbiter_anchor__.js")).href)` creates a require function anchored to `targetDir`. This is the standard Node.js pattern for third-party tooling that loads user plugins (ESLint, webpack, Babel all use this).

### Template isolation

Each plugin owns its `templateRoot` (an absolute path). `ctx.renderTemplate(relPath, data)` renders EJS from `join(plugin.templateRoot, relPath)` using arbiter's own EJS instance. Plugins do not need EJS as a direct dependency. The `templateRoot` must be declared explicitly — no heuristics based on `dirname(__filename)` which break under bundlers.

### apiVersion as a literal string

`apiVersion: "1"` is a string literal, not a semver range. Version compatibility is binary: either the loader understands v1 or it does not. Semver is deferred to a future `apiVersion: "2"` when a breaking change is introduced.

### Security posture

No sandbox. Plugins run with arbiter's full Node.js privileges. `arbiter plugin add` prints an explicit advisory:

> "Plugin X will execute Node code during `arbiter update`. Verify source before use."

Users are expected to vet plugins the same way they vet any npm package used in a build pipeline.

### Failure isolation

Each plugin is wrapped in try/catch in `runPlugins`. A plugin that throws during `generate()` or during loading emits a warning (`[arbiter] Plugin "X" failed: ...`) and contributes zero files to the run. The overall `arbiter update` continues normally.

---

## Alternatives Rejected

### Shipping plugins as EJS template overrides in `arbiter.json`

Would require a templating DSL inside JSON. Too fragile; no way to add detection logic.

### MCP-based plugin invocation

ADR-020 establishes CLI-first over MCP. Plugins invoked via MCP would require a running MCP server, breaking `arbiter update` in CI.

### Bundling framework generators into core

Rejected on scope grounds. Spring Boot, Rails, Django generators each require significant maintenance and would bloat the core binary for users who don't need them.

---

## Consequences

### Positive

- Organizations can ship framework-specific governance without forking arbiter
- Plugin lifecycle (versioning, install, remove) delegated to npm
- Plugin failures are isolated — one bad plugin cannot break the entire `arbiter update` run
- Security model is transparent: same as any npm devDependency

### Negative

- No sandbox: malicious plugins have full Node.js access
- Plugin resolution requires a `node_modules` directory in the target project
- No `arbiter plugin init` scaffolder in v1 (planned for v1.1)

---

## Out of scope (v1)

- Plugin scaffolding CLI (`arbiter plugin init`)
- Plugin validation in `arbiter diff` preview
- Sandboxing or capability restrictions
- Plugin marketplace / discovery

---

## See Also

- ADR-020: CLI-first over MCP
- `src/types/plugin.ts` — contract types
- `examples/plugin-spring-boot/` — reference implementation

---

## Status (2026-05-10)

**BETA** — API is public but not stable. Breaking changes possible before v1.0.

### Graduation criteria (BETA → stable)

The plugin API graduates to stable when **both** of the following are met:

1. At least one externally-maintained plugin is published to npm that consumes the `ArbiterPlugin` interface, with arbiter CI able to install and run it end-to-end.
2. No breaking interface changes have been required for 60 days after the external plugin ships.

The original criterion (Obsidian vault extraction) is no longer valid — the Obsidian feature was removed in #396 per v1.0 scope decision (see ADR-038).
