---
title: 'Pharma Overlay — Reference'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Pharma Overlay — Reference

**Feature:** F5 (KIT dims 73-75) | **Issue:** #888 | **Language:** Java only

## Overview

The pharma overlay emits regulatory-compliance audit scaffolding for pharmaceutical Java projects.
It covers KIT dimensions 73-75 and enforces ArchUnit rules R-35..R-39 based on 21 CFR Part 11
§11.10(e) and EU Annex 11 §12.4 requirements.

## Activation

Set `industryOverlay: 'pharma'` in your `arbiter.json` (or pass the flag at `arbiter init`):

```bash
arbiter init --industry-overlay pharma
```

The overlay is silently skipped for non-Java projects.

## Emitted Files

| File                      | Location                            | Purpose                                                 |
| ------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `AuditEvent.java`         | `src/main/java/<pkg>/audit/`        | JPA entity for audit records (KIT dims 73-74)           |
| `AuditMapper.java`        | `src/main/java/<pkg>/audit/`        | MapStruct mapper for domain → audit record (KIT dim 75) |
| `PharmaArchUnitTest.java` | `src/test/java/<pkg>/architecture/` | ArchUnit rules R-35..R-39                               |

All files use `skipIfExists: true` — brownfield re-init never overwrites user customisations.

## KIT Dimensions Covered

| Dim | Requirement                                                  | Implementation                                                         |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 73  | Structured audit record with actor, action, entity reference | `AuditEvent` entity with `actorId`, `action`, `entityType`, `entityId` |
| 74  | Old/new value capture for entity mutations                   | `AuditEvent.oldValue` / `newValue` (TEXT columns)                      |
| 75  | Audit trail mapper — domain events to audit records          | `AuditMapper` (MapStruct) with `toEntity(AuditRequest)`                |

## ArchUnit Rules

| Rule | Description                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------- |
| R-35 | `AuditEvent` must reside in the `audit` package                                                      |
| R-36 | `AuditEvent` must only be constructed via its Builder — not directly from outside the audit package  |
| R-37 | The `audit` package must not import `javax.servlet` or `jakarta.servlet` — remains framework-neutral |
| R-38 | `AuditMapper` must reside in the `audit` package alongside `AuditEvent`                              |
| R-39 | `AuditEvent` must not be subclassed outside the `audit` package                                      |

## Usage Pattern

### Recording an audit event

```java
// Inject AuditMapper and your AuditEventRepository
@Autowired private AuditMapper auditMapper;
@Autowired private AuditEventRepository auditEventRepository;

// In your domain service, after a mutable operation:
var request = new AuditMapper.AuditRequest(
    SecurityContextHolder.getContext().getAuthentication().getName(), // actorId
    "UPDATE",                         // action
    Batch.class.getName(),            // entityType
    batch.getId().toString(),         // entityId
    objectMapper.writeValueAsString(before), // oldValue (JSON)
    objectMapper.writeValueAsString(after),  // newValue (JSON)
    correlationId,                    // correlationId
    AuditEvent.SourceContext.HUMAN    // or SYSTEM for automated mutations
);
auditEventRepository.save(auditMapper.toEntity(request));
```

### Database migration

Add a Flyway/Liquibase migration to create the `audit_events` table:

```sql
CREATE TABLE audit_events (
    id              UUID         NOT NULL PRIMARY KEY,
    actor_id        VARCHAR(256) NOT NULL,
    action          VARCHAR(64)  NOT NULL,
    entity_type     VARCHAR(512) NOT NULL,
    entity_id       VARCHAR(256) NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    correlation_id  VARCHAR(64),
    source_context  VARCHAR(32)  NOT NULL DEFAULT 'HUMAN',
    recorded_at     TIMESTAMPTZ  NOT NULL
);

-- Audit events are write-once: no UPDATE or DELETE permitted (21 CFR Part 11 immutability)
REVOKE UPDATE, DELETE ON audit_events FROM PUBLIC;
```

## Regulatory Context

- **21 CFR Part 11 §11.10(e):** Requires audit trails for regulated electronic records including
  the time/date of operator entries and actions, and the identity of the individual.
- **EU Annex 11 §12.4:** Requires audit trails for GxP-relevant data to record who changed what
  and when, with old and new values.

The `SourceContext` discriminator (HUMAN/SYSTEM) supports Annex 11 traceability of automated
data processing vs. human intervention.
