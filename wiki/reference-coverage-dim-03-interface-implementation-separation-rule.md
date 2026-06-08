---
generated: true
source: 'docs/REFERENCE/coverage/dim-03-interface-implementation-separation-rule.md'
source_sha: 'dd7f84845d031dfdcc9ca1c79a92cf9e5d352719'
last_updated: '2026-06-08'
---

# N03: Interface + implementation separation rule

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-03-interface-implementation-separation-rule.md](../docs/REFERENCE/coverage/dim-03-interface-implementation-separation-rule.md)

<!-- arbiter-generated dim=N03 hash=47f9f7e2dd649b74bfa056f1613474037ef56c2713f23b6b5031ea92985cd429 generator=kit@1 -->

# N03: Interface + implementation separation rule

| Field    | Value        |
| -------- | ------------ |
| TML      | L2           |
| Gate     | BLOCKING     |
| Status   | missing      |
| Category | architecture |

## Notes

Port/adapter pattern: repository interfaces in domain, implementations in infrastructure

## Per-Stack Coverage

| Stack        | Kind                              |
| ------------ | --------------------------------- |
| `java`       | tool: ArchUnit (via architecture) |
| `typescript` | equivalent: static_analysis       |
| `python`     | equivalent: static_analysis       |
| `go`         | equivalent: architecture          |
| `rust`       | equivalent: architecture          |
