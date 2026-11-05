# Agent Note: Authenticate Thought upload receipts

Status: implemented

## Problem

After sending staged bytes, Thought must not treat an unauthenticated Assets response as proof that the upload committed. An incorrect asset ID could cause the source to delete its only staged copy, and a previously valid response must not be reused for another request or account.

## Decision

Assets requires an explicitly configured private receipt key before accepting the internal Thought upload operation. For a successful upload or exact receipt replay, it signs the exact response bytes together with the authenticated account, request ID, upload descriptor fingerprint and a fresh caller nonce. Thought supplies a new cryptographic nonce, verifies the signature with a separate credential, validates the returned file description, and only then commits its own receipt and removes the staged file. The receipt key and Thought service credential must differ.

A missing signer, absent or forged signature, stale nonce, wrong account, timeout or malformed result fails closed. A target commit followed by a lost response remains recoverable: the target's durable same-request receipt can be replayed with a new nonce and signed again. No signature, browser cookie or personal credential is persisted in the source upload intent.

## Alternatives considered

- Trusting a successful HTTP status and asset ID alone can discard source bytes after a substituted response.
- Signing without the account or request descriptor allows a valid response to be reused for another upload.
- Reusing a service credential as the receipt key broadens the impact of either credential.

## Consequences

The signing key is an explicit private service-assembly input and must be unique from every service and ingress credential in a future deployment. The Assets route returns 503 without it. The incomplete independent Thought application now mounts a public upload adapter and uses authenticated receipt queries on retry, as described in [the upload retry decision](2026-11-03-thought-upload-idempotent-http.md). Automatic remote replay and complete independent service assembly remain unimplemented. A retained source file is never deleted merely because a response timed out.

## Verification

Isolated Identity, Assets and Thought tests exercise an actual same-account upload, target receipt replay, local confirmation and session revocation. Fault tests reject missing signers, missing nonces, forged or replayed signatures and wrong accounts while preserving staged bytes. Tests use synthetic credentials, temporary SQLite databases and isolated storage only.
