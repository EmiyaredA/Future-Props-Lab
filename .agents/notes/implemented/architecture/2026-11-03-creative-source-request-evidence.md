# Agent Note: Creative source request evidence

Status: implemented

## Problem

A Creative assertion binds its method and path, but does not prove which private integration the user selected. A business service could otherwise reuse it for a different account-owned source.

## Decision

Identity issues short-lived source evidence only to its uniquely credentialed Gateway. The fixed private operation verifies the original Creative request assertion and current account authority, parses bounded original UTF-8 JSON with duplicate keys rejected, and signs the original byte digest, owner, request identifier, kind and source ID. The signed evidence expires within ten seconds and no later than the original assertion. It contains no request body or secrets. Consumers must check all fields and current authorization; same-scope reuse within the validity period supports descriptor and content reads. The Gateway is the trusted attestor of the received original bytes; this primitive has no issuance ledger and does not independently prove those bytes came from Caddy.

## Alternatives considered

Path-only delegation cannot bind a requested source. Trusting a digest supplied by Creative would let it choose another source. Persisting original request bytes would expose input and is unnecessary for this bounded evidence.

## Consequences

The evidence is not a published-release or installation-batch proof. The private target and Gateway mediation remain disabled until the dedicated trusted ingress, receiver validation and end-to-end tests are in place. Revocation is rechecked at issuance and must also be checked by consumers before use; signatures alone do not reflect later logout.

## Verification

The isolated Identity application tests a real session and API key, revocation, invalid credentials, expired and altered assertions, invalid bodies, evidence field mismatch and same-scope replay. No public contract or persistent schema changes.
