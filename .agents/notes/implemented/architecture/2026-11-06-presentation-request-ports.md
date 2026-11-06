# Agent Note: Inject Presentation request ports

Status: implemented

## Problem

Presentation reads asset access, retention, and archive import adapters
from the database session. Their request scope is implicit, and routes
construct a project store without identifying its dependencies.

## Decision

A shared HTTP dependency asks the current assembly for an account-bound
project store. The website binds its shared-library adapter, and the
independent service binds its signed Assets client and reference storage.
Import selects its own adapter explicitly. Template editing and operation
receipts share the project store and its request transaction.

## Alternatives considered

A session-backed dependency registry would preserve implicit adapter
selection and force other callers to reproduce session setup.

## Consequences

The session retains account ownership and transaction context. Asset access,
retention and import reach the operation as explicit dependencies. The
website's local import and the independent delivery workflow retain their
respective commit boundaries.

## Verification

Presentation and standalone service regressions exercise project editing,
archive imports, exports, asset checks, and reference recovery. The
architecture gate keeps service lookups out of Presentation sessions.
