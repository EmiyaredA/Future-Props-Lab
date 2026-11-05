# Agent Note: Models library input boundary

Status: implemented

## Problem

Inference input imports and transcription copy files by querying Assets ORM and opening its storage paths. Transcription policy also registers the full ORM through annotation aliases, and importing its package starts the unrelated text/demo pipeline. These dependencies prevent an isolated Models service. The existing transcription staging flow can delete a committed input when its commit response is lost.

## Decision

Introduce an explicit library input stream port. The recovery website installs its account-bound legacy adapter only in assembly. Models uses bounded HTTP through a purpose-specific private Assets endpoint. Identity verifies the original operation and destination read permission; source operation, caller, purpose and destination are fixed. Assets accepts a signed, request-bound studio assertion and only reads the current account's library media, excluding every project-specific scope. No storage path, storage key or foreign ORM enters the Models reader. The private protocol stays outside the public gateway and OpenAPI/SDK.

Read outside Models write transactions, enforce declared length and configured limits, reject transport compression and copy into owned storage. Preserve standard incoming-file zero/full reads while normal copy loops read at most one MiB. Source failures or cancellation before commit remove uncommitted input. Keep the file when commit may already have succeeded. Transcription shares one staging/commit flow and stores the source library ID as an opaque reference.

Use read-only model/provider value protocols for transcription policy. Remove unused eager text-service exports from the playground package; existing text consumers already import the concrete service. Its real provider/demo dependency remains explicit and unfinished rather than hidden behind lazy loading.

## Alternatives considered

- Mounting Assets data into Models violates service storage ownership and bypasses its authorization.
- Granting Models generic arbitrary-account file access exceeds the accepted request.
- Adding public query flags cannot bind library-only scope to a signature that covers only the path.
- Copying under a SQLite write transaction blocks unrelated writers on network or disk waits.
- Deleting input on every failed commit response can destroy content already referenced by a committed task.

## Consequences

Inference inputs and transcription can use only their own tables and files. The old website continues through an explicit recovery adapter; missing independent bindings fail closed. Private Assets reads reject browser cookies/origins and project scopes, with no private API in public discovery. Shared public error/type contracts remain compatible. The full Models service is still not deployable.

## Verification

One hundred seven targeted checks pass across new streams/private input transport and existing inference, transcription, Assets, retention, website, delegation and capability clients. Coverage includes Unicode names, exact bytes, metadata/length failures, size limits before body reads, cancellation, account binding, project-scope denial and committed-file preservation. A fresh process imports the input consumers without account/assets/workshop ORM or the global database.

A fresh HTTP scenario uses independent Identity, Assets and Models databases, normal logins and API Key creation. It verifies copied files, cross-account/project rejection, wrong service credentials, forbidden owner selection, source write permission, no-store responses, hidden private routes and logout revocation. The source permission regression uses an active read-only Key: read permission alone cannot authorize a write-origin model operation. A Models test HTTP composition exercises the real request binding without claiming the complete service is assembled.

Full backend regression passes: 2130 tests and four conditional skips. Lint, formatting, public/independent contracts and SDK checks pass. Real seven-service acceptance `fpl-isolated-agents-ad03015969` verifies the private Identity-to-Assets model input exchange alongside native collection, independent replacement, media processing, responsive browser programs and fresh login without Portal. Test migrations refuse non-temporary roots, and fixtures never use formal data or supplier calls.

## Risks

Output delivery, generation asset/backfill/materialization, text/demo/provider configuration, native execution and full Models assembly remain required. Unknown commits retain their files for owned reconciliation; cleanup must not guess their result. Cross-app writes still require their own idempotent delivery receipts. The new read-only copy does not widen task or host execution authority.
