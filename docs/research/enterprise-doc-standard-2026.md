---
title: 'Enterprise Software Documentation Standard (2026) — the gold-doc reference for arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-07-12'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference', 'doc-standard', 'gold-doc']
related:
  ['standards/gold-doc-set.yml', 'scripts/check-doc-set.mjs', '.github/workflows/09-heartbeat.yml']
---

# Enterprise Software Documentation Standard (2026)

> **Purpose.** The authoritative, verify-first catalog of the software-documentation
> types that matter in 2026, the canonical framework/template behind each, and — the
> load-bearing part — a **right-sized tiering** (Solo / Small-team / Enterprise) so
> arbiter can (a) hold _itself_ to a gold doc-set and (b) generate + enforce the _right_
> doc-set on the projects it governs, without imposing a cathedral on a solo repo.
>
> **This is a reference document, not an implementation.** It is the foundation for the
> arbiter gold-doc capability (self + generator/enforcer). Every claim carries its
> cornerstone source; versions were fetched and verified in July 2026.
>
> **Method.** Five parallel research angles (architecture · decisions+product ·
> API+dev-docs · ops+security · data+test+process+tiering), each fetching canonical
> pages to confirm current editions rather than trusting search snippets. Findings
> marked _UNVERIFIED_ where a source could not be directly confirmed.

---

## 0. Doctrine — why this document is tiered and gate-mapped

This standard is not a wish-list. It inherits arbiter's own governance philosophy
and turns each principle into a design
constraint on the catalog below:

| Principle                                                                                                                                | Source in arbiter                                | Consequence for this standard                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Beyoncé rule** — "if you liked it you shoulda put a check on it": a doc that is not enforced does not exist.                           | FRAMEWORK_AUDIT §Beyoncé                         | Every **mandatory** doc maps to a deterministic **presence gate**. Un-gated docs are, at most, `recommended`.                                                   |
| **Presence ≠ enforcement** — a doc that exists but is stale is decayed governance (normalization of deviance).                           | FRAMEWORK_AUDIT §normalization-of-deviance       | Mandatory docs also carry a **non-staleness gate** (a `last_review` freshness bar), not just an existence check.                                                |
| **Advisory is a stage with an expiry, not a destination** (Kyverno audit→enforce).                                                       | FRAMEWORK_AUDIT §Kyverno                         | `recommended` is a **ratchet stage**: a doc is recommended until a promotion trigger fires, then it becomes mandatory. Audit-mode is a stage, not the terminus. |
| **Paved road** — the sanctioned path must be the easy path; ceremony that is routinely bypassed is not a gate, it is friction.           | IS-ARBITER-WORTH-IT §4 (docs-gate bypassed 305×) | Tiers keep the solo road _short_. A gate bypassed >N/month auto-flags for demotion — the doc-set self-prunes on its own bypass-log.                             |
| **Right-sized governance / YAGNI-at-framework-scale** — a solo repo must not carry SLO + threat-model + traceability it will never read. | IS-ARBITER-WORTH-IT verdict                      | The unit of the standard is the **TIER × doc-type cell**, not a flat list. Default posture = _Minimum Viable Documentation_.                                    |
| **Own-the-code / vanilla output** — emit diffable Markdown/YAML the project keeps on eject.                                              | IS-ARBITER-WORTH-IT §2.4                         | Every doc-type resolves to a plain-Markdown stub with frontmatter; no proprietary format, no lock-in.                                                           |

The external validation for this posture is not arbiter-internal: it is the industry's
own tiered precedents — **OpenSSF Best Practices** (passing/silver/gold), **CNCF project
maturity** (sandbox/incubating/graduated), and **Google's Minimum Viable Documentation**
("a small set of fresh and accurate docs beats a large assembly in disrepair"). This
document maps arbiter's Solo/Small/Enterprise onto exactly that shape.

---

## 1. The authoritative doc-type catalog (verified July 2026)

Grouped by domain. For each: **what it is · canonical source (verified version) · when
justified**. The `phase` column uses ISO/IEC/IEEE 12207 lifecycle phases already in
`standards/gold-doc-set.yml` (inception / design / build / release / operate).

### 1.1 Architecture

