# Agent Note: Separate Creative install and receipt authorization

Status: implemented

## Problem

An installation target must not rely solely on a caller-provided batch. It needs evidence that the current account requested the exact batch and, before a first application, that the Creative release is still published. Recovery must still be able to read an already committed target receipt after the release is withdrawn. A receipt-only authorization cannot safely authorize an install.

## Decision

Creative's install grant authority revalidates the original Identity and gateway request evidence, locates the current account's existing durable outbox intent, and compares both the complete batch and the fingerprint of the original request. An install grant additionally checks current publication and Skill source integrity, then revalidates the actor after any file work. A receipt grant skips the current-publication check but still requires the matching account, original request and existing batch. Grants expire within five seconds and no later than either source assertion or gateway evidence.

Integrations validates `receipt` and `install` as separate purposes. A receipt grant cannot authorize installation even if a matching resource already exists. The direct grant boundary is an internal use case; it is not a deployed cross-service transport.

## Alternatives considered

- Trusting a target request's batch digest would let the caller choose the installed content.
- Requiring current publication for receipt lookup would prevent recovery after a target committed and the source was withdrawn.
- Returning the same grant purpose for receipt and install would allow a withdrawal bypass.

## Consequences

The grant check narrows the gap but a short-lived source decision is not an atomic cross-service transaction: publication may change after the check and before the target commits. Production use still needs a deliberately designed publication/installation coordination policy, authenticated target-to-source transport, private gateway ingress and full deployed-service verification. Creative installation HTTP remains closed without the required target authorizer. Existing durable intents and target receipts remain unchanged; private authorization purposes change together.

## Verification

Isolated tests exercise matching and forged batches, revoked sessions, withdrawal, receipt recovery and rejection of a receipt grant for install. A scenario uses separate Creative and Integrations databases, commits an installation, withdraws the publication, and verifies that only the receipt path remains authorized. No persistent user data or production credentials are used.
