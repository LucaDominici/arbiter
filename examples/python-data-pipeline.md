---
title: 'Example: python-data-pipeline'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Example: python-data-pipeline

End-to-end walkthrough of `arbiter init` on a Python ETL pipeline. The starter mirrors the reference fixture at `__tests__/fixtures/real-projects/python-data-pipeline/`.

## 1. Starter project (before `arbiter init`)

A minimal Python package with a `pipeline/` module (read → transform → emit pattern) and pytest tests. Arbiter detects the `data-pipeline` archetype from the absence of a web framework and presence of data-processing patterns.

```
python-data-pipeline/
├── pyproject.toml         # setuptools + pytest + ruff; Python ≥ 3.12
├── manifest.json          # { language: "python", archetype: "data-pipeline", levels: ["L1","L2","L3"] }
├── pipeline/
│   └── __init__.py
└── tests/
```

`pyproject.toml` (reference shape):

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "python-data-pipeline-fixture"
version = "0.1.0"
requires-python = ">=3.12"

[project.optional-dependencies]
test = ["pytest>=8.0", "pytest-cov>=4.1.0", "ruff>=0.3.0"]

[tool.ruff]
line-length = 120
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "W"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

## 2. Run `arbiter init`

```bash
npx @arbiter/cli init \
  --dir ./python-data-pipeline \
  --tools claude \
  --level L2
```

To override detection: `--archetype data-pipeline --language python`.

## 3. Generated artifacts

**Governance contract**

- `AGENTS.md` — canonical rules, invariants, gate command (`ruff check`, `ruff format --check`, `pytest`).
- `arbiter.json` — installer config.
- `.arbiter-generated.json` — file manifest.

**Gate scripts**

- `scripts/check-all.mjs` — orchestrator; shells out to `ruff` and `pytest`.
- Invariant-specific check scripts (orphan TODOs, placeholders, etc.).

**Git hooks**

- `.githooks/pre-commit` — `node scripts/check-all.mjs L1`.
- `.githooks/pre-push` — `node scripts/check-all.mjs L2`.

**AI-tool configs**

- `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/`, `.claude/rules/*.md`.

**CI**

- `.github/workflows/ci.yml` — sets up Python 3.12 via `actions/setup-python`, installs deps, runs L2 gate.

**Tooling configs**

- `ruff.toml` — linting + formatting rules (generated standalone; selects `E`, `W`, `F401`, `F811`, `S`, `C901`, `PLR*`).
- `.gitleaks.toml`, `.editorconfig`, `commitlint.config.js`.

## 4. Run the gate

```bash
npm install                       # installs git hooks
pip install -e ".[test]"          # install pipeline + test deps
node scripts/check-all.mjs L1     # ruff check + ruff format --check + pytest
node scripts/check-all.mjs L2     # L1 + pip-audit + gitleaks + coverage thresholds
```

Requires Python ≥ 3.12 and Node ≥ 22 in PATH. Use `uv` for faster installs: `uv pip install -e ".[test]"`.

## 5. See the enforcement chain fire

Add a subprocess call with `shell=True` in `pipeline/__init__.py`:

```python
import subprocess

def run_tool(cmd: str) -> None:
    subprocess.run(cmd, shell=True)  # S602: subprocess with shell=True
```

The ruff check fires at L1 (`S602: subprocess call with shell=True identified, security issue`). Fix by passing a list and dropping `shell=True`:

```python
def run_tool(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)
```

## 6. Typical follow-up edits

- Add a new transform stage in `pipeline/`. The `pre-edit-plan-anchor.mjs` hook enforces an active task plan.
- Pin a new dependency in `pyproject.toml`; run `pip-audit` via the L2 gate before pushing.
- Add ADRs in `docs/SYSTEM/DECISIONS.md` for data-format or schema decisions.
