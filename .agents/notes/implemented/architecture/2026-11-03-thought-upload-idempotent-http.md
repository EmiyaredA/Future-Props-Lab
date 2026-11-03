# Agent Note: Retry Thought uploads with authenticated receipts

Status: implemented

## Problem

A response may be lost after Assets has committed an upload. Repeating the browser operation without a stable identity can create duplicate files, while a previously confirmed file may since have been deleted.

## Decision

The incomplete independent Thought application exposes the existing image and attachment upload endpoints with an optional per-account idempotency key. The browser assigns one key per queued upload and retains it for retries. Thought stages bounded bytes and rejects reuse of a key with a different descriptor. On confirmed replay it queries Assets again through a request-scoped Identity delegation and verifies an authenticated receipt bound to the HTTP method, account, request, descriptor and fresh nonce. A deleted target produces a conflict rather than a stale successful result. Authenticated metadata can enrich older ID-only confirmations. Missing private receipt credentials fail closed.

## Alternatives considered

- Creating a new identifier for every retry cannot distinguish an interrupted response from a new upload.
- Returning the locally stored ID without checking Assets can report a deleted file as usable.
- Retrying arbitrary requests with a broad service credential would weaken account and operation boundaries.

## Consequences

The queue identity lives in browser memory and does not survive reload or reselection. The existing recovery website accepts the header for contract compatibility but does not deduplicate it. Community upload authorization and an automatic remote replay worker are separate work. The independent application remains unready until its remaining service boundaries and deployment are complete; this change does not migrate production data or enable the independent service.

## Verification

Isolated Identity, Thought and Assets HTTP tests cover same-account retry, different bytes, account isolation, deletion before replay, missing credentials and result authentication. Browser tests verify that retries reuse the queue identity and send the header. Tests use temporary databases and synthetic credentials.
