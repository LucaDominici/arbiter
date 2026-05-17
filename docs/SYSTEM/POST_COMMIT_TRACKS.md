# Post-Commit Track Taxonomy (#724)

Arbiter's `post-commit-check.mjs` hook classifies changed files into tracks and prints stack-specific verification reminders. This document defines the taxonomy, per-stack checklists, and extension guide.

## Tracks

| Track        | Triggered by                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| **frontend** | Extensions: `.tsx?`, `.jsx?`, `.vue`, `.svelte`, `.css`, `.scss` — or path prefix `web/`, `frontend/`  |
| **backend**  | Extensions: `.go`, `.py`, `.java`, `.rs`, `.rb` — or path prefix `api/`, `backend/`, `server/`, `cmd/` |
| **docs**     | Extension: `.md` — or path prefix `docs/`                                                              |

A commit can trigger multiple tracks simultaneously. Output order is always `frontend → backend → docs`.

### Canonical Regex (single source of truth)

`scripts/detect-track.mjs` exports `TRACK_PATTERNS`:

```js
FE_RE: /\.(tsx?|jsx?|vue|svelte|css|scss)$|^(web|frontend)\//
BE_RE: /\.(go|py|java|rs|rb)$|^(api|backend|server|cmd)\//
DOCS_RE: /\.md$|^docs\//
```

The self-config hook (`.claude/hooks/post-commit-check.mjs`) imports these via dynamic `await import()`.  
Generated target hooks have equivalent regexes baked in at `arbiter init` render time.

> **Divergence note**: `pre-task-track-detect.mjs.ejs` intentionally extends `FE_RE` (adds `.html`) and `BE_RE` (adds `.php`) because it also matches prompt-text keywords. These are NOT the canonical regexes and are maintained separately.

### Ambiguity: Path Prefix vs Extension

When a file matches both a FE path prefix and a BE extension (e.g., `frontend/server.go`), **both** tracks are emitted. Extension and path-prefix checks are independent. Tests in `__tests__/unit/detect-track.test.ts` pin this behavior.

### CRLF Handling

`git diff --name-only` emits CRLF on Windows. `detectTracks()` strips `\r` before matching to prevent silent detection failure.

## Per-Stack Checklists

Checklists are baked into the generated hook at `arbiter init` time from EJS partials:  
`src/templates/claude/hooks/post-commit-checklists/<stack>/<track>.ejs`

### TypeScript (`ts`)

| Track | Commands                                                   |
| ----- | ---------------------------------------------------------- |
| FE    | `vitest run --reporter dot`, `tsc --noEmit`, snapshot diff |
| BE    | `vitest run --reporter dot`, `eslint src`                  |
| Docs  | `node scripts/check-doc-links.mjs`, verify links           |

### Java

| Track | Commands                                               |
| ----- | ------------------------------------------------------ |
| FE    | `mvn -q test` (JUnit), Selenium/Playwright             |
| BE    | `mvn -q test -Dtest='*IT'`, JaCoCo coverage            |
| Docs  | `javadoc --no-html-validation`, `@see`/`{@link}` check |

### Go

| Track | Commands                                   |
| ----- | ------------------------------------------ |
| FE    | `go test -race ./...`, `go vet ./...`      |
| BE    | `go test -race ./...`, `golangci-lint run` |
| Docs  | `go doc ./...`, link check                 |

### Python

| Track | Commands                                |
| ----- | --------------------------------------- |
| FE    | `pytest -x`, `coverage run --branch`    |
| BE    | `pytest -x --tb=short`, `mypy --strict` |
| Docs  | `mkdocs build --strict`                 |

### Rust

| Track | Commands                                       |
| ----- | ---------------------------------------------- |
| FE    | `cargo test`, `cargo clippy -- -D warnings`    |
| BE    | `cargo test`, `cargo clippy -- -D warnings`    |
| Docs  | `cargo doc --no-deps --document-private-items` |

## How to Extend

### Adding a new track

1. Add regex to `scripts/detect-track.mjs` `TRACK_PATTERNS`
2. Update unit tests in `__tests__/unit/detect-track.test.ts`
3. Add partial stubs for each stack: `src/templates/claude/hooks/post-commit-checklists/<stack>/<new-track>.ejs`
4. Update `post-commit-check.mjs.ejs` to include the new partial
5. Update bloat baseline: `node scripts/update-bloat-baseline.mjs --task=#NNN`

### Adding a new stack

1. Create partials: `src/templates/claude/hooks/post-commit-checklists/<new-stack>/{frontend,backend,docs}.ejs`
2. Add `<new-stack>` to the `_stackMap` in `post-commit-check.mjs.ejs`
3. Add render tests in `__tests__/templates/post-commit-checklist-render.test.ts`
4. Update bloat baseline

## Related

- ADR-043 (`docs/SYSTEM/DECISIONS.md`) — design history and completion note
- `scripts/detect-track.mjs` — canonical regex source
- `__tests__/unit/detect-track.test.ts` — behavior specs
- `src/templates/claude/hooks/post-commit-check.mjs.ejs` — generated hook template
