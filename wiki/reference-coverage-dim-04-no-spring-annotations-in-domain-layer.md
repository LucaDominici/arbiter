---
generated: true
source: 'docs/REFERENCE/coverage/dim-04-no-spring-annotations-in-domain-layer.md'
source_sha: 'cd6afa3eeed1a8e373834baaf21c43005c14c050'
last_updated: '2026-06-08'
---

# N04: No Spring annotations in domain layer

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-04-no-spring-annotations-in-domain-layer.md](../docs/REFERENCE/coverage/dim-04-no-spring-annotations-in-domain-layer.md)

<!-- arbiter-generated dim=N04 hash=c8a23fb44110aa27c6e46114630838e0846688b5d413469cb560b2aba6037769 generator=kit@1 -->

# N04: No Spring annotations in domain layer

| Field    | Value        |
| -------- | ------------ |
| TML      | L2           |
| Gate     | BLOCKING     |
| Status   | missing      |
| Category | architecture |

## Notes

Java/Spring-specific: domain classes must not use @Component, @Service, @Repository etc.

## Per-Stack Coverage

| Stack        | Kind                              |
| ------------ | --------------------------------- |
| `java`       | tool: ArchUnit (via architecture) |
| `typescript` | N/A by paradigm                   |
| `python`     | N/A by paradigm                   |
| `go`         | N/A by paradigm                   |
| `rust`       | N/A by paradigm                   |
