# Agent Note: Cancel Creative installation with a target tombstone

Status: implemented

## Problem

A Creative publication fence cannot safely expire when an installation times out: an in-flight Integrations transaction may still commit. Without a way to prove that the target will never commit, an interrupted installation can indefinitely block publication withdrawal.

## Decision

Integrations appends `0009_creative_cancellations` and Creative appends `0004_install_cancellations`. A cancellation request carries a separately authorized, exact account and batch. In an immediate Integrations writer transaction it either returns the existing committed receipt, or persists an owner/operation/fingerprint tombstone. Installation rechecks the tombstone inside its own writer transaction before making any changes, so a committed cancellation and a committed installation are mutually exclusive. It also checks before extracting Skill files. A lost cancellation response is recovered by replaying the same operation.

Creative accepts only a target-authenticated exact cancellation result, records it and deletes the operation's publication fences in one transaction. A missing response, wrong fingerprint, untrusted response or target not-found never releases a fence. A cancelled operation remains permanently barred from later source submission. The coordinator handles both target outcomes: verified cancellation releases the fence; a verified already-committed receipt settles the installation. It revalidates the source identity after remote work.

## Alternatives considered

- A timeout or absent receipt does not prove that a target writer will not commit later.
- Deleting a target tombstone after acknowledging cancellation would allow a delayed retry to install after the publication fence is gone.
- Holding a source SQLite transaction across the target request would not make the two databases atomic and would hold a long writer lock.

## Consequences

The private cancellation route remains unavailable without the missing trusted Identity-backed target authorizer. The coordinator depends on an explicit target port that authenticates cancellation and receipt responses; the production transport, original user interface, safe new attempt after cancellation and deployment assembly are still incomplete. Until those are wired, the service remains closed and no cancellation is presented to users. Successful cancellation releases only its own publication fences; it never removes an already committed installation.

## Verification

Temporary independent databases exercise cancellation and installation races, permanent tombstones across restart, exact and cross-account replay, malformed results, response loss, late installation rejection, and fence release. Separate source and target databases verify that a target tombstone allows the originating publication to be withdrawn only after the matching cancellation is settled. The private HTTP route fails closed without its authorizer. No production data or credentials are used.
