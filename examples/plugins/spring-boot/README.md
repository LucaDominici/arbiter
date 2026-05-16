# arbiter-plugin-spring-boot

Canonical example arbiter plugin for Spring Boot projects. Demonstrates the plugin API v1 contract.

## What it does

- Generates a `ARCHITECTURE.md` stub for Spring Boot projects.
- Adds a `check-maven-enforcer.sh` hook template.

## Install

```bash
cd your-spring-boot-project
npm install arbiter-plugin-spring-boot
arbiter plugin add arbiter-plugin-spring-boot
arbiter init --yes
```

## Discovery

This package uses keyword `arbiter-plugin` so it appears in `arbiter integrations list --recommended` and on the [plugin registry](https://arbiter.dev/plugins).

## Development

```bash
npm run build
npm test
```

## Naming convention

All arbiter plugins must:

- Set keyword `arbiter-plugin` in `package.json`
- Name the package `arbiter-plugin-*` or `@scope/arbiter-plugin-*`

See [`docs/PLUGIN-API.md`](../../../docs/PLUGIN-API.md) for the full API reference.
