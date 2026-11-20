# Agent Note: Amadeus live input and composer layout

Status: implemented

## Problem

The composer packs tools, model options and the send action into one wrapping row. During generation the send action becomes Stop and Enter silently does nothing. Users cannot correct a task, add evidence or see whether a supplemental request reached the executor.

## Decision

Tools and model selection occupy separate rows. Advanced options use an accessible dialog. A dedicated action area keeps Insert and Stop independently visible at narrow widths. Running tasks retain their frozen model, mode, project scope, capabilities and authorization.

Amadeus owns a durable instruction record and user message admitted atomically with conversation CAS. A request ID binds the content digest; retries return the original record. Each instruction is claimed once, and its receipt binds the owner, run, lease and prompt digest. Worker readiness expires after five seconds. Resource validation happens before the short admission transaction. Shared writer serialization prevents lost event sequence updates.

Codex and Pi use their existing native steering channels. Claude uses persistent stream-json input; OpenCode and Harness use isolated ACP sessions. These three acknowledge the old response boundary before continuing in the same native session. No Amadeus run or authorization is replaced. File and page references travel as descriptions and are read through the existing scoped tools.

Stop, questions, approvals and recovery reject unclaimed input and preserve dispatched input as unknown until an exact receipt confirms it. Unknown input is never retransmitted automatically or silently included in a later run's prompt. Accepted input is placed between response segments using the persisted event sequence, including after reload. Composer clearing removes only the submitted draft and references, preserving edits made during the request.

## Alternatives considered

- Supporting only Codex and Pi leaves the other configured agents without the requested interaction.
- Treating a second ACP prompt as native steering fails because the official interfaces admit one active prompt per session.
- Queuing everything for the next Amadeus run delays corrections and changes the requested interaction.
- Resending after a timeout can duplicate a request the executor already accepted.

## Consequences

The new instruction table and readiness column require both registered website and independent-service migrations. Existing migration entries are unchanged. No production migration or deployment is performed as part of source verification. The public instruction route, run-detail fields, permission registration and generated Web/SDK contracts change together. Private claim and receipt routes remain bound to the original Mac lease.

## Verification

Deterministic storage tests cover concurrent duplicate admission, conflicts, owner isolation, exact receipt validation, cancellation, restart and late receipts. Native transport tests cover Codex/Pi steering and Claude/ACP response boundaries, including unconfirmed cancellation. Five-agent service tests upload and deliver a file during a live run. Web tests cover uncertain request IDs and transcript ordering. Playwright exercises insertion, reload, independent Stop and non-overlapping controls at 320/480/768 pixels in light and dark themes, with screenshots under the ignored task evidence directory.

The architecture suite, scoped lint/format checks, TypeScript, Web build and bundle budgets pass. OpenAPI, generated SDK code and service ownership checks pass separately. The aggregate contract check stops at stale protected SDK documentation; those product pages remain unchanged. Verification uses isolated databases and deterministic executors; no paid model request or production migration is performed.
