---
'@getarbiter/cli': minor
---

Generated projects gain a single mode-aware landing contract at the merge trust
boundary. `LANDING_CONTRACT` and `resolveLandingContract()` in
`scripts/lib/exact-sha-policy.mjs` replace the watcher's inline
`collaborationMode` literal with an explicit refusal cascade: a malformed
`arbiter.json`, an absent or unusable `collaborationMode`, a known-but-unlandable
arc (`peer-review`, `gated-review`), or a `solo.mergeMode` that does not match
the arc are each refused by name, and `supported: true` is reachable only as the
last outcome. The emitted watcher refuses before its first network call, so an
unsupported arc never reaches the atomic compare-and-swap on `main`.

`scripts/check-merge-method.mjs` (INV-101) now asserts the wiring rather than
only its presence: it requires `resolveLandingContract(` to be _called_ and the
`assertLandingSupported()` guard to be _invoked_ as a statement. A name-only
pattern would be satisfied by the import line alone and could not see the
enforcement call being deleted — which, in a generated project, is the only
INV-101 enforcement there is.

`/ship`'s emitted command text now states, for the two unsupported arcs, that
`main != gatedHeadSha` and points at the tracking issue rather than implying the
exact-SHA guarantee holds.
