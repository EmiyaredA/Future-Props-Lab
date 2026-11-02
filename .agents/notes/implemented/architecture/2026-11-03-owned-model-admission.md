# Agent Note: Models-owned execution admission

Status: implemented

## Problem

The recovery website's quota implementation loads account tables, shared settings and every workshop task model. Independent Models cannot use it without violating database ownership, and dropping restored tasks without leases would admit work beyond the configured capacity.

## Decision

Add a Models-owned CAS quota policy with an appended migration. Move pure quota protocol values to LLM schemas with compatibility exports. Implement admission with an explicit session factory, short serialized reservation transactions, account-bound task association and fixed own-table aggregate accounting. Include active tasks lacking a lease, without returning private records across accounts. Task creation and association share one transaction; replay cannot change the task set or attach a task twice.

Keep registration and read-only developer document protocols in separate owning schema modules. Identity and Portal import those modules directly; only the recovery website uses the old aggregate compatibility exports. Moving a model protocol must not put Models into another service's source closure.

Capacity does not authorize new execution. The assembly must explicitly supply separately authorized spawned-task admission. Missing task records, unknown states and the existing persistent supplier-submission interruption marker retain capacity. Only startup recovery releases vanished synchronous calls; persistent tasks settle from confirmed outcomes. Keep old monolith migration SQL and quota assembly unchanged.

## Alternatives considered

- Reading the old ledger retains cross-service database dependencies.
- Replicating every task table into Models gives multiple services ownership of the same state.
- Ignoring restored tasks or expiring uncertain leases by time can over-admit work while a supplier submission remains unresolved.
- A fabricated account principal for local capacity bookkeeping conflates accounting with authorization; internal checks take explicit persisted owner and role instead.

## Consequences

Models owns twenty-two tables. Quota CAS and execution accounting can operate without Identity or workshop ORM. Failed task creation does not detach or consume the original reservation. Global quota statistics use fixed Core aggregate queries against owned tables, while ordinary resource reads remain account-filtered.

## Verification

Nineteen isolated checks cover concurrent global reservations, administrator reservation, account and voice limits, invalid scopes/weights, quota CAS races/rollback and JSON-safe conflicts, immutable association, duplicate association rejection, task creation rollback, restored unleased tasks, private read isolation, uncertain/missing outcomes, startup recovery and partial batch settlement. A fresh interpreter imports admission without the legacy database, account/workshop ORM or governance schemas.

The first full run exposes six isolation failures caused by the shared governance schema importing the moved model quota protocol. Separating the registration/document protocols fixes the source closure; fourteen related identity, portal, management, packaging and event-delivery checks pass again.

The corrected full backend suite passes 2078 tests with four conditional skips. Contract/SDK, Ruff, format, note and protected-document gates pass. Seven independently built service containers pass the headless browser/native smoke journey (`fpl-isolated-agents-3b692b04f1`), including Portal stop/recovery, fresh login without Portal, private account events, Assets/Rendering replacement and responsive themes. Models remains outside the deployable image list. All verification uses isolated data and synthetic credentials.

## Risks

The owned ledger is not yet a complete Models service. Queue authorization, execution outcome callbacks, HTTP governance/audit delivery, provider/asset/native boundaries and final assembly remain required. Recovery must run before the service starts accepting requests, never as a periodic mechanism to discard live synchronous reservations. Formal data and services remain untouched.
