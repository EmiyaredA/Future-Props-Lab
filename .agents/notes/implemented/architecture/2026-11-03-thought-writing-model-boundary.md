# Agent Note: Thought writing uses an explicit Models boundary

Status: implemented

## Problem

Thought writing reads Models ORM and encrypted provider credentials, invokes providers and settles call logs through the monolith database factory. This prevents an independently owned Thought database and exposes note content to a generic inference log if the existing public text endpoint is reused unchanged. Community creates plain sessions from its engine and silently drops an independent service's storage guard.

## Decision

Thought validates the current note, revision and selected text, ends its read transaction and calls an explicit writing-model port. Recovery assembly installs its own provider adapter with a supplied session factory and transport. Missing bindings fail closed; business code does not import the recovery adapter or fall back to the monolith database.

A private Models router returns only model IDs and labels and executes a fixed writing request. Identity binds delegation to the original Thought operation, the same note ID, the destination method and a digest of every writing field. Models verifies that digest and a still-active actor, owns capacity and provider calls and periodically rechecks authorization even while a supplier is silent. No automatic request retry is performed. A response owns lease cleanup even if cancellation happens before the first body iteration; usage settlement uses an account-bound, short independent transaction.

The writing log preserves the former privacy contract: note ID, revision, action and character counts are recorded; note content, instruction and generated text are excluded. Public Thought paths, operation IDs and normalized stream events remain unchanged. Private routes do not enter public OpenAPI, SDK or gateway discovery.

Thought has a frozen independent schema with its 28 owned tables and its local operation receipts. External account, file and integration IDs are opaque in that schema; only owned relationships retain SQLite foreign keys. Explicit ID column types let the isolated ORM load without importing foreign models. Recovery ORM foreign keys and historical migrations remain unchanged.

Community source sessions preserve the originating async and synchronous session types and ownership metadata, including request-bound ports. Publication registry reads explicitly allow system reads; they do not permit account writes before the source owner is checked and bound.

## Alternatives considered

- Forwarding writing to generic text inference stores the full note and instruction in the generic request log.
- Keeping provider credentials in Thought leaves Models updates and security policy coupled to the workshop.
- A service credential alone cannot select another account or authorize an unrelated note operation.
- Recreating a plain session from the engine bypasses service model and ownership guards.

## Consequences

Thought's writing consumer imports no Models, Assets or Identity ORM or global database factory. Models owns writing execution and redacted call logs. The recovery website retains its established model selection, output and error behavior through explicit assembly. The owned Thought schema and writing boundary do not make the entire service deployable: asset retention, archive transfer, source-account community files and external-integration execution still require their own complete protocols and receipts.

## Verification

Targeted checks cover real Identity login and delegation with independent Models storage, two-account isolation, destination and note binding, changed request digests, private-route denial, logout revocation, output events, redacted logs, capacity settlement, silent-provider revocation and cancellation before streaming. Recovery Thought tests preserve original API behavior. Separate migration and storage checks verify all 29 tables, repeated migration, database ownership rejection, foreign-key integrity, pure imports and retained Community service guards. Formal data and real providers are not used.
