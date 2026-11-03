# Agent Note: Creative batch installation receipts in Integrations

Status: implemented

## Problem

Creative installation formerly wrote integration tables and Skill directories in the same monolithic database transaction. Separate services cannot share that transaction. A lost target reply must not create a second installation, and a failed bundle must not leave a subset of integrations or remove files that a committed target receipt references. stdio setup also contains private environment values that Creative must not retain.

## Decision

Integrations owns fixed batch and per-release receipts with its independent `0008_creative_receipts` migration. The target use case accepts a short-lived, actor-bound decision for the exact purpose, operation ID and canonical input digest; it checks expiry again immediately before commit. The use case is deliberately not mounted as an HTTP API: the current gateway assertion does not bind the original request body, and no production caller may construct an authorization decision until Identity can verify the original request's exact body or an equivalent trusted binding.

A batch describes only public manifests and bounded, digest-addressed Skill ZIPs. The target validates names, source structure and ZIP metadata, stages files before acquiring the writer lock, rechecks authorization, then creates all target integrations and immutable receipts in the same short transaction. Skill placement uses same-filesystem directory rename. After commit has begun, an ambiguous failure retains potentially committed bytes; startup reconciliation checks the owned database before cleaning an orphan. The batch operation ID and digest must both match for a replay, and per-account release receipts prevent duplicate components across batches. Previously installed components remain bound to their original content and name.

Replaying a receipt for an integration that the user deleted returns a conflict and never recreates it. stdio setup fills a previously installed pending slot, creates a disabled MCP, encrypts its environment using the Integrations-owned cipher, and stores only a keyed fingerprint of the request for safe idempotency. Repeating the same setup returns the same resource; changing the consumed slot conflicts. The target receipt and setup state do not store environment plaintext. Authorization/network waits happen outside writer transactions.

`fpl_runtime/creative_integrations.py` defines path-free batch, archive and decision values. Its source target parser is only a URL parser and does not grant authority. In particular, Identity signatures must bind the original user request's source kind and ID; allowing an arbitrary source ID merely because the original path matches would allow same-account enumeration through a compromised caller.

## Alternatives considered

- Cross-database writes or copying raw host paths: violate ownership and cannot recover atomicity across services.
- Retrying an unknown installation with a new operation ID: can create duplicate target integrations after a lost response.
- Cleaning all staged or placed files on an exception: can delete files referenced by an already committed target transaction.
- Trusting a caller-supplied user ID, body digest or a path-only signed assertion: cannot establish the original request's exact authorization.

## Consequences

The owned target transaction, replay protections and encrypted stdio setup can be exercised in isolation. They do not make Creative independently deployable. Private HTTP, trusted original request-body binding, source archive delivery, source-side durable coordination, project certification and container acceptance remain separate gates. No existing production database is migrated by these checks.

## Verification

Isolated database tests cover mixed-bundle atomicity, conflicting names, account isolation, retry and concurrent requests, lost commit replies, unknown rollback with another operation taking the name, startup orphan cleanup, changed input digest, revoked authorization, archive integrity, deleted-resource replay and encrypted idempotent stdio setup. Tests use synthetic Skills and do not contact external providers. The owned Integrations migration is applied and checked only in temporary databases.

### Private target adapter (still gated)

The independent Integrations app mounts private preview, install, receipt and stdio routes. The adapter refuses requests without an explicitly injected Identity-backed `creative_authorization`; no production authority is configured. Its grant must independently verify the actor, original user request and exact destination body digest, including the immutable published version proof. Caller-provided digests alone are not authority. These routes are not deployable until the gateway/Identity proof, publication proof and Creative client are integrated and tested end to end. Multipart uploads are streamed to temporary files under a 32 MiB aggregate request limit; the target's existing archive validation independently checks each descriptor. Stdio validation failures do not echo input. Isolated HTTP tests cover absent authority, digest mismatch, cross-account receipt isolation, size limits and a mixed archive install/replay; the Identity integration remains untested and disabled.
