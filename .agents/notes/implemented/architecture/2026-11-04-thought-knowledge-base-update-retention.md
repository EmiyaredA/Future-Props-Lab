# Agent Note: Retain cover assets when updating Thought knowledge bases

Status: implemented

## Problem

An independent knowledge base can refer to an Assets cover. Updating the cover requires retaining its bytes through the source transaction and releasing the old pin only when the new revision is confirmed. Directory operations can advance the source revision independently of its cover projection.

## Decision

Use the existing public PUT operation and bind the Identity retention grant to the knowledge base ID in that path and an existing source revision. Validate the account, requested revision and image before preparing the new set. The write rechecks the revision using the existing reservation, commits the new metadata with the retention outcome, and leaves unknown commit results for outbox recovery.

## Alternatives considered

- Saving cover metadata before pinning the cover allows deletion before Assets receives the new reference.
- Requiring the source revision to equal the last projected revision rejects valid edits after directory-only changes.

## Consequences

New knowledge bases support cover replacement and removal. Existing records require a verified initial reference projection before this operation can prepare a change. The public request and response contract is unchanged.

## Verification

The isolated HTTP journey creates a covered knowledge base, advances its version through document creation, rejects a different account, removes the cover, rejects a stale retry and verifies that the delivered projection has no cover pin. Contract parity is checked against the existing OpenAPI operation.
