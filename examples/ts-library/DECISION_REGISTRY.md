---
title: 'DECISION_REGISTRY'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-08'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---
# Decision Registry — ts-library-fixture

Registro delle **decisioni di progetto bloccate** (modello a 3 strati: Leggi → D-NN → ADR).
Ogni D-NN dichiara il proprio enforcement; una decisione senza enforcement né esenzione
`documentale` fa fallire `scripts/check-decision-registry.mjs` (decisione orfana).

## Leggi

*Sezione opzionale — le leggi immutabili del progetto (es. "una legge non cambia mai senza
un D-NN"). Eliminarla se non usata.*

- (nessuna legge registrata)

## Decisioni

| D-NN | decisione | razionale | decisore | data |
| --- | --- | --- | --- | --- |
| D-01 | (esempio — prima decisione bloccata) | (perché è bloccata) | (decisore) | 2026-08-08 |
Enforcement: documentale

> **Formato (leggibile dal gate):** ogni riga della tabella è una decisione `D-NN`. La riga
> subito sotto la riga della tabella (senza riga vuota in mezzo) dichiara l'enforcement:
> `Enforcement: <gate|test>` oppure `Enforcement: documentale` (esenzione esplicita —
> il gate passa con una nota). Una D-NN senza riga Enforcement è una **decisione orfana**
> e il gate fallisce nominandola. Rimuovere la riga di esempio quando la prima decisione reale
> viene registrata.

## Promozione a invariante (PROJ-NN)

Una D-NN che matura in regola permanente si promuove a **PROJ-NN** — un invariante dichiarato
dal progetto via `governance.projectInvariants[]` in `arbiter.json` (ADR-112). La regola vive
in **UN solo registro**: una volta promossa a PROJ-NN, la riga D-NN viene rimossa da qui.

## Changelog

### v0.1.0 — 2026-08-08

- Registro decisioni iniziale (scaffold `arbiter`).
