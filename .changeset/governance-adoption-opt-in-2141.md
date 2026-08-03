---
'@arbiter/cli': minor
---

update: WITHHOLD diverged governance files by default; add destructive `--adopt-governance` opt-in (#2141)

Mirroring #2119's superset principle, `arbiter update` now preserves a user-modified `AGENTS.md` or
`.claude/settings.json` byte-for-byte unless `--adopt-governance` is supplied. Pristine governance files
continue to receive every template refresh. A withheld governance file is named in update output; use
`arbiter:preserve` for a permanent freeze.

`--no-adopt-governance` is accepted as a no-op, because withholding a diverged governance file is the default
since #2141.
