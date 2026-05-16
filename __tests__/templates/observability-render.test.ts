// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(provider: string): string {
  return renderTemplate(
    'observability/setup.md.ejs',
    makeConfig('/tmp/test', { observability: { provider } }),
  )
}

describe('observability/setup.md.ejs (#725)', () => {
  it('contains project name', () => {
    expect(render('stdout-minimal')).toContain('test-project')
  })

  it('stdout-minimal: shows structured logging section', () => {
    expect(render('stdout-minimal')).toMatch(/stdout.minimal|structured.log/i)
  })

  it('signoz: shows SigNoz docker-compose section', () => {
    const out = render('signoz')
    expect(out).toMatch(/signoz/i)
    expect(out).toMatch(/docker.compose|image:/i)
  })

  it('openobserve: shows OpenObserve section', () => {
    expect(render('openobserve')).toMatch(/openobserve/i)
  })

  it('victoria-vector-quickwit: shows VictoriaMetrics section', () => {
    expect(render('victoria-vector-quickwit')).toMatch(/victoria|vector|quickwit/i)
  })

  it('prom-grafana-loki-jaeger: shows classic stack section', () => {
    expect(render('prom-grafana-loki-jaeger')).toMatch(/prometheus|grafana|loki|jaeger/i)
  })

  it('saas-sentry: shows Sentry section', () => {
    expect(render('saas-sentry')).toMatch(/sentry/i)
  })

  it('saas-datadog: shows Datadog section', () => {
    expect(render('saas-datadog')).toMatch(/datadog/i)
  })

  it('saas-axiom: shows Axiom section', () => {
    expect(render('saas-axiom')).toMatch(/axiom/i)
  })

  it('saas-betterstack: shows BetterStack section', () => {
    expect(render('saas-betterstack')).toMatch(/betterstack|better.stack/i)
  })

  it('all non-none providers mention traceId structured logging', () => {
    for (const p of ['signoz', 'saas-sentry', 'stdout-minimal', 'saas-datadog']) {
      expect(render(p), `${p}: missing traceId`).toMatch(/traceId|trace_id|trace-id/i)
    }
  })
})
