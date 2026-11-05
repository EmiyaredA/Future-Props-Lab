# Agent Note: Workbench subscription ports

Status: implemented

## Problem

The compatibility Workbench subscription loaded Identity ORM directly, while website and
independent execution routes duplicated version comparison and heartbeat logic. This tied one
protocol implementation to local account storage and made subscription behavior harder to test.

## Decision

Identity owns the live website Session check, injected with its session factory and clock.
The Workbench event stream always receives an explicit authorizer; no local fallback or wrapper
module remains. Independent authorization continues through its existing Identity client.

`ObserveTurns` owns revision comparison, heartbeat selection and reconnect behavior. Both
assemblies inject a `SqlTurnVersions` adapter and live authorizer into the shared SSE adapter.
SQL sessions close before any event is yielded. Readiness remains an advisory process-local value
and keeps each entry's existing wire representation. Subscription never decides execution state.

## Alternatives considered

- Retaining an optional local authorizer hides a dependency on the compatibility Identity schema.
- Sharing only SSE string formatting would leave duplicated observation and reconnect rules.
- Sending from inside a database session would hold resources during client backpressure.

## Consequences

The business observer can run without HTTP, SQL or a live worker. Existing event names, heartbeat
intervals, history cursors and terminal authorization notification remain compatible. This batch
does not migrate Workbench command, approval or settlement transactions.

## Verification

- Pure subscription tests cover changed/unchanged versions, live revocation and fresh snapshot on
  reconnect. The existing stream test verifies no SQL session remains open during event delivery.
- Existing history stream revocation test now injects the actual Identity authorization adapter.
- Workbench, cloud control, history preview and Studio checks: 85 passed. Architecture plus pure
  observer: 49 passed. All 23 prepared service source closures load; OpenAPI and ownership checks
  pass. These use isolated fixtures and controlled native programs, not formal application data.
