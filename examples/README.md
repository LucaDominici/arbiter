# arbiter examples

Runnable, end-to-end walkthroughs that demonstrate `arbiter init` producing a complete governance stack on top of a real starter project.

## Naming convention

Each example follows `<language>-<archetype>` to mirror the language/archetype axes used by `src/compatibility/cross-language-matrix.json`. Walkthroughs are markdown documents; the underlying starter projects live in `__tests__/fixtures/real-projects/` so they double as the reference test fixtures (INV-32).

## Index

| Example                                            | Stack                            | Archetype        | Build tool |
| -------------------------------------------------- | -------------------------------- | ---------------- | ---------- |
| [ts-frontend-spa.md](./ts-frontend-spa.md)         | TypeScript + React + Vitest      | `frontend-spa`   | npm        |
| [java-backend-web-db.md](./java-backend-web-db.md) | Java 21 + Spring Boot 3 + Gradle | `backend-web-db` | Gradle     |

## What each walkthrough covers

1. The starter project layout before `arbiter init` runs.
2. The exact `arbiter init` invocation (flags, governance level, AI tool selection).
3. The full list of files arbiter generates, grouped by purpose.
4. How to run the generated gate (`scripts/check-all.mjs`) at both L1 and L2.
5. A small, deliberate edit that triggers the enforcement chain so you can see hooks fire.

## Plugin examples

The plugin SDK exemplars live under `examples/plugins/` and `examples/plugin-spring-boot/`. They demonstrate the minimal `@arbiter/cli/plugin` contract per ADR-031.
