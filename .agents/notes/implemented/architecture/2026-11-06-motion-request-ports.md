# Agent Note: Inject Motion project resources

Status: implemented

## Problem

Motion document, snapshot, and export components selected the project
resource adapter through the SQL session. The worker also relied on the
website's session configuration.

## Decision

The two HTTP assemblies construct account-bound projects with explicit
resource adapters. The website worker receives the same project factory
bound to its local resources. Document, file, snapshot, export, and
handoff adapters share the request's project adapter.

## Alternatives considered

Passing a session-local adapter registry would retain the hidden dependency
for both request and worker lifecycles.

## Consequences

The legacy layout and independent reference mutation paths retain their
transaction and recovery rules. Independent reference preparation receives
the account explicitly from the authenticated request.

## Verification

Motion regressions cover account scope, editing, snapshots, export and
recovery. An architecture check guards the former session lookup.
