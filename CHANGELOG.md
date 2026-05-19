# Changelog

All notable changes to this project will be documented in this file.

This project uses [changesets](https://github.com/changesets/changesets) and follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions. Versions are aligned to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `audit-toolchain.mjs` generator (Track A + Track B): emits a toolchain audit script
  that checks CI workflow files, gate scripts, and build toolchain presence (#887, W11)
- TDD evidence bundle for W11 planning skeleton migration close-out

## [0.1.0] — 2026-05-15

### Added

- Initial public release of arbiter AI-governance framework
- `arbiter init` CLI command to scaffold governance into target projects
- Cross-language compatibility matrix (TypeScript, Python, Rust, Java, Go)
- L1/L2/L3 gate tiers with `check-all.mjs` generation
- Claude Code hook generation (pre-edit, post-edit, UserPromptSubmit, PreCompact)
- Changeset-based changelog workflow (this file)
- `.changeset/` configuration for future version management
- CI `changeset-check` workflow enforcing changeset presence on user-facing PRs
- CI `release` workflow consuming changesets to bump version and tag

[0.1.0]: https://github.com/LucaDominici/arbiter/releases/tag/v0.1.0
