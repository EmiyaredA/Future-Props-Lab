# Agent Note: Fence publication changes while installation outcomes are unknown

Status: implemented

## Problem

A short-lived authorization cannot make publication withdrawal and an installation commit in different SQLite databases atomic. A release may be withdrawn after Creative checks it but before Integrations commits. Conversely, a lost target response does not prove that installation failed, so a timeout cannot safely release the publication.

## Decision

Creative appends its own `0003_install_fences` migration. Before issuing a first-install grant, Creative verifies the original account request and persisted batch, validates current releases and Skill source files, then in one immediate write transaction rechecks them and inserts durable fences for the root publication and every component publication. The independently assembled Creative session guards status changes and release modifications against those fences; SQLite serializes the fence reservation and publication update. Both ORM writes and bulk SQL updates are guarded.

A fence has no expiry. The source installation settlement validates the trusted target receipt, records the installation and deletes its operation's fences in the same transaction. A timeout, account revocation, process restart, lost target response or invalid receipt leaves the fence in place. Exact intent and receipt replays remain idempotent. Receipt-only grants stay distinct from install grants.

## Alternatives considered

- Expiring a lease can allow withdrawal while a slow target transaction is still able to commit.
- Calling the target inside a Creative write transaction would hold a SQLite writer lock across network and file I/O, without making the two databases atomic.
- Releasing a fence when a request times out can misclassify an already committed install as failed.

## Consequences

This is a source-side consistency primitive, not a completed deployable service. It only protects writes using the independent Creative session and requires a trusted target client to authenticate receipts. Production Creative routes, gateway ingress and target-to-source transport remain unimplemented. The target tombstone cancellation protocol is described in [the follow-up decision](2026-11-03-creative-install-cancellation.md), but its authenticated transport and user interaction are not yet wired. Until then a failure before target commitment can leave publication withdrawal blocked; no timeout release is provided. The source process and target must not bypass this boundary or the original outbox.

## Verification

Isolated SQLite tests cover repeat reservation, restart, wrong account, malformed receipt, ORM and bulk-update blocking, verified settlement, exact replay and a concurrent fence/withdraw race. Separate Creative and Integrations databases exercise a committed target result, blocked withdrawal, source settlement, and subsequent withdrawal with receipt recovery. All migrations execute only in temporary databases.
