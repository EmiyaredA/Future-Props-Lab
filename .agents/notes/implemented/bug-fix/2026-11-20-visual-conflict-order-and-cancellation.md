# Agent Note: Visual conflict ordering and cancellation cleanup

Status: implemented

## Problem

After the [workflow boundary refactor](../architecture/2026-11-20-visual-workflow-component-boundaries.md), polling and pending save receipts can still arrive in different orders. An older 409 can replace a newer conflict snapshot; a successful late save can report saved while a conflict remains unresolved. Repeated cancellation can also interrupt a polling worker's finally block before cleanup has completed.

Three existing frontend tests use obsolete picker interactions or lack a shared jsdom dialog implementation. The compact reference strip also omits the parent's drag-active state, losing its drop feedback. Generated SDK references lag behind the checked-in contract.

## Decision

- Persistence accepts conflict snapshots monotonically and keeps confirmed revisions monotonic. A pending save result cannot clear an unresolved conflict or replace the local draft. Both server and local resolution use the newest known snapshot; network failures remain secondary to an existing conflict.
- Polling shields the original batch, sends cancellation once to each unfinished worker and shields aggregate cleanup against repeated cancellation. It also drains the original batch receipt. Cancellation takes precedence over a prior task error when requested during cleanup.
- `web/tests/support/dialog.ts` supplies missing jsdom dialog methods through common setup, preserving native APIs when available. Component tests exercise search focus, confirmation, focus restoration and pending cancellation without modifying production dialog behavior.
- Reference tests use the current confirmation step, shared add control and named media groups. The compact reference strip receives drag-active state explicitly and reuses the existing highlight style.
- The user authorizes regenerating SDK references with the existing generator. Fourteen SDK pages and the coverage list form the documentation update; public schemas, routes and registered migrations remain unchanged. Protected article changes are listed separately from code and engineering changes for later independent commits. No commits, pushes or deployment are performed.

## Alternatives considered

- Resetting the save indicator on every receipt hides unresolved conflicts and permits subsequent actions using stale state.
- Propagating each cancellation immediately leaves handler cleanup incomplete. Cancelling workers repeatedly also interrupts their finally blocks; shielded draining keeps cleanup owned by the caller.
- Restoring obsolete upload buttons or relaxing test assertions would obscure current product behavior. Tests instead follow the current controls and retain their business assertions.
- Adding a production dialog fallback for jsdom limitations changes browser behavior without a product need. Test environment support remains separate.

## Consequences

Unresolved conflicts continue to block generation and preserve drafts regardless of response order. Cleanup completes before polling returns, with the existing per-runner limit and explicit shared-limit injection retained. There are no data migrations or changes to formal runtime state. Protected SDK documentation is changed under the user's explicit scope decision, while commit isolation remains pending because the user chooses working-tree delivery.

## Verification

Controlled promises cover older/newer success receipts, stale 409 responses, network errors, out-of-order polling and both conflict resolution choices. Event barriers cover repeated cancellation and cancellation during failure cleanup, including releasing an injected concurrency limit. The focused frontend run passes 35 tests; all five polling isolation tests pass. The historical Visual migration/restore journey passes using temporary configurations, databases and loopback listeners.

The complete architecture/runtime/Visual backend run passes 442 tests with one existing opt-in skill-browser test skipped. All frontend tests run: 2022 pass and four fail. The same four failures reproduce in the unmodified HEAD snapshot: Spreadsheet Workshop is missing existing documentation navigation, official knowledge, technical chapters and responsive scenario coverage. These unrelated articles, navigation and responsive inventories remain outside this change. The three originally reported Visual frontend failures all pass.

TypeScript, lint, formatting, the complete SDK/OpenAPI/service contract check, Agent Note checks and the Studio build pass. Fourteen SDK reference pages are regenerated and `sdk/python/coverage.json` is synchronized. The default documentation protection check reports the explicitly authorized dirty SDK pages; its independent-commit check remains pending under the user's no-commit delivery choice. `.local/architecture-followup-20261120/` contains reproducible logs and `delivery-groups.json` separates protected documentation from engineering changes. Formal configuration, registered migrations and persistent user data are unchanged.
