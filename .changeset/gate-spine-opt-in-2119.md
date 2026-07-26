---
'@arbiter/cli': minor
---

update: the gate spine is WITHHELD by default — `--adopt-gate-spine` is the opt-in (#2119)

**This reverses the default introduced by #2109.** #2109 made `scripts/check-all.mjs` and
`scripts/lib/*.mjs` a force-adopt class, on the reasoning that a frozen gate entrypoint never
receives another fix. The reasoning holds only if the template render is a **superset** of the
local file. It is for `.claude/hooks/*.mjs` — whole files arbiter owns. It is not for
`check-all.mjs`, which is by construction the point where a project wires its OWN checks:
customization _is_ that file's function.

Measured on a copy of a real governed consumer, a **bare** `arbiter update` — no `--adopt`, no
flag at all — deleted **25 project checks, 12 of them security** (container hardening, auth
bypass, cookie hardening, crypto primitives, SQLi regression, distroless runtime, error
disclosure, workflow hardening, …) and **the gate stayed green**: the checks did not fail, they
disappeared. With this change the same run leaves the file **byte-identical**.

Changes:

- `arbiter update` no longer overwrites a user-modified gate spine. A **pristine** spine
  (untouched since arbiter generated it) still receives every template fix, unchanged.
- New `--adopt-gate-spine`: the explicit, **destructive** opt-in. Preview it with `--adopt-plan`;
  the prior bytes are still recorded in `.arbiter/evidence/local-overrides/`.
- `--no-adopt-gate-spine` is kept as an **accepted no-op** so scripts written against the old
  default keep working.
- `arbiter diff` now reports a customized `scripts/check-all.mjs` as _withheld_ rather than
  _changed_ — which is what `update` actually does with it.
- `check-safety-adopt-ratchet.mjs` stops prescribing the command that would erase those checks.
  For a withheld spine it now says: `arbiter diff` → wire the new checks by hand → mark the file
  `arbiter:preserve` if the divergence is permanent → and only as a last resort, the destructive
  `--adopt-gate-spine`. It also **accepts** a preserve-marked file as the documented exception it
  already demanded in writing (printed on stdout, never silent) instead of failing on it forever.

Upgrade note: if you _want_ the template's gate entrypoint, run
`arbiter update --adopt-plan --adopt-gate-spine` to preview, then `arbiter update
--adopt-gate-spine`. If you keep your own, the ratchet stays red until you wire arbiter's newer
checks into your `check-all.mjs` or mark the file `arbiter:preserve` — that red is the honest
register of the debt, and it is not wired into any generated gate.
