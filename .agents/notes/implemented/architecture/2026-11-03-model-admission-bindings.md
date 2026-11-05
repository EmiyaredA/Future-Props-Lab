# Agent Note: Explicit model admission lifecycle bindings

Status: implemented

## Problem

Model HTTP and realtime protocols import the legacy governance quota ledger and all of its account/workshop ORM and global database dependencies. A service cannot install its own quota implementation, and an idempotency lookup imports unrelated asset capabilities.

## Decision

Bind acquire, release, task retention and background task admission explicitly at ASGI assembly through an immutable contract. HTTP, browser realtime and spawned tasks use the same installed owner. Missing bindings fail closed. The recovery website installs its existing ledger callbacks, preserving queue behavior. Extract inference receipt lookup into its own Models-only module and reuse it for pre-admission replay.

## Alternatives considered

- Lazily importing legacy quota functions hides the same database fallback.
- Removing admission during migration permits unbounded work and changes idempotency behavior.
- Copying the legacy cross-workshop ledger into each service violates service ownership.

## Verification

Fresh-process imports of HTTP capacity and realtime protocols verify no legacy database or account/assets/workshop ORM initialization with absent configuration and an empty encryption key. Signed HTTP tests exercise missing-binding rejection, unreserved reads and explicit reserve/release. Lifecycle checks cover cancellation, rollback failure, queue/spawn retention, missing spawn bindings and realtime handshake/provider failure. Existing inference replay and conflict checks remain active and use the explicit binding. Forty-nine targeted binding, inference, website quota, realtime, visual assistant and website checks pass; canonical contract and SDK checks pass.

The full backend suite passes 2028 tests with four conditional skips. Python lint/format, Agent Note and protected-document checks pass. Formal data, configuration and running services are unchanged.

## Consequences

HTTP and realtime protocols no longer import the legacy governance quota ledger. The recovery website explicitly installs its existing callbacks. HTTP rollback failures and realtime handshake failures still attempt to release an acquired reservation. Visual assistant admission binding is checked before persisting a new pending conversation turn.

## Risks

This binding is not the complete Models-owned admission ledger or a cross-service task grant. Those implementations remain required before formal startup. A saved principal alone cannot authorize arbitrary future spawned work.
