---
title: 'arbiter-plugin-spring-boot'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# arbiter-plugin-spring-boot

Canonical example arbiter plugin for Spring Boot projects. Demonstrates the plugin API v1 contract.

## What it does

- Generates a `ARCHITECTURE.md` stub for Spring Boot projects.
- Adds a `check-maven-enforcer.sh` hook template.

## Install

```bash
cd your-spring-boot-project
arbiter plugin add arbiter-plugin-spring-boot
arbiter init --yes
```

`plugin add` installs the package as a devDependency (detecting your package manager),
validates it loads, and registers it in `arbiter.json`'s `plugins` array — pass
`--no-install` if you already installed it yourself.

## Discovery

This package uses keyword `arbiter-plugin` in `package.json`, the naming convention every
arbiter plugin follows (see below), and is listed on the [plugin registry](https://arbiter.dev/plugins).

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
