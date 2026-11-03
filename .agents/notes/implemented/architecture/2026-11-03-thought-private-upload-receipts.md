# Agent Note: Persist same-account Thought upload receipts

Status: implemented

## Problem

A Thought upload cannot write another service's filesystem or ORM directly. A lost Assets response also cannot prove that the file transaction failed, so retrying with a new identity risks duplicates or loss of staged bytes.

## Decision

The private upload descriptor binds kind, filename, MIME type, byte length and SHA-256. Identity delegates only the Thought images and attachments POST sources to the corresponding fixed Assets upload kind and a target path carrying the request ID and descriptor digest. Assets checks the original actor's effective write permission and live session, rejects browser cookies and origins, validates the description and streamed bytes, and rechecks authorization before the writer transaction. The Assets transaction commits the library row and an owner/request-ID unique receipt together; retries with the same descriptor return the same file and a changed descriptor conflicts. Commit ambiguity keeps the file rather than assuming a rollback.

Thought has an owner-scoped staged intent and retains its bounded, digest-checked source file until a local receipt confirmation commits. A lost confirmation response retains the staged file even if the database committed. The request-bound transport exchanges the original assertion for a target-specific Identity delegation, streams only the staged file, bounds and validates the Assets receipt, and confirms the local intent only after that receipt. [The receipt authentication decision](2026-11-03-thought-upload-result-authentication.md) binds successful responses to the account, descriptor and fresh nonce using a distinct key. The confirmed source result includes the authenticated target filename, normalized MIME type and byte size so a retry can reproduce the original attachment response. An older ID-only confirmation may be enriched only from an authenticated target reply; conflicting metadata is rejected. A confirmed replay removes a retained staging file after a lost local commit response. On startup, while the service holds its exclusive process lock, recovery removes confirmed staging copies and files with no durable intent; the latter cannot have reached Assets because delivery requires the intent to commit first. Pending and unrecognized states remain untouched. Recovery uses non-following directory handles and skips symlinks. Neither the staged intent nor the receipt stores a browser cookie. Both service migrations are append-only and tested solely against temporary databases.

## Alternatives considered

- Passing an arbitrary owner or filesystem path to Assets would widen authority and violate account isolation.
- Deleting staged data when a commit reply is lost can destroy the only recoverable copy of an already committed operation.
- Reusing an ID for a different descriptor would make retries ambiguous.

## Consequences

These are isolated private primitives, not an activated public upload flow. The Thought upload HTTP adapter and automatic remote replay worker are not assembled; interrupted local pre-intent staging and confirmed local copies are reconciled at locked startup. The request-bound network transfer and local confirmation are available as an explicit service operation but are not mounted as a public endpoint. The current browser upload request has no stable client request ID, so a browser retry after a lost response cannot be promised duplicate-free. Unresolved or unrecognized intents are preserved; no time-based cleanup is performed. Community cross-account uploads require a separate authorization and remain closed. Existing data and migrations are not applied to a real deployment by these tests.

## Verification

Temporary databases and storage exercise receipt replay, same-ID descriptor conflict, upload kind and digest mismatch, account isolation, source staging and lost confirmation responses. Real Identity and Assets HTTP verifies exact delegation, same-account ownership, repeat request, source-kind mismatch and session revocation. A real Identity and Assets ASGI scenario also exercises the staged transfer, an existing remote receipt, local confirmation and logout revocation; a lost response preserves the staged file and intent. Startup recovery tests use an isolated database and actual service lock, covering confirmed, uncommitted, pending, unknown and symlink cases. No production database, provider or credential is used.
