# Agent Note: Bind Creative installation authorization to the original request

Status: implemented

## Problem

The Creative installation URL does not contain a release ID or destination names. A signed method and path alone cannot prove that an installation batch was requested by the current account, and forwarding a caller-supplied digest would allow the caller to substitute a different request body.

## Decision

A distinct Identity evidence purpose binds the exact bounded UTF-8 install request bytes, source assertion identifier, account and release ID for at most ten seconds and never beyond the source assertion. The existing isolated gateway bridge validates and forwards the original bytes and obtains this evidence with its unique gateway credential; it strips client credentials and does not retry an ambiguous forward. The Creative authorization port verifies the source assertion, evidence signature, account, original body, parsed request and the route's effective permission, then rechecks the session with Identity. The coordinator may invoke this port again after network work so a revoked or expired authorization cannot settle an operation.

The gateway bridge is still not mounted in production. Identity trusts its separately credentialed gateway to supply the true incoming bytes, so the dedicated socket and ingress lifecycle remain required. This evidence proves the user's request but does not prove that a target batch matches a current published release, nor does it authorize Integrations to accept one.

## Alternatives considered

- Signing only the URL cannot distinguish different releases or install names.
- Having Creative supply arbitrary body bytes to Identity would let it mint evidence for a request that never came from the client.
- Reusing source-import evidence would mix independent operations and their validation rules.

## Consequences

Existing public operation schemas and service routing remain unchanged. The new endpoint is private and fails closed without the dedicated unique gateway credential and live account authorization. Production Creative installation and deployment remain closed pending target-side publication proof, target authorization, Skill transport, supervised private gateway ingress and end-to-end deployment tests.

## Verification

Isolated gateway tests verify exact byte forwarding, duplicate-key rejection, removal of browser credentials and unknown-result handling without retry. A fresh Identity process verifies the real account session, exact evidence claims, cross-operation rejection, tampering, unauthorized service credentials and logout revocation. Creative's authorization port is also checked with the real Identity live-status endpoint and refuses a revoked session. Tests use temporary databases and synthetic credentials only.
