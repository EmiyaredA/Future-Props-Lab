# Agent Note: Workbench history event ports

Status: implemented

## Problem

History event polling combined SQL, account scope, cursor recovery and SSE output. Even with an
explicit authorizer, replacing event storage required preserving protocol behavior inside the SQL
component, and recovery rules could not be exercised independently.

## Decision

`HistorySubscription` consumes immutable event pages and explicit authorization, disconnect and
pause callbacks. A cursor beyond the owner's latest event or backlog beyond 200 changes produces
the existing reset notification. Each loop rechecks authority before reading; a missing selected
conversation ends the subscription. Reconnect uses the client's cursor, with no global cache.

`SqlChangeEvents` binds the account and closes its session before returning a detached page.
The legacy conversation reader's HTTP errors are translated at this adapter boundary. SSE
encoding belongs to `transport/change_events.py`; both assemblies inject the same rule and
storage components with their respective authorizers. The mixed root module is deleted.

## Alternatives considered

- Moving the old file into storage would still mix cursor rules and wire encoding with SQL.
- Sharing a process-global cursor could mix accounts or prevent independent reconnect recovery.
- Holding a result cursor while streaming would extend SQL lifetime through client backpressure.

## Consequences

Memory and SQLite can satisfy the same event-page contract. Event names, IDs, heartbeat timing,
reset payload and authorization-expired message remain unchanged. This does not change event
retention or introduce background settlement of execution state.

## Verification

- Shared memory/SQLite cases cover backlog reset, future cursor reset, heartbeat, live revocation,
  account isolation, replay after a cursor and missing-conversation termination.
- Existing Workbench API and Identity revocation checks exercise the actual assembled adapters;
  independent collector recovery and source-closure checks preserve service isolation.