| Doc-type               | What it is                                                                                                                                          | Canonical source · verified                                                                                                                                                                                                                                                                                                                                                                            | Phase  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| **arc42**              | 12-section template for communicating a system's architecture.                                                                                      | [arc42.org](https://arc42.org) · repo [arc42/arc42-template](https://github.com/arc42/arc42-template) — **v9.0, Jul 2025**, CC BY-SA 4.0 (Starke/Hruschka). 12 sections: Introduction & Goals; Constraints; Context & Scope; Solution Strategy; Building Block View; Runtime View; Deployment View; Crosscutting Concepts; Architectural Decisions; Quality Requirements; Risks & Tech Debt; Glossary. | design |
| **arc42 Canvas**       | Single-page architecture summary — "the zip-version of arc42"; official upgrade path to the full template.                                          | [canvas.arc42.org](https://canvas.arc42.org) — Architecture Communication / Inception / Tech-Stack canvases. **The sanctioned Solo/Small variant.**                                                                                                                                                                                                                                                    | design |
| **C4 model**           | 4-level architecture _diagram_ set: System Context → Container → Component → Code (+ Landscape/Dynamic/Deployment). Notation- and tool-independent. | [c4model.com](https://c4model.com) (Simon Brown). Tooling 2026: Structurizr **CLI archived 2026-02-04** → migrate to consolidated Structurizr (DSL binaries **v2026.05.22**, maintained); **C4-PlantUML** (PlantUML stdlib, MIT, active); **Mermaid C4** still **experimental**; **LikeC4** (likec4.dev, MIT, active) is a credible modern DSL.                                                        | design |
| **Diagrams-as-code**   | Architecture diagrams authored as text, version-controlled, rendered in CI.                                                                         | ThoughtWorks Tech Radar — **Trial since 2020 (Vol 23)**, mainstream by 2026; the debate is _which DSL_, not _whether_.                                                                                                                                                                                                                                                                                 | design |
| **ISO/IEC/IEEE 42010** | Standard for _architecture description_ — stakeholders, concerns, viewpoints, views. Defines requirements _on descriptions_, not a template.        | **42010:2022** (2nd ed., supersedes 2011 / IEEE 1471:2000). arc42 & C4 are usable viewpoint sets under it. **Enterprise/regulated only.**                                                                                                                                                                                                                                                              | design |

Emerging (research-stage, no standard yet): **RAD-AI** (arXiv 2603.28735, Mar 2026) —
arc42 + 8 AI-specific sections, motivated by EU AI Act technical-documentation duties
(from 2026-08-02); machine-consumable, progressively-disclosed docs for agent consumption.

### 1.2 Decisions

| Doc-type         | What it is                                                                                                         | Canonical source · verified                                                                                                                                                                                                                                                                                                                                                              | Phase  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **ADR**          | Short, immutable, versioned record of one architecturally-significant decision: context · decision · consequences. | Origin: Michael Nygard, ["Documenting Architecture Decisions", 2011](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).                                                                                                                                                                                                                                          | design |
| **MADR**         | The de-facto Markdown ADR template.                                                                                | [adr.github.io/madr](https://adr.github.io/madr/) — **v4.0.0 (2024-09-17)**. Fields: Context & Problem, Decision Drivers, Considered Options, Decision Outcome, Consequences, Confirmation, Pros/Cons, More Info. Ships full/minimal/bare variants (bare = Solo).                                                                                                                        | design |
| **Decision log** | The accumulated collection of ADRs = project-level decision history.                                               | AWS Prescriptive Guidance, [ADR process](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html) (best team _process_ ref); Azure Well-Architected [Maintain an ADR](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record) (ms.date **2026-04-10**, freshest authoritative statement). | design |
| **ADR tooling**  | Optional automation.                                                                                               | `adr-tools` (npryce) — dormant (last release 2018, not archived); `log4brains` — active (v1.1.0, Dec 2024). Tooling optional; the _template_ (MADR) is what matters.                                                                                                                                                                                                                     | —      |

**Right-sizing note:** ThoughtWorks Tech Radar has held _Lightweight ADRs_ in **Adopt
since Nov 2017** — "we see no reason why you wouldn't use this technique." ADRs are the
one architecture practice justified at **every** tier, Solo included.

### 1.3 Product / Requirements

| Doc-type               | What it is                                                                                                                           | Canonical source · verified                                                                                                                                                                                                                                                                                                    | Phase     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **PRD / 1-pager**      | Problem-and-what (not how) for a product slice; modern PRD = 1–3 pages.                                                              | Lenny Rachitsky, [PRDs & 1-Pagers](https://www.lennysnewsletter.com/p/prds-1-pagers-examples); Cagan/SVPG (anti-heavyweight: prototypes over long PRDs). 1-pager separates problem from solution and precedes the PRD.                                                                                                         | inception |
| **Design doc / RFC**   | Written proposal for an ambiguous or hard-to-reverse technical decision: context, goals/non-goals, design, trade-offs, alternatives. | **[Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/)** (Malte Ubl, 2020) — the most citable single essay, incl. an explicit "when _not_ to write one." Living-process exemplars: [Oxide RFD](https://rfd.shared.oxide.computer/rfd/0001), [Rust RFCs](https://github.com/rust-lang/rfcs). | design    |
| **User story mapping** | Practice for organizing backlog into a narrative of user activities.                                                                 | Jeff Patton, _User Story Mapping_ (O'Reilly, 2014). A practice, not a doc standard.                                                                                                                                                                                                                                            | inception |
| **ISO/IEC/IEEE 29148** | Requirements-engineering processes + SRS/StRS information items.                                                                     | **29148:2018** (ed. 2, in force). **Regulated/contractual/enterprise only**; borrow its "well-formed requirement" characteristics at most.                                                                                                                                                                                     | inception |

### 1.4 API / Contracts

| Doc-type                          | What it is                                                  | Canonical source · verified                                                                                                                                                                                        | Phase   |
| --------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **OpenAPI**                       | Machine-readable contract for HTTP APIs — _is_ the API doc. | [spec.openapis.org](https://spec.openapis.org/oas/v3.2.0.html) — **v3.2.0 (Sep 2025)**; 3.1.2 alongside. Linux Foundation / OpenAPI Initiative.                                                                    | design  |
| **AsyncAPI**                      | Contract spec for event-driven / message APIs.              | [asyncapi.com](https://www.asyncapi.com/docs/reference/specification/latest) — **v3.1.0 (Jan 2026)**. Only if you have Kafka/MQTT/WebSocket interfaces.                                                            | design  |
| **Design-first / contract-first** | Write the spec before code; spec is SSOT.                   | OAI [learn.openapis.org](https://learn.openapis.org/). Adoption: Postman [2025 State of the API](https://www.postman.com/state-of-api/2025/) — ~82% API-first; 24% now design for AI-agent consumers.              | design  |
| **API changelog / versioning**    | Documented compatibility policy + dated change history.     | Exemplars: [Stripe versioning](https://docs.stripe.com/api/versioning) (date-based, e.g. `2026-06-24.dahlia`); [Google AIP-180](https://google.aip.dev/180) (backward-compat). Enterprise / third-party consumers. | release |
| **GraphQL SDL / gRPC proto**      | Schema as self-documenting contract.                        | [GraphQL spec, Sep 2025 edition](https://spec.graphql.org/September2025/); protobuf `.proto` (protobuf.dev). One line each; only if that transport is used.                                                        | design  |

### 1.5 User / Developer documentation

| Doc-type         | What it is                                                                              | Canonical source · verified                                                                                                                                                                                                                                               | Phase     |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **Diátaxis**     | 4-mode information architecture for docs: tutorials · how-to · reference · explanation. | **[diataxis.fr](https://diataxis.fr)** (Daniele Procida). Adopted by Cloudflare ("our north star"), Gatsby, Vonage, Python, Canonical. A thinking tool, justified at all tiers.                                                                                           | build     |
| **README**       | Repo front door: purpose, install, quickstart.                                          | [standard-readme](https://github.com/RichardLitt/standard-readme) (the only formal spec); GitHub community-standards checklist = de-facto "what files." Every project.                                                                                                    | inception |
| **AGENTS.md**    | "README for AI agents": build/test/convention instructions for coding agents.           | **agents.md** — launched by OpenAI + Google/Cursor/Amp/Factory; now stewarded by the Agentic AI Foundation (Linux Foundation); **60k+ repos**; plain Markdown, nested files override. **The new baseline for any agent-worked repo** — arbiter's own home turf.           | inception |
| **docs-as-code** | Docs in git, plain-text, reviewed/tested like code.                                     | [Write the Docs — docs-as-code](https://www.writethedocs.org/guide/docs-as-code/); Anne Gentle, _Docs Like Code_. Toolchain 2026: Docusaurus **3.10** (last 3.x, v4 incoming), MkDocs Material, Astro Starlight, VitePress. Small+ teams; Solo = plain Markdown suffices. | build     |
| **llms.txt**     | Curated `/llms.txt` index for LLM retrieval.                                            | [llmstxt.org](https://llmstxt.org) (Jeremy Howard, 2024). **Contested in 2026** — Google Search ignores it; ~0.1% of AI-crawler traffic; real niche = docs-site retrieval by coding assistants. **Optional, docs-sites only.** AGENTS.md is the one that matters.         | build     |

### 1.6 Operations

| Doc-type                        | What it is                                                                  | Canonical source · verified                                                                                                                                                                                                                                                                                    | Phase   |
| ------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Runbook / playbook**          | Per-alert/per-service step-by-step operational instructions.                | Google SRE Book, [Emergency Response](https://sre.google/sre-book/emergency-response/) (playbooks → ~3× MTTR improvement); modern exemplar [GitLab runbooks](https://runbooks.gitlab.com), [PagerDuty](https://response.pagerduty.com).                                                                        | operate |
| **SLO / SLI / error-budget**    | Declares objectives, SLI implementations, error-budget calc + policy.       | SRE Workbook, [Implementing SLOs](https://sre.google/workbook/implementing-slos/) + Appendices A/B. Small+ per user-facing service.                                                                                                                                                                            | operate |
| **Blameless postmortem**        | Incident write-up: impact · root cause · timeline · action items · lessons. | SRE Book, [Postmortem Culture](https://sre.google/sre-book/postmortem-culture/) + [example postmortem](https://sre.google/sre-book/example-postmortem/); [PagerDuty postmortems](https://postmortems.pagerduty.com).                                                                                           | operate |
| **On-call / incident doc-set**  | Rotation, escalation policy, severity matrix, incident roles.               | SRE Book, [Being On-Call](https://sre.google/sre-book/being-on-call/); [PagerDuty Incident Response](https://response.pagerduty.com). Solo = N/A (you are the pager).                                                                                                                                          | operate |
| **Observability-as-code**       | Monitoring/alert config + dashboards in git; alerts link runbooks.          | SRE Workbook [Monitoring](https://sre.google/workbook/monitoring/) — "treat monitoring configuration as code." No single formal standard; "alert→runbook link" is strong convention.                                                                                                                           | operate |
| **Production Readiness Review** | Pre-launch checklist review of arch, monitoring, alerting.                  | SRE Book [Evolving SRE Engagement](https://sre.google/sre-book/evolving-sre-engagement-model/) (Simple PRR); AWS [Operational Readiness Reviews](https://docs.aws.amazon.com/wellarchitected/latest/operational-readiness-reviews/wa-operational-readiness-reviews.html). Solo = 10-line pre-deploy checklist. | release |

### 1.7 Security / Privacy

| Doc-type                         | What it is                                                                 | Canonical source · verified                                                                                                                                                                                                                                                                                                                                                                                                                              | Phase   |
| -------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **SECURITY.md**                  | Repo security policy: supported versions + how to report a vulnerability.  | [GitHub docs](https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository); ISO/IEC 29147:2018 (disclosure) + 30111 (handling). **The one security doc justified even for Solo** (also OpenSSF passing criterion).                                                                                                                                                                                              | operate |
| **Threat model**                 | Structured "what can go wrong" analysis of a design.                       | [Threat Modeling Manifesto](https://www.threatmodelingmanifesto.org) — four questions (what are we working on / what can go wrong / what do we do / did we do a good job). STRIDE ([Microsoft SDL](https://www.microsoft.com/en-us/securityengineering/sdl/threatmodeling), TMT still current); [OWASP Threat Modeling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html). Solo = four questions on one page. | design  |
| **LINDDUN**                      | Privacy threat modeling (data-focused).                                    | [linddun.org](https://linddun.org) (KU Leuven) — GO (lean card deck), PRO (DFD-based), MAESTRO. Small = LINDDUN GO if personal data.                                                                                                                                                                                                                                                                                                                     | design  |
| **DPIA**                         | GDPR Art. 35 risk assessment for high-risk personal-data processing.       | [GDPR Art. 35](https://gdpr-info.eu/art-35-gdpr/); WP29 WP248 (EDPB-endorsed); [ICO DPIA template](https://ico.org.uk/). **Only when GDPR applies AND high-risk.** Solo w/ personal data = screening note ("DPIA not required because…").                                                                                                                                                                                                                | operate |
| **OpenSSF Best Practices Badge** | Tiered doc/process criteria set — the key documentation-tiering precedent. | [bestpractices.dev/criteria](https://www.bestpractices.dev/en/criteria): **Passing** (basic + interface docs, release notes, vuln-reporting); **Silver** (+ architecture doc, security requirements, quickstart, roadmap, governance, roles, CoC); **Gold** (+ code-review reqs, security review ≤5 yrs, assurance case). SLSA provenance ([slsa.dev](https://slsa.dev), v1.2) for supply-chain.                                                         | operate |

### 1.8 Data

| Doc-type                                            | What it is                                                                 | Canonical source · verified                                                                                                                                                                                                             | Phase   |
| --------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Data model / ERD**                                | Entities + relationships; modern SSOT = schema-as-code, diagram generated. | [Mermaid erDiagram](https://mermaid.js.org/syntax/entityRelationshipDiagram.html) (crow's foot); [Prisma schema](https://www.prisma.io/docs/orm/prisma-schema/overview) framed as "single source of truth." Solo = schema-as-code only. | design  |
| **Data dictionary**                                 | Per-field business definitions of data elements.                           | DAMA-[DMBOK 2nd ed. Revised, Mar 2024](https://dama.org/learning-resources/dama-data-management-body-of-knowledge-dmbok/); modern living form = [dbt model YAML descriptions](https://docs.getdbt.com/docs/build/documentation).        | design  |
| **Data lineage**                                    | Where data comes from and how it's transformed.                            | [OpenLineage](https://openlineage.io) (LF AI & Data, **Graduated 2023**). Only for multi-system pipelines / compliance provenance. Solo/small single-DB: migration history suffices.                                                    | operate |
| **Data classification / retention / PII inventory** | Sensitivity policy, retention schedule, GDPR Art. 30 record-of-processing. | GDPR + ISO 27001. Already in arbiter's `customer-data` overlay (`gold-doc-set.yml`). Only when handling personal/customer data.                                                                                                         | operate |

### 1.9 Quality / Test

| Doc-type                           | What it is                                                    | Canonical source · verified                                                                                                                                                                                                                              | Phase |
| ---------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Test strategy / policy**         | Org-level "how we test": levels, sizes, tools, risk approach. | _Software Engineering at Google_, [ch.11 Testing Overview](https://abseil.io/resources/swe-book/html/ch11.html) — test sizes small/medium/large, ~80/15/5 mix, ice-cream-cone anti-pattern. Solo/small = one in-repo `TESTING_POLICY.md`.                | build |
| **Test plan**                      | Project/release-specific "what we test now."                  | ISO/IEC/IEEE 29119-3 template; ISTQB glossary distinction. Enterprise/regulated.                                                                                                                                                                         | build |
| **ISO/IEC/IEEE 29119**             | International software-testing standard series.               | **P1:2022, P2:2021, P3:2021 (test documentation), P4:2021, P5:2024**. Context: the 2014 "Stop 29119" petition (documentation burden). **Regulated/enterprise only; anti-pattern for solo/small.**                                                        | build |
| **Requirements↔test traceability** | Maps each requirement to its verifying tests.                 | Mandated by DO-178C (avionics), IEC 62304 (medical), [GAMP 5 2nd ed. 2022](https://ispe.org) (pharma). Lightweight modern form: tests reference issue IDs (`#123`). Regulated only.                                                                      | build |
| **Coverage policy**                | Documented coverage bar as a gate signal.                     | Google Testing Blog, [Code Coverage Best Practices](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html) — coverage is a signal, not a goal; never chase 100%. Modest ratcheted threshold (mirrors arbiter's own `thresholds.yml`). | build |

### 1.10 Project / Process

| Doc-type                           | What it is                                                     | Canonical source · verified                                                                                                                                                                              | Phase     |
| ---------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **CHANGELOG**                      | Human-readable, per-release change history.                    | [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — spec **1.1.0** (2019; site patch 1.1.2, 2024). Six categories. "Changelogs are for humans." Every project.                                    | release   |
| **SemVer**                         | Versioning contract.                                           | [semver.org](https://semver.org) — **2.0.0**. Pairs with [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/); automation via release-please / changesets.                       | release   |
| **CONTRIBUTING**                   | How to contribute: workflow, gates, conventions.               | [GitHub community health files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file). Public repos; Solo/private optional. | build     |
| **CODE_OF_CONDUCT**                | Community behavior standard.                                   | [Contributor Covenant **3.0** (Jul 2025)](https://www.contributor-covenant.org/version/3/0/code_of_conduct/). Public/community repos.                                                                    | inception |
| **CODEOWNERS**                     | Review-ownership routing.                                      | GitHub-native. Small+ teams with review flow; Solo = N/A.                                                                                                                                                | build     |
| **Glossary / ubiquitous language** | Shared bounded-context vocabulary, identical in code and docs. | Evans, [DDD Reference (2015, CC BY 4.0)](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf). When domain terms exceed ~a dozen or are ambiguous.                       | design    |

---

## 2. The TIER × doc-type matrix

Three tiers, mapped onto the industry's own tiered precedents:

- **SOLO** — one dev / personal / hobby project. Posture: _Minimum Viable Documentation_.
  Target ≈ **OpenSSF Passing** / **CNCF sandbox** doc bar.
- **SMALL** — 1–4 people, real users, released software. Posture: paved road, docs-as-code.
  Target ≈ **OpenSSF Silver** / **CNCF incubating**.
- **ENTERPRISE** — multi-team / regulated / mission-critical (arbiter's "enterprise nel
  ragionevole"). Posture: full doc-set, conformance where mandated. Target ≈ **OpenSSF
  Gold** / **CNCF graduated**.

Legend: **R** = Required (mandatory — gets a presence+freshness gate) · **r** =
Recommended (advisory warning) · **o** = Optional (available on demand) · **—** = not
applicable / actively discouraged at this tier · **⊕** = conditional (required _only_ when
its overlay trigger fires — see §3).

| #   | Doc-type                                       | Domain       | SOLO                      | SMALL               | ENTERPRISE            |
| --- | ---------------------------------------------- | ------------ | ------------------------- | ------------------- | --------------------- |
| 1   | README                                         | dev-docs     | **R**                     | **R**               | **R**                 |
| 2   | AGENTS.md (agent guide)                        | dev-docs     | **R**                     | **R**               | **R**                 |
| 3   | LICENSE                                        | process      | **R**                     | **R**               | **R**                 |
| 4   | VERSION / SemVer policy                        | process      | **R**                     | **R**               | **R**                 |
| 5   | CHANGELOG (Keep a Changelog)                   | process      | **R**                     | **R**               | **R**                 |
| 6   | SECURITY.md                                    | security     | **R**                     | **R**               | **R**                 |
| 7   | ADR / decision log (MADR)                      | decisions    | **R**                     | **R**               | **R**                 |
| 8   | Architecture doc (arc42 Canvas → full)         | architecture | r → **R**¹                | **R** (Canvas)      | **R** (full arc42+C4) |
| 9   | Coding standards / conventions                 | quality      | r                         | **R**               | **R**                 |
| 10  | Test strategy / policy                         | quality      | r                         | **R**               | **R**                 |
| 11  | Coverage policy (gate)                         | quality      | o                         | **R**               | **R**                 |
| 12  | CONTRIBUTING                                   | process      | o                         | **R**               | **R**                 |
| 13  | docs/INDEX (discoverable index)                | dev-docs     | r                         | **R**               | **R**                 |
| 14  | GOVERNANCE                                     | process      | o                         | r                   | **R**                 |
| 15  | GLOSSARY / ubiquitous language                 | dev-docs     | o                         | r                   | **R** ⊕²              |
| 16  | Diátaxis-structured user/dev docs              | dev-docs     | o                         | r                   | **R**                 |
| 17  | PRD / 1-pager                                  | product      | o                         | r                   | **R**                 |
| 18  | Design doc / RFC process                       | product      | o                         | r → **R**³          | **R**                 |
| 19  | ROADMAP                                        | product      | o                         | r                   | **R**                 |
| 20  | CODE_OF_CONDUCT                                | process      | —                         | r ⊕⁴                | **R** ⊕⁴              |
| 21  | CODEOWNERS                                     | process      | —                         | r                   | **R**                 |
| 22  | OpenAPI / AsyncAPI (API contract)              | api          | ⊕⁵                        | **R** ⊕⁵            | **R** ⊕⁵              |
| 23  | API changelog / versioning policy              | api          | —                         | r ⊕⁵                | **R** ⊕⁵              |
| 24  | Threat model (4-question → STRIDE)             | security     | o (4-Q)                   | **R** (4-Q/OWASP)   | **R** (STRIDE full)   |
| 25  | Data model / ERD                               | data         | ⊕⁶                        | **R** ⊕⁶            | **R** ⊕⁶              |
| 26  | Data dictionary                                | data         | o ⊕⁶                      | r ⊕⁶                | **R** ⊕⁶              |
| 27  | Data classification / retention / PII (Art.30) | data         | ⊕⁷                        | **R** ⊕⁷            | **R** ⊕⁷              |
| 28  | DPIA                                           | privacy      | ⊕⁷ screening-note         | ⊕⁷                  | **R** ⊕⁷              |
| 29  | Data lineage                                   | data         | —                         | o ⊕⁸                | **R** ⊕⁸              |
| 30  | Runbook / OPERATIONS.md                        | ops          | o (1 restore/deploy note) | **R** (per-service) | **R** (full repo)     |
| 31  | SLO / SLI / error-budget                       | ops          | —                         | r ⊕⁹                | **R** ⊕⁹              |
| 32  | Postmortem template + records                  | ops          | o (incident note)         | **R** (SEV1/2)      | **R** (+ review)      |
| 33  | On-call / incident doc-set                     | ops          | —                         | r                   | **R**                 |
| 34  | Observability-as-code                          | ops          | o                         | r                   | **R**                 |
| 35  | Production Readiness Review                    | ops          | o (checklist)             | r (ORR-lite)        | **R** (PRR gate)      |
| 36  | Requirements↔test traceability                 | quality      | —                         | —                   | **R** ⊕¹⁰             |
| 37  | Test plan (29119-3)                            | quality      | —                         | —                   | **R** ⊕¹⁰             |
| 38  | ISO 42010 conformance                          | architecture | —                         | —                   | o ⊕¹⁰                 |
| 39  | SLSA provenance / supply-chain                 | security     | —                         | o                   | **R** ⊕¹¹             |
| 40  | Technical-debt register                        | quality      | o                         | r                   | **R**                 |

**Footnote conditions (also the promotion triggers, §3):**
¹ Solo architecture doc is _recommended_ until the system crosses ~2 deployable units or a
second contributor appears → then _required_ (at least a Canvas).
² GLOSSARY becomes required at Enterprise, or earlier when a domain has >~12 ambiguous terms.
³ Design-doc/RFC becomes required for Small the first time a decision is _ambiguous or
hard to reverse_ (Ubl's own test).
⁴ CODE_OF_CONDUCT applies when the repo is _public / accepts outside contributors_.
⁵ API-contract docs apply when the project _exposes an API_ (`has-api` overlay).
⁶ Data-model docs apply when the project _owns a persistent schema_ (`customer-data`/DB overlay).
⁷ Privacy docs apply when _personal data is processed_ (GDPR in scope); DPIA only when
_high-risk_ Art. 35 criteria are met — else a screening note.
⁸ Lineage applies when there is a _multi-system data pipeline_.
⁹ SLO/error-budget applies when there is a _user-facing availability commitment_.
¹⁰ Traceability / 29119 / 42010 apply under _regulatory or contractual mandate_ (safety,
medical, avionics, pharma, EU AI Act high-risk).
¹¹ Supply-chain provenance applies when the project _ships released artifacts to third parties_.

**Anti-cathedral guardrails (what a tier must NOT carry):**

- SOLO must never be forced into SLO + error-budget, on-call doc-set, full STRIDE,
  traceability matrix, ISO 29119/42010, CODE_OF_CONDUCT, or CODEOWNERS. Forcing these is
  the exact ceremony arbiter's own bypass-log condemns (305 docs-gate bypasses).
- SMALL must never be forced into ISO-29119-style test plans, formal 42010 conformance, or
  a full DPIA unless a regulatory trigger fires.
- The default when a trigger is _absent_ is **not present** — a doc-type is dormant, not a gap.

---

## 3. Promotion triggers (advisory → mandatory)

A doc-type is `recommended` (or dormant) until an **observable trigger** promotes it to
`required`. This operationalizes "advisory is a stage with an expiry." Triggers are
detectable by arbiter from repo facts (config, file presence, git signals) — never from
prose judgment.

| Trigger (observable)                                                                          | Promotes to Required                                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Repo declares/serves an HTTP or async API (`has-api`, OpenAPI/AsyncAPI file, framework route) | OpenAPI/AsyncAPI (22), API changelog (23)                          |
| Repo owns a persistent schema (migrations dir, ORM schema, `customer-data` overlay)           | Data model/ERD (25), data dictionary at Ent. (26)                  |
| Personal data detected in scope (PII fields, `customer-data` + GDPR flag)                     | Classification/retention/PII (27); DPIA if high-risk (28)          |
| Second contributor / any non-owner commit / branch-protection enabled                         | CONTRIBUTING (12), CODEOWNERS at Ent. (21), review-driven docs     |
| Repo becomes public (visibility flip)                                                         | CODE_OF_CONDUCT (20), SECURITY disclosure detail                   |
| System crosses ~2 deployable units / containers                                               | Architecture doc → full arc42 + C4 (8)                             |
| First user-facing availability commitment (SLA/uptime promise)                                | SLO/error-budget (31), on-call doc-set (33)                        |
| First real incident                                                                           | Postmortem record (32); template pre-provisioned                   |
| Ships released artifacts to third parties (publish step, release workflow)                    | SLSA provenance (39), API versioning policy (23)                   |
| Regulatory/contractual mandate declared (safety/medical/pharma/EU-AI-Act flag)                | Traceability (36), test plan (37), 42010 (38)                      |
| Ambiguous or hard-to-reverse decision authored                                                | Design doc/RFC (18) for that decision                              |
| Domain vocabulary exceeds ~12 ambiguous terms                                                 | GLOSSARY (15)                                                      |
| **Tier bump Solo→Small→Enterprise**                                                           | recomputes the whole column: every `r` in the new tier becomes `R` |

**Self-pruning (the reverse trigger).** Per the bypass-log-as-ceremony-detector idea
(IS-ARBITER-WORTH-IT §5.4): a mandatory doc's gate bypassed **> N times / month** (default
N=3) auto-flags the doc-type for **demotion** review. Arbiter uses its own evidence to keep
the required-set honest — a gate nobody honors is not a gate.

---

## 4. How each mandatory doc maps to an arbiter gate

The thesis: **presence + non-staleness, never mere existence.** A required doc that exists
but rotted is worse than absent (Write the Docs: "incorrect docs are worse than missing").
Two gate layers, both already have engines in arbiter — this standard extends their input
manifest, it does not invent machinery.

### 4.1 Presence gate (engine: `scripts/check-doc-set.mjs` ← `standards/gold-doc-set.yml`)

Deterministic, AI-free verdict. Each catalog row compiles to a `gold-doc-set.yml` check:

```yaml
- path: docs/architecture/ARCHITECTURE.md
  tier: mandatory # ← from the TIER×doc-type cell for the repo's tier
  applies: always # or an overlay name (has-api, customer-data, …) = the §3 trigger
  phase: design # ISO 12207 lifecycle phase
  drivers: ['iso12207', 'diataxis']
  accept_any: ['…/ARCHITECTURE.md', '…/arc42.md', '…/blueprint.md'] # equivalence, no false gap
  glob: 'docs/ADR/[0-9]*.md' # for "at least one of" families (ADRs)
  template: arc42-canvas # stub scaffolded by --generate when missing (write-safe, never overwrites)
```

- **Tier resolves the `tier` field.** The repo's declared tier (Solo/Small/Enterprise)
  selects the column of §2; `R`→`mandatory`, `r`→`recommended`, `⊕`→`conditional` gated on
  the overlay named by the §3 trigger. One manifest, tier-parameterized — exactly the shape
  of arbiter's existing `thresholds.yml` (bar scales by brownfield class without duplicating
  the check).
- **`accept_any` / `glob`** prevent false gaps (arc42 ≡ blueprint ≡ C4 doc; "≥1 ADR").
- **`--generate`** scaffolds a vanilla Markdown stub for a _missing_ required doc — paved
  road: the sanctioned doc is one command away, and the stub carries the frontmatter the
  freshness gate reads. Never overwrites a real doc.
- **Verdict is computed by code, never by an AI** — the Beyoncé requirement.

### 4.2 Non-staleness gate (engine: `09-heartbeat.yml`'s `assert-monthly-freshness` / `assert-nightly-freshness` jobs — the stamp-file scripts of the same name were retired in #2520 as structurally vacuous: no writer ever produced their artifact, so they passed by design whenever it was absent)

Presence alone is satisfiable by a stub that then rots. The freshness gate reads the
`last_review` (and `doc_version` / `status`) frontmatter this very document carries, and
fails a required doc whose review age exceeds its per-doc-type max-age bar:

| Doc-type class                                                        | Freshness bar (default)                                                       | Rationale                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| High-churn (ARCHITECTURE, PRD, API contract, data model)              | review ≤ **90 days** OR must accompany any change to the code it describes    | tracks fast-moving surface      |
| Decision records (ADR)                                                | **immutable once Accepted** — freshness = _superseded-by_ link, not re-dating | ADRs are historical, not living |
| Policy/standard (SECURITY, coding-standards, test policy, governance) | review ≤ **180 days**                                                         | slow-moving but must not ossify |
| Operational (runbook, SLO, on-call)                                   | review ≤ **90 days** + last-incident-touched                                  | ops rot is dangerous            |
| Regulatory (DPIA, traceability)                                       | review ≤ **365 days** or on-scope-change                                      | audit cadence                   |

Mechanism (all already in arbiter's vocabulary):

- **Frontmatter is the clock.** `last_review` + `doc_version` in YAML frontmatter (this
  file models it). `scripts/docs-add-frontmatter.mjs` backfills it.
- **Change-coupling.** Strongest freshness signal: a required doc under `phase: design`
  whose companion code changed but whose `last_review` did not = staleness (mirrors
  `check-phase-doc-consistency.mjs`, `check-workflow-docs-sync.mjs`).
- **Cadence, not push-blocking** (paved-road, from `solo-developer-gate-model.md`):
  freshness runs **monthly/nightly advisory**, promoted to a **release-tag blocker** — never
  a per-commit block on the solo road (that is precisely the friction the bypass-log records).
- **Tiered strictness.** Freshness bars scale by tier just like presence: Solo = advisory
  warning; Small = monthly gate; Enterprise = release-blocking + audit-mode evidence.

### 4.3 The full loop (what "gold-doc capability" means)

```
gold-doc-set.yml (this catalog, tier-parameterized)
        │
   ┌────┴─────────────────────────────────────────────┐
   ▼                                                   ▼
check-doc-set.mjs                          09-heartbeat.yml (assert-monthly-freshness)
 (presence + overlay triggers)              (last_review age + change-coupling)
   │  missing required → --generate stub        │  stale required → flag / block-at-release
   ▼                                            ▼
   └──────────────► gold-audit.mjs scorecard ◄──────────────┘
                          │
                 bypass-log analysis → auto-demote a gate bypassed >N/month (§3 self-pruning)
```

Self-application first (Beyoncé applied to arbiter itself): arbiter's _own_ repo runs the
Enterprise column of this matrix — that is the dogfood proof the generator is sound before
it is pointed at governed projects.

---

## 5. Cornerstone sources

The six load-bearing references behind this standard (each verified July 2026):

1. **arc42** — [arc42.org](https://arc42.org) + [github.com/arc42/arc42-template](https://github.com/arc42/arc42-template) (v9.0, Jul 2025, CC BY-SA 4.0) — architecture documentation; the Canvas family is the sanctioned lean/solo variant. Paired with **C4 model** — [c4model.com](https://c4model.com) (Simon Brown).
2. **MADR** — [adr.github.io/madr](https://adr.github.io/madr/) (v4.0.0, 2024), grounded in Nygard (2011) — the decision-record standard justified at _every_ tier.
3. **Diátaxis** — [diataxis.fr](https://diataxis.fr) (Daniele Procida) — the information-architecture for user/dev docs; paired with **OpenAPI 3.2** ([spec.openapis.org](https://spec.openapis.org)) as the API-contract SSOT.
4. **Google SRE Book + Workbook** — [sre.google](https://sre.google/sre-book/table-of-contents/) — the operations canon (runbooks, SLOs, blameless postmortems, on-call, PRR).
5. **OpenSSF Best Practices Badge criteria** — [bestpractices.dev/criteria](https://www.bestpractices.dev/en/criteria) — the security-doc canon **and the definitive tiered-documentation precedent** (passing/silver/gold ≈ our Solo/Small/Enterprise).
6. **Minimum-Viable-Documentation doctrine** — Google [docguide best practices](https://google.github.io/styleguide/docguide/best_practices.html) + [Write the Docs principles](https://www.writethedocs.org/guide/writing/docs-principles/) + Ambler [JBGE](https://agilemodeling.com/essays/agiledocumentation.htm), with **CNCF project-maturity doc requirements** ([graduation template](https://github.com/cncf/toc)) as the worked tiering example — the empirical backing for "right-sized, not one-size."

**Supporting (per domain):** ISO/IEC/IEEE 42010:2022 (architecture description),
29148:2018 (requirements), 29119 P1-5:2021-24 (test docs); AsyncAPI 3.1; Threat Modeling
Manifesto + STRIDE + LINDDUN; GDPR Art. 35 + WP248 (DPIA); Keep a Changelog 1.1 + SemVer
2.0 + Conventional Commits 1.0; Contributor Covenant 3.0; agents.md (agent-facing baseline);
DAMA-DMBOK 2024 + OpenLineage (data); _Software Engineering at Google_ ch.11 (test doctrine).

---

_Verify-first note: all versions/editions above were confirmed by fetching the canonical
page in July 2026. Items that could not be directly confirmed (iso.org catalog pages behind
403; exact arc42 FAQ wording; DO-178C/IEC-62304 amendment dates; the specific Google
coverage 60/75/90 tiers) are flagged UNVERIFIED in the underlying research and were not
relied on as load-bearing claims._
