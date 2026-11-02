# Agent Note: Durable Identity-to-Models account catalogue delivery

Status: implemented

## Problem

Identity already records account-created events atomically, but cannot deliver them to an independently owned Models database. Retrying account initialization without a durable consumer receipt can duplicate seeded providers or overwrite an imported catalogue after an uncertain acknowledgement.

## Decision

Expose a versioned private Models-only poll/ack protocol with strict, minimal account-created payloads. Consume events into Models with an immutable digest receipt, one account-bound writer transaction, and an explicit local catalogue initializer. Acknowledge Identity only after Models commits. Retries reuse the receipt, reject changed event content, and preserve existing catalogues and default selections.

The initializer is required and performs only local Models work; complete service assembly must supply owned role-template policy. Historical event roles are not initialization authority. Identity supplies the current role/revision separately with a 20-second lifetime and retains disabled accounts' events without delivering them. New receipts require a fresh current-account view after the writer lock is acquired. A committed receipt may settle the same immutable event after expiry without initializing again. No consumer is installed into the formal website, and complete Models startup remains gated on its remaining ports.

## Alternatives considered

- Writing Models from Identity restores a shared transaction/database dependency.
- Acknowledging before the consumer commits loses work on failure.
- Re-seeding on every delivery changes IDs and duplicates or overwrites user configuration.

## Verification

Verify authenticated minimal poll/ack, rejection of browser and unrelated service credentials, revision conflicts and unknown private/public routes. Use independent guarded Models storage to verify initial seed, preservation, concurrent replay, changed-content refusal, rollback and acknowledgement-loss recovery. No network wait holds a Models write transaction. Preserve existing Identity account creation and public contracts.

Nineteen targeted provisioning, fresh-interpreter HTTP delivery, Identity and Models schema checks pass. The real HTTP scenario downgrades and disables accounts through normal governance APIs, observes current roles, retains disabled events, and recovers from acknowledgement loss both before and after the source commit. Storage checks cover concurrent delivery, changed event content, preservation, expired/far-future state and an interrupted Models commit that actually committed. Existing receipts settle without reinitialization. Transport tests reject redirects, oversized responses, malformed payloads and mismatched acknowledgements.

The final full backend suite passes 2052 tests with four conditional skips. All seven implemented images rebuild and synthetic container/browser acceptance `fpl-isolated-agents-3944ec7a72` passes, including the real Identity private protocol, correct and invalid public Host behavior, Portal stop/recovery and responsive themes. The container probe uses Python's standard library, matching Identity's minimal image. Contract/SDK, Python lint/format, Agent Note and protected-document checks pass. Source migration versions remain unchanged; only the new Models receipt migration is appended. Formal data and running services are unchanged.

## Consequences

Identity and Models exchange only strict minimal account metadata, never database handles, passwords or provider credentials. A new Models account catalogue and receipt commit together before source acknowledgment. Existing configuration and IDs survive retries. Models owns twenty tables and retains an explicit initialization callback; the full role-template policy and ASGI/image assembly remain separate work.

## Risks

Role-template initialization, full Models ASGI/image wiring and controlled formal-data transfer remain required. Account-created delivery does not replace live Identity authorization, account lifecycle governance or cross-service task grants.
