# Contributing to python-library

Thank you for considering contributing to **python-library**.

## Getting Started

1. Fork the repository
2. Create a task branch: `git checkout -b task/#NNN-short-description`
3. Make your changes following the guidelines below
4. Run the quality gate: `pytest`
5. Commit with the [conventional format](#commit-format)
6. Open a Pull Request

## Branch Naming

```
task/#NNN-short-description
```

Where `#NNN` is the GitHub issue number. No direct commits to `main`.

## Commit Format

```
type(scope): summary

- Detail of what changed
- Detail of what changed
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`

## Code Standards

See `AGENTS.md` for the full coding standards, invariants, and testing policy.

Key rules:
- All code must pass the quality gate before committing
- No orphan TODOs — every `TODO` must reference a task ID (`TODO(#NNN)`)
- Tests required for new functionality

## Quality Gate

```bash
pytest
```

**Lint:** `ruff check .`
**Format:** `ruff format --check .`

## Pull Requests

- Fill out the PR template completely
- Link the related issue
- Ensure the gate passes in CI
- Request review from a code owner

## Questions?

Open a [discussion](https://github.com///discussions) or reach out to the maintainers.
