---
title: 'Use-Cases'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Use-Cases

Who and what arbiter is for. Pick your stack to see its canonical use case and the governance
categories that are **proven** — tested end-to-end against a real project of that stack with the
generated gate observed to pass.

## By language

| Language   | Canonical use case                         | Proven governance categories                      | Status |
| ---------- | ------------------------------------------ | ------------------------------------------------- | ------ |
| TypeScript | Backend web API or frontend SPA with npm   | static analysis, mutation, contract, coverage     | Proven |
| Java       | Spring Boot / hexagonal backend with Maven | static analysis, mutation, contract, architecture | Proven |
| Python     | FastAPI / Django service with pytest       | static analysis, coverage, architecture           | Proven |
| Go         | net/http or Gin service with go test       | static analysis, coverage, architecture           | Proven |
| Rust       | Axum / Actix web service with cargo test   | static analysis, coverage, architecture           | Proven |

## Proof

"Proven" is not a marketing word here: a category is marked proven only when arbiter has been run
against a real project of that stack and the generated governance gate was observed to pass. The
test-coupled evidence — behavioral test paths and the cross-language matrix — lives in the internal
reference:
[`docs/REFERENCE/USE-CASE-MATRIX.md`](https://github.com/LucaDominici/arbiter/blob/main/docs/REFERENCE/USE-CASE-MATRIX.md).

## Recipes

Hands-on guides for common adoption paths:

- [Custom invariant](/recipes/custom-invariant) — add a project-specific rule
- [Custom generator](/recipes/custom-generator) — generate your own config artifacts
- [Write a plugin](/recipes/plugin) — package and share an extension
- [Brownfield onboarding](/recipes/brownfield) — add arbiter to an existing project + CI

## Next

- [Problems Solved & How](/problems/) — does arbiter solve _your_ specific problem?
- [Get Started](/quickstart/) — install and run the first gate.
