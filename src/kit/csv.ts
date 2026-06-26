// SPDX-License-Identifier: Apache-2.0

import type { DerivedKit, DerivedKitDim } from './schema.js'

// Neutralize spreadsheet formula triggers (CWE-1236) BEFORE RFC-4180 quoting.
// A cell beginning with =, +, -, @, TAB, or CR is evaluated as a formula by
// Excel / LibreOffice Calc / Google Sheets. Prefixing with a single quote forces
// the spreadsheet to treat the value as literal text. This is the OWASP-recommended
// mitigation and is applied to both the CSV and xlsx export paths.
export function neutralizeFormula(val: string | undefined | null): string {
  const s = val ?? ''
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

// RFC 4180 quoting: wrap in double quotes if contains comma, quote, or newline.
// Formula neutralization is applied first so the literal-text prefix survives quoting.
export function csvCell(val: string | undefined | null): string {
  const s = neutralizeFormula(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

const STACKS = ['java', 'typescript', 'python', 'go', 'rust'] as const

function perStackSummary(dim: DerivedKitDim, stack: (typeof STACKS)[number]): string {
  const cell = dim.perStack[stack]
  if (cell.kind === 'tool') return `tool:${cell.tool}`
  if (cell.kind === 'equivalent') return `equiv:${cell.arbiterSlot}`
  if (cell.kind === 'na-by-archetype') return `na-archetype`
  if (cell.kind === 'na-by-paradigm') return `na-paradigm`
  return 'gap'
}

export function toCsv(kit: DerivedKit): string {
  const headers = [
    'id',
    'name',
    'tml',
    'gate',
    'categoryRef',
    'status',
    'invLink',
    'generatorLink',
    'conditionalFlag',
    ...STACKS.map((s) => `perStack_${s}`),
    'note',
  ]

  const rows: string[] = [headers.map(csvCell).join(',')]

  for (const dim of kit) {
    const row = [
      csvCell(dim.id),
      csvCell(dim.name),
      csvCell(dim.tml),
      csvCell(dim.gate),
      csvCell(dim.categoryRef),
      csvCell(dim.status),
      csvCell(dim.invLink),
      csvCell(dim.generatorLink),
      csvCell(dim.conditionalFlag),
      ...STACKS.map((s) => csvCell(perStackSummary(dim, s))),
      csvCell(dim.note),
    ]
    rows.push(row.join(','))
  }

  return rows.join('\r\n') + '\r\n'
}
