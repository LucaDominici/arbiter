---
'@arbiter/cli': major
---

`governanceLevel` now fails closed. A present invalid value no longer silently
defaults to L2 during config sanitization or v1 migration; Arbiter returns
`E_CONFIG_INVALID` instead. This is a breaking change for configurations that
relied on the previous L2 coercion. An absent governance level still defaults to L2.
