# Agent Note: Creative installation intent and source receipts

Status: implemented

## Problem

Creative and Integrations no longer share a transaction. When a target commit succeeds but its response is lost, generating a new installation operation can duplicate integrations. A source commit can also succeed while its acknowledgement is lost. Creative needs a durable, account-owned record that preserves the original operation and cannot silently change a pending bundle.

## Decision

Creative's explicit `0002_creative_install_operations` migration and owned ORM inventory introduce an account-scoped operation record. Its unique account and root release slot stores the canonical request fingerprint, immutable complete batch, batch fingerprint, UUID, pending/completed state and target receipt. The slot is acquired using a short SQLite writer transaction before any target I/O. New acceptance in that transaction rechecks the root and component publication status, component ordering, published manifests and metadata, and request-derived target names. A retry with equivalent request and batch returns the stored UUID; changing either conflicts. An uncertain outcome remains pending and is not replaced. Acknowledgement loss after a committed source transaction is handled by reading the same record on retry.

After a trusted target client obtains a successful receipt, source settlement validates its operation, root, ordered releases, kinds and resource shape, then persists the root and component installation records with the completed receipt atomically. Replay returns the same root installation. Conflicting prior installations or receipts abort the entire source transaction. Owner IDs are passed from the authenticated account and storage enforces account scoping; no caller-supplied destination owner is part of the batch.

An isolated coordinator accepts an opaque source authorization object and passes it unchanged to an injected source verifier and target port. It requires the source account before acceptance and again before settlement, queries an authenticated target receipt before any installation retry, treats lookup failures as unknown, and requires explicit target receipt verification. Only a confirmed absence permits submitting the same persisted batch. A known target receipt can be reconciled after publication withdrawal; any first target application must independently require current publication proof. These are abstract ports with no production transport or authority implementation.

## Alternatives considered

- Recompute and send a fresh UUID after an unknown outcome: can duplicate an already committed target installation.
- Record a target result before its source installation rows: can leave a false completed state after source failure.
- Trust a batch as proof of publication: permits changing the release content and target names independently of the original published resources.

## Consequences

This is an isolated storage and settlement primitive, not a complete independent installation flow. Its caller must authenticate the account, obtain a request-bound trusted target receipt and derive Skill archive descriptors from Creative-owned bytes. The request fingerprint only compares normalized input on replay; it is not a gateway-signed original request body or authorization evidence. Private HTTP transport, original body binding, Identity delegation, verified Skill archive generation/transfer, stdio coordination, recovery orchestration and end-to-end service acceptance remain unconnected. No arbitrary target capability or unauthenticated route is opened. Retaining unresolved intents favors safety over automatic release or retry with different inputs.

## Verification

Isolated Creative database tests cover migration replay and ownership, concurrent first acceptance, restart, original UUID reuse after source commit acknowledgement loss, changed-request conflicts, cross-account isolation, rejection of forged or withdrawn releases, strict receipt matching, bundle source settlement and receipt replay. Port tests simulate lost target responses, failed receipt checks, unverified target responses and revoked source authorization. Tests do not access a production database or contact Integrations.
