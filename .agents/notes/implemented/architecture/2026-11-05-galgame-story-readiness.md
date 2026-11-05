# Agent Note: Galgame Story readiness and project completion

Status: implemented

## Problem

The independent Galgame owner did not serve the route report or project status changes. The legacy readiness implementation depended on the shared database and filesystem.

## Decision

Share the pure control-flow and readiness rules. Resolve only the current Story's retained assets and Galgame-owned metadata through the scoped Assets query. A completion write checks the report before opening its write transaction, then verifies that the reviewed Story revision is still current before applying the project CAS.

## Alternatives considered

Checking only the Story schema would allow missing original files, incompatible media or an invalid route graph to pass. Holding the project write lock during an Assets request would block unrelated SQLite writes.

## Consequences

The published report, renaming and completion operations work against the independent owner. Incomplete projects keep the report in the 422 response. A Story edit after completion still resets the project to draft.

## Verification

The signed route test covers project revision conflict, an unfinished route, completion after a valid ending and reopening after a Story write. Existing control-flow, asset package and compatibility tests run against the shared rules.
