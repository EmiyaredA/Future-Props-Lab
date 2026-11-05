# Agent Note: Model HTTP call attribution from verified Identity claims

Status: implemented

## Problem

Model HTTP routes still import the recovery website's credential lookup, loading account ORM and a global database factory even after pure snapshots and signed metadata exist. Realtime attribution also opens that global database independently of the authenticated socket.

## Decision

Use an explicit HTTP attribution dependency: independent services derive snapshots from the verified actor and reject mismatched principals. The recovery website installs its account lookup callback at assembly. Realtime uses its authenticated browser principal, or the same explicitly installed legacy callback through that app's own sessions. Remove the old global-session helper; no LLM module may directly import the monolith session factory.

## Alternatives considered

- Looking up keys in Models recreates Identity ownership.
- Dropping display metadata loses existing log attribution.
- Reusing a global socket lookup points work at an unrelated database.

## Verification

Fresh-process imports verify no account ORM, Models ORM or monolith database initialization with an absent configuration and empty encryption key. Signed HTTP checks exercise API Key metadata and browser Session attribution without a SQL API, reject forged cookies and mismatched account/key IDs, and verify explicit recovery callbacks use the authenticated application's session. Socket tests verify browser-only attribution and explicit lookup bindings. Nine focused attribution/session checks and 52 inference, playground, generation, transcription, realtime, credential, API and website regression checks pass. OpenAPI, SDK and service ownership stale checks pass.

The full backend suite passes 2011 tests with four conditional skips. Python lint/format, Agent Note and protected-document checks pass. Formal data and running services are unchanged.

## Consequences

Models HTTP routes no longer import the legacy account credential reader. All LLM modules are guarded against direct imports of the monolith database factory. Recovery website behavior remains available through an explicitly installed callback; there is no database fallback for independent services.

## Risks

Attribution is historical display information and never authorizes a call. Live request/socket checks remain required. Remaining provider/demo, quota, asset and native interfaces still gate complete Models startup.
