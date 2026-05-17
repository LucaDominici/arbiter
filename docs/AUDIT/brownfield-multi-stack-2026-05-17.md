# Brownfield Safety — Multi-Stack Coverage

**Date:** 2026-05-17
**Origin:** #800 — "expand brownfield-real fixture beyond Node/TS stack"

## Coverage matrix

| Fixture                        | Stack            | File tree                           | Test                                                 |
| ------------------------------ | ---------------- | ----------------------------------- | ---------------------------------------------------- |
| `brownfield-real`              | Node/TS          | `package.json`, `src/index.ts`      | suite                                                |
| `brownfield-real-python` (new) | Python (FastAPI) | `pyproject.toml`, `src/app/main.py` | round-trip + source-preservation + claude generation |
| `brownfield-real-go` (new)     | Go (stdlib HTTP) | `go.mod`, `main.go`                 | round-trip + source-preservation + claude generation |

## Why these stacks

- **Python**: most-requested non-Node target; FastAPI is the canonical "small web service" scaffold. `pyproject.toml` is the modern build manifest; ensures arbiter init does not clobber Python build metadata.
- **Go**: covers the "no package manager files in subdir" pattern. `go.mod` at root, `main.go` at root — different layout than the JS / Python convention. Tests that arbiter handles flat file trees.

## Failure modes the new coverage catches

The "preserves source files untouched" assertion in each parameterized
test snapshots every non-AGENTS file before init, then asserts byte-identical
after. This catches:

- Manifest mutation (e.g. arbiter accidentally rewriting `pyproject.toml` or `go.mod`)
- Source clobber (e.g. accidentally generating `main.py` over the existing one)
- Encoding drift (subtle CRLF / BOM changes on non-JS files)

## Out of scope

- Compile-running the generated workflow against real Python/Go toolchains. That belongs in real-project integration tests under `__tests__/fixtures/real-projects/`, not the brownfield safety surface.
- Java fixture — already covered by `__tests__/fixtures/brownfield-java/` via `brownfield-baseline.test.ts`.
