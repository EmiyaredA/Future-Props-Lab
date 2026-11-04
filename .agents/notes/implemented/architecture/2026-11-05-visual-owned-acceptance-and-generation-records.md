# Agent Note: Visual owned acceptance and generation records

Status: implemented

## Problem

Visual still routed template and generation-history requests through the legacy website. Importing the legacy generation or review implementations in the standalone process would pull in the model catalog, provider runtime and asset storage.

## Decision

The legacy and standalone routers share the acceptance template and standard handlers, retired write responses, and task and batch record handlers. Visual owns these records. Signed request claims establish the account before ORM access. The shared generation state rules preserve the queued cancellation CAS and only reopen an already accepted task for polling or result materialization.

## Alternatives considered

Keeping a second copy of the handlers would allow operation schemas and error responses to diverge. Mounting the legacy generation runner would require access to provider credentials and unrelated tables.

## Consequences

The mounted record operations preserve the published paths and operation IDs. Visual startup remains gated while model submission, output writes and the remaining Visual operations are being integrated.

## Verification

The signed-service integration test checks public operation parity, legacy template visibility, retired operations, cross-account task isolation, stale and valid cancellation, and replay-safe retry of an accepted provider task. Legacy acceptance, generation and runtime tests cover the shared rules.
