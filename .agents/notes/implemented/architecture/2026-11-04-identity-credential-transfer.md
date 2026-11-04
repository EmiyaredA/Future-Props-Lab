# Agent Note: Transfer Identity accounts and credentials from a frozen legacy snapshot

Status: implemented

## Problem

Changing the owner of the account database must preserve existing IDs, authentication credentials, account roles and revocations. A mismatched account or interrupted import must prevent promotion and leave the migration recoverable.

## Decision

Identity exports three typed, paginated datasets for accounts, Studio sessions and Management API keys from a checked immutable snapshot. It imports accounts first, then writes credentials under the verified account from the batch envelope. The business records and their receipt commit in the same transaction. The transfer process checks both sides using the same plan, exact page digests and total counts. The maintenance application authorizes requests before parsing, hides database parameters and returns sanitized validation responses.

## Alternatives considered

- Copying the legacy Identity tables into another SQLite file would bypass its schema and account checks.
- Reissuing every credential would change active access and require client reconfiguration.
- Serving migration endpoints on the normal gateway would widen access to credential digests.

## Consequences

The existing login hashing and expiration rules also apply to imported accounts. Existing Studio credentials cannot acquire management session purpose. Private migration transport is reused by Tools. Profile files, registration history, audit events and catalog ownership are tracked as separate dependencies for cutover.

## Verification

Two real loopback maintenance subprocesses import and verify an isolated legacy schema populated through account and credential use cases. The test checks missing account rejection, repeat transfer, secret-free errors, existing Studio session use, original Management API Key scope, revoked key rejection and separate password login for the other account.

The Identity relay also transfers active profile originals after account verification. It uses the database-bound owner path, MIME type and SHA-256 for both publication and readback. File publication is atomic and durable, and the same verified original can be submitted again. An incomplete staging file is outside the original-file inventory. The complete source snapshot retains it for recovery. Unassigned, absent or changed originals fail verification.

The isolated legacy fixture creates a PNG through the profile use case. The maintenance test rejects corrupted bytes, unassigned owners and stray originals, then confirms repeated transfer and exact bytes through the normal authenticated profile endpoint. The other account cannot read that avatar.
