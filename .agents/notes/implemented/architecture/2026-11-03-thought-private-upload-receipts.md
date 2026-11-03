# Agent Note: Persist same-account Thought upload receipts

Status: implemented

## Problem

A Thought upload cannot write another service's filesystem or ORM directly. A lost Assets response also cannot prove that the file transaction failed, so retrying with a new identity risks duplicates or loss of staged bytes.

## Decision

The private upload descriptor binds kind, filename, MIME type, byte length and SHA-256. Identity delegates only the Thought images and attachments POST sources to the corresponding fixed Assets upload kind and a target path carrying the request ID and descriptor digest. Assets checks the original actor's effective write permission and live session, rejects browser cookies and origins, validates the description and streamed bytes, and rechecks authorization before the writer transaction. The Assets transaction commits the library row and an owner/request-ID unique receipt together; retries with the same descriptor return the same file and a changed descriptor conflicts. Commit ambiguity keeps the file rather than assuming a rollback.

Thought has an owner-scoped staged intent and retains its bounded, digest-checked source file until a local receipt confirmation commits. A lost confirmation response retains the staged file even if the database committed. Neither the staged intent nor the receipt stores a browser cookie. Both service migrations are append-only and tested solely against temporary databases.

## Alternatives considered

- Passing an arbitrary owner or filesystem path to Assets would widen authority and violate account isolation.
- Deleting staged data when a commit reply is lost can destroy the only recoverable copy of an already committed operation.
- Reusing an ID for a different descriptor would make retries ambiguous.

## Consequences

These are isolated private primitives, not an activated public upload flow. The Thought upload HTTP adapter, network transfer, replay worker and recovery of interrupted pre-intent staging are not assembled. The current browser upload request has no stable client request ID, so a browser retry after a lost response cannot be promised duplicate-free. Unknown or orphaned staged bytes are preserved; no time-based cleanup is performed. Community cross-account uploads require a separate authorization and remain closed. Existing data and migrations are not applied to a real deployment by these tests.

## Verification

Temporary databases and storage exercise receipt replay, same-ID descriptor conflict, upload kind and digest mismatch, account isolation, source staging and lost confirmation responses. Real Identity and Assets HTTP verifies exact delegation, same-account ownership, repeat request, source-kind mismatch and session revocation. No production database, provider or credential is used.
