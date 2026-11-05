# Agent Note: Galgame job records

Status: implemented

## Problem

Galgame's annotation imports, video exports and editor handoffs could only read their saved job records through the compatibility application.

## Decision

Read the tasks from the owning project database and share the public record formatting with the compatibility application. Export and handoff cancellation use the same queued and running states as the original operations, with a writer fence before loading and changing the task. External project and asset identifiers remain opaque to the Galgame ORM.

## Alternatives considered

Loading the legacy executors would pull the model, video and Assets databases into the project owner. Reusing a generic job response would lose phase and artifact fields used by the published browser operations.

## Consequences

The seven read and cancellation operations retain their URLs and response fields. A queued task settles as cancelled in one transaction. A running task records cancellation for its executor. Task creation and execution have separate service boundaries.

## Verification

Signed endpoint tests cover both accounts, same-project filtering, historical responses, queued and running cancellation, and repeat cancellation of a terminal record. The application schema matches the published operations.
