// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderNotify(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/_post-merge-notify.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants across 5 stacks × 3 governance levels ───

describe('_post-merge-notify.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderNotify({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it.each(STACKS)('$language: pull_request closed trigger', ({ language, buildTool }) => {
    const rendered = renderNotify({ language, buildTool })
    expect(rendered).toContain('pull_request:')
    expect(rendered).toContain('types: [closed]')
  })

  it.each(STACKS)(
    '$language: merged == true at job level (not shell)',
    ({ language, buildTool }) => {
      const rendered = renderNotify({ language, buildTool })
      expect(rendered).toContain('if: github.event.pull_request.merged == true')
    },
  )

  it.each(STACKS)('$language: run_attempt == 1 idempotency guard', ({ language, buildTool }) => {
    const rendered = renderNotify({ language, buildTool })
    expect(rendered).toContain('github.run_attempt == 1')
  })

  it.each(STACKS)('$language: concurrency group present', ({ language, buildTool }) => {
    const rendered = renderNotify({ language, buildTool })
    expect(rendered).toContain('concurrency:')
    expect(rendered).toContain('post-merge-notify')
  })

  it.each(STACKS)(
    '$language: runs-on: ubuntu-latest (hardcoded, no vars wrapping)',
    ({ language, buildTool }) => {
      const rendered = renderNotify({ language, buildTool })
      expect(rendered).toContain('runs-on: ubuntu-latest')
      expect(rendered).not.toContain('vars.CI_BUILD_RUNNER_LABEL')
    },
  )
})

// ─── Security invariants (rendered output assertions) ────────────────────────

describe('_post-merge-notify.yml.ejs — security invariants', () => {
  const rendered = renderNotify()

  it('CODEOWNERS .github/ checked first in priority loop', () => {
    expect(rendered).toMatch(/for path in \.github\/CODEOWNERS CODEOWNERS docs\/CODEOWNERS/)
  })

  it('SHA-pinned checkout (INV-76)', () => {
    expect(rendered).toContain('actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683')
  })

  it('SHA-pinned download-artifact (INV-76)', () => {
    expect(rendered).toContain('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093')
  })

  it('uses GITHUB_OUTPUT not ::set-output for changed files', () => {
    expect(rendered).toContain('files_path=$TMPFILE')
    expect(rendered).toContain('>> $GITHUB_OUTPUT')
    expect(rendered).not.toContain('::set-output')
  })

  it('uses GITHUB_OUTPUT not ::set-output for codeowners path', () => {
    expect(rendered).toContain('echo "path=$path" >> $GITHUB_OUTPUT')
  })

  it('BASE_SHA and HEAD_SHA passed via env: block', () => {
    expect(rendered).toContain('BASE_SHA: ${{ github.event.pull_request.base.sha }}')
    expect(rendered).toContain('HEAD_SHA: ${{ github.event.pull_request.head.sha }}')
  })

  it('FILES_PATH passed via env: block of send step', () => {
    expect(rendered).toContain('FILES_PATH: ${{ steps.changed.outputs.files_path }}')
  })

  it('PR_TITLE/PR_URL/PR_AUTHOR passed via env: block (no inline expansion)', () => {
    expect(rendered).toContain('PR_TITLE: ${{ github.event.pull_request.title }}')
    expect(rendered).toContain('PR_URL: ${{ github.event.pull_request.html_url }}')
    expect(rendered).toContain('PR_AUTHOR: ${{ github.event.pull_request.user.login }}')
  })

  it('EmailMessage API (send_message, not sendmail) for correct BCC delivery', () => {
    expect(rendered).toContain('s.send_message(msg)')
    expect(rendered).not.toContain('s.sendmail(')
  })

  it('uses Bcc header (recipients hidden from each other)', () => {
    expect(rendered).toContain("msg['Bcc']")
  })

  it('ssl.create_default_context() enforces TLS certificate validation', () => {
    expect(rendered).toContain('ssl.create_default_context()')
  })

  it('SMTP constructor has timeout=30', () => {
    expect(rendered).toContain('timeout=30')
  })

  it('STARTTLS branch calls s.ehlo() after starttls (RFC 3207)', () => {
    expect(rendered).toMatch(/s\.starttls\(context=ctx\)\s*\n\s*s\.ehlo\(\)/)
  })

  it('SMTP exception logged as redacted (no str(e) leaking credentials)', () => {
    expect(rendered).toContain('SMTP send failed (redacted)')
    expect(rendered).not.toMatch(/print\([^)]*\bstr\(e/)
  })

  it('recipient cap of 10 enforced', () => {
    expect(rendered).toContain('recipients_list = list(recipients)[:10]')
  })

  it('MAIL_DOMAIN_ALLOWLIST required (sys.exit(0) when unset)', () => {
    expect(rendered).toContain('MAIL_DOMAIN_ALLOWLIST')
    expect(rendered).toMatch(/if not allowlist_raw:\s*\n\s*print/)
  })

  it('MAIL_DOMAIN_ALLOWLIST=* allows all domains (escape hatch)', () => {
    expect(rendered).toContain("allowlist_raw != '*'")
  })

  it('last-match-wins per file (file_to_owners[cf] = emails)', () => {
    expect(rendered).toContain('file_to_owners[cf] = emails')
  })

  it('codeowners_match strips leading / (gitignore anchor semantics)', () => {
    expect(rendered).toMatch(/if pattern\.startswith\('\/'\):\s*\n\s*pattern = pattern\[1:\]/)
  })

  it('codeowners_match handles directory pattern (trailing /)', () => {
    expect(rendered).toContain("pattern.endswith('/')")
  })

  it('codeowners_match uses prefix+/ to prevent false match on src_other', () => {
    expect(rendered).toContain("pattern.rstrip('/') + '/'")
  })

  it('coverage download step appears before send step in YAML order', () => {
    const downloadIdx = rendered.indexOf('Download coverage artifact')
    const sendIdx = rendered.indexOf('Parse CODEOWNERS and send email')
    expect(downloadIdx).toBeGreaterThan(0)
    expect(sendIdx).toBeGreaterThan(downloadIdx)
  })

  it('git diff uses -z flag for NUL-separated filenames', () => {
    expect(rendered).toContain('git diff -z --name-only')
  })

  it('filename injection guard: drops files containing CR or LF', () => {
    expect(rendered).toContain("b'\\r' not in f and b'\\n' not in f")
  })

  it('PR title CRLF stripped before subject construction', () => {
    expect(rendered).toContain(
      "pr_title  = os.environ.get('PR_TITLE',  '').replace('\\r', '').replace('\\n', '')",
    )
  })

  it('msg[To] uses mail_user or noreply@github.com (not bogus address)', () => {
    expect(rendered).toContain("mail_user or 'noreply@github.com'")
  })

  it('only contents:read permission (no write)', () => {
    expect(rendered).toContain('contents: read')
    expect(rendered).not.toMatch(/contents:\s*write/)
  })

  it('changed-files body capped at 100 entries with "and N more" trailer', () => {
    expect(rendered).toContain('files[:100]')
    expect(rendered).toContain('more file(s)')
  })

  it('body size capped at 50KB', () => {
    expect(rendered).toContain('50_000')
  })
})
