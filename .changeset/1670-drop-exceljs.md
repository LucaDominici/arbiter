---
'@arbiter/cli': patch
---

Replace the `exceljs` runtime dependency with a native zero-dependency xlsx writer,
removing the transitive `uuid@8` (GHSA-w5hq-g745-h8pq) from `@arbiter/cli`'s
production closure. npm `overrides` only apply to the root install, so the
`uuid` override did not protect consumers; dropping `exceljs` eliminates the
vulnerable transitive at the source. The `arbiter feature-matrix export --format
xlsx` CLI contract is unchanged — output is a valid .xlsx (STORE zip + inline-string
OOXML) loadable by Excel/LibreOffice/exceljs, with the same column widths, bold
header, and CWE-1236 formula neutralization as before.
