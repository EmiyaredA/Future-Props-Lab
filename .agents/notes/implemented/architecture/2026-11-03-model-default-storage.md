# Agent Note: Explicit account default model storage

Status: implemented

## Problem

The catalog directly reads account defaults from the legacy platform settings table. That import loads unrelated account ORM and couples independent Models to the original governance database. CAS conflicts also need the same defaults in their current snapshot.

## Decision

Catalog cases require an explicit defaults storage port. The legacy website supplies its original settings adapter at its own assembly points; independent Models supplies an owned account-default record and migration. Both use the catalog's existing short CAS transaction. Missing read adapters fail closed, and owner mismatch is rejected before mutation. Import/export ownership explicitly assigns the legacy account-default prefix to Models.

## Alternatives considered

- Reading Identity's SQLite preserves the forbidden shared-database boundary.
- Defaulting silently to an empty map loses real account selections.
- Updating defaults in another database separates catalog CAS from the selected defaults.

## Verification

Fresh imports contain no account ORM or monolith sessions. Owned defaults migrate idempotently, reject a foreign service database and preserve SQLite integrity. Fifty-one targeted checks exercise valid selection, invalid selection rollback, cross-account refusal, CAS conflict snapshots and legacy website, supplier, local-model and template behavior. Full backend regression passes 1992 tests with four conditional skips. Public contract/SDK checks, Python lint/format and Agent Note verification pass. A built wheel contains Models persistence and the previously omitted Rendering package, with no runtime configuration, weights or data.

## Consequences

Default selections and the catalog revision commit together in one service database. The old website retains its original table and data, using explicit compatibility adapters. The new append-only service migration creates only Models-owned selections; it does not adopt or clone the old database.

## Risks

Models persistence is being built incrementally. This batch owns only default selections; inference, runtime admission, template account projections, native MLX and complete route assembly remain required. The new service is not a production-ready replacement and is not attached to formal data.
