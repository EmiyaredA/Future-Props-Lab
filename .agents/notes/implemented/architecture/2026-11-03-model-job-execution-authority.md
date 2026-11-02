# Agent Note: Model job execution authority

Status: implemented

## Problem

An execution quota says how much capacity is available; it does not prove an account authorized a queued task. Independent Models cannot consult Identity's database inside its task transaction, and retrying an accepted supplier submission after credential revocation can duplicate billing.

## Decision

Append an owned task-authorization migration. Save the original verified Identity assertion, exact allowed creation operation and immutable job-input digest in the same transaction as task creation and quota association. Keep these private execution records out of public schemas. Per-request admission providers capture the explicit HTTP context without global mutable state; the old static admission binding remains compatible.

Prepare claims by reading the owned task and checking its retained signed source, then close the database session before asking Identity whether that exact original request credential is still active. A local decision lasts at most five seconds and is checked against the current account, task ID and input digest inside the serialized claim. Unavailability defers. A revoked or missing grant rejects only a still-queued task and settles its quota in that same transaction. Settlement failure rolls back both changes. The generation store accepts explicit prepare/settlement callbacks; recovery website assembly keeps its existing defaults.

Already submitted supplier tasks may settle the same bounded task without creating another submission. Recovery of an interrupted submission retains the unknown outcome marker and capacity. A result-materialization retry can save an already known result but cannot replace its original submission grant.

Assign a reservation ID before committing. If commit succeeds but returning the ID is interrupted, the caller has no ID to release; admission resolves that exact unreturned reservation through its own release use case. It never releases an attached job, never repeats task creation and preserves the original exception. If cleanup cannot be confirmed, the durable record remains available to startup recovery.

## Alternatives considered

- Treating a service credential and arbitrary account ID as task authority allows account impersonation.
- Rechecking Identity while holding SQLite's writer lock couples task progress to network availability.
- Recreating a caller principal from stored quota role confuses accounting with permission.
- Requiring a new submit grant for supplier polling can strand already accepted work; retrying submission can duplicate billing.

## Consequences

Models owns twenty-three tables. Its accepted jobs can retain and revalidate their original request without importing Identity ORM. The persisted assertion does not grant arbitrary host execution or cross-service reads. Local expiry causes another fresh check, not automatic release or resubmission. Complete service/runner assembly remains mandatory before deployment.

## Verification

Forty-five focused checks pass across authority, admission and the generation driver. They cover transaction rollback, immutable replay, signature/actor/path/account/kind rejection, private read isolation, concurrent claim, fresh network checks outside writer transactions, unavailable Identity, expiry, changed input, revoked authorization, atomic settlement failure, unknown submission and signed HTTP provider binding. A fresh process imports authority without account/assets/workshop ORM or the legacy global database.

A new cancellation-after-commit test first reproduces an unreturned active reservation. Cancellation and ordinary lost commit responses now both release only the unreturned lease and preserve the original exception. The preceding full suite passes 2095 tests with four conditional skips; final regression includes this additional cancellation repair.

A fresh Identity HTTP scenario uses separate owned databases and normal login, management CAS, logout and API Key operations. Logout, disable, role downgrade and Key revoke reject queued jobs; a previously accepted supplier task continues querying the original ID. A bare Models service credential cannot authorize an arbitrary account. The CLI Key scenario deliberately uses a cookie-free client, preserving browser Session/CSRF precedence. Full regression and contract checks are recorded after completion.

The final full backend run passes 2097 tests with four conditional skips. Contract/SDK checks, repository lint and formatting, note and protected-document checks pass. The new scenario refuses non-temporary roots before migrations and its final guarded run passes. The seven deployed service implementations are unchanged from the preceding successful isolated container/browser acceptance; Models is still deliberately absent from the image entry-point list. No formal data, source credentials or website processes are used in verification.

## Risks

The new source grant is restricted to current Models creation operations. Other apps require explicit accepted-job API/delegation contracts, not a wider arbitrary-account permission. Models HTTP assembly, all runner completion hooks, supplier/demo, asset/native boundaries and governance/audit delivery remain incomplete. No formal data or running website processes are changed.
