# Agent Note: Account-scoped background task recovery

Status: implemented

## Problem

Generation and transcription runners initially fetch account-owned records without a bound account. Recovery updates several accounts in one session. These paths cannot run under independent service database guards, and rebinding an already scoped session to a loaded task can cross its caller's account boundary.

## Decision

Resolve an unbound runner's account using a narrowly scoped, read-only lookup of an owned task ID. Bind that account before loading the task and never replace an existing binding. Recovery enumerates affected accounts with explicit system reads, then performs each account's state transitions and log writes in its own short transaction. Polling enumerates IDs without granting system-write permission.

Inference file recovery reads only Models-owned references and its inference directories, with an explicit storage instance. It does not enumerate Identity accounts, follow symbolic links, remove nested directories or touch other applications' files. Input retrieval binds the persisted task's account before querying private input records.

## Alternatives considered

- Disabling service database guards makes isolation unverifiable.
- Loading Identity's account table recreates a cross-service database dependency.
- A system-write session for startup recovery permits unrelated account writes.

## Verification

Guarded Models database tests exercise polling, concurrent claim, inference completion, interrupted supplier submission and transcription recovery without Identity tables. Cross-account loads return no record even with another account's object already in the identity map; existing bindings remain intact. An interruption between recovery accounts preserves the first commit and resumes the second exactly once. System reads cannot write account records. Concurrent supplier submission occurs once. File recovery preserves committed inputs/outputs and unrelated original files, removes only uncommitted regular inference files, rejects directory links and preserves file links and nested directories.

Thirty-nine focused task/runtime and legacy generation/transcription checks pass. The full backend suite passes 2018 tests with four conditional skips. Contract/SDK, Python lint/format, Agent Note and protected-document checks pass. Formal runtime files, configuration and services are unchanged.

## Consequences

Shared generation state transitions and transcription recovery work with independent service guards. Inference startup no longer queries account ORM; it owns an explicit storage instance and uses task-bound input queries. Public request and cross-service authorization remain separate from internal task ownership lookup.

## Risks

Task IDs and account lookup are internal runner mechanics, not authorization for public requests. Cross-service task grants, asset access and native execution remain required before deploying the complete Models service.
