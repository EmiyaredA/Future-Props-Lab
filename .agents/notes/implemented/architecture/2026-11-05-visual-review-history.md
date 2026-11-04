# Agent Note: Visual review history and decisions

Status: implemented

## Problem

The standalone Visual service held acceptance history but left read, cancellation and manual review operations in the compatibility application. Those handlers were coupled to Model catalog queries and media processing through their imports.

## Decision

Share Visual's run and review record use cases and their routers with the compatibility application. Validate the project and signed account before querying run records. Reuse the revision CAS for cancellation and decisions. Store the reviewer identity from the verified session and preserve historical runs as read-only. Evidence sampling and prompt application keep their dedicated write paths.

## Alternatives considered

Duplicating the decision code would allow the two assemblies to diverge on reason requirements, normalization, verdicts and revision conflicts.

## Consequences

Run listings, run reads, cancellation, manual decisions and repair draft creation and reads run against Visual's owned database. Provider-backed checks and evidence changes still require their cross-service integrations.

## Verification

The independent signed API test verifies operation parity, a legacy read-only record, revision conflict payload, audit actor, final decision and persisted repair draft. The compatibility acceptance and independent image boundary tests exercise both assemblies.
