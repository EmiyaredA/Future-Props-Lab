# Agent Note: Retain assets when creating Thought knowledge bases

Status: implemented

## Problem

Creating a Thought knowledge base commits both a project row and an automatic home note. A project may reference a cover image, while the home note starts empty and still needs an initial Assets projection so later independent edits can use the same retention protocol.

## Decision

The independent Thought creation operation validates the cover through the account-scoped Assets metadata port, assigns UUIDv4 identities to the project and home note, then prepares separate initial `knowledge-base` and `note` reference sets from the original POST assertion. Identity authorizes only these two resource kinds at revision -1 and only for UUIDv4 identities. Thought commits the project, home note, history and both reference outcomes in one source transaction. If a later prepare or source write fails before commit begins, Thought rolls back and aborts each confirmed prepare. An uncertain source commit stays pending for recovery.

## Alternatives considered

- Protecting only the cover leaves the automatic home note without the initial projection required by later independent note updates.
- Protecting the cover after project creation exposes it to deletion between the source commit and the Assets update.
- Reusing one resource projection for both records loses their independent ownership and lifecycle.

## Consequences

The existing public knowledge-base creation request and response remain unchanged. Creation now works through the independent Thought HTTP router and prepares the cover and home-note projections before commit. Updating covers, importing historical knowledge bases and notes, community writes, full service readiness and production data migration remain separate gates.

## Verification

The isolated Identity, Thought and Assets HTTP scenario verifies the existing public contract, rejects an unauthenticated caller, creates a covered knowledge base, and confirms the cover pin plus empty home-note projection after delivery. The targeted service test file passes; lint and format checks cover the changed Python files.
