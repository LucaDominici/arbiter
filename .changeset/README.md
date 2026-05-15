# Changesets

This directory is used by [changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

## How to add a changeset

When making a user-facing change, run:

```bash
npx changeset
```

This creates a new changeset file in this directory. Commit the file along with your changes.

## What requires a changeset

- New features or commands
- Bug fixes that affect user behaviour
- Breaking changes to the CLI or public API
- Changes to generated governance templates

## What does NOT require a changeset

- Internal refactors with no user-visible impact
- Documentation-only updates
- CI/tooling changes
- Test-only changes

In these cases add `<!-- no-changeset: <reason> -->` to your PR description.
