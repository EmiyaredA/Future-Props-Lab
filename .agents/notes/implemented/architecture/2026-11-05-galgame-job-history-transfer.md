# Agent Note: Galgame job history transfer

Status: implemented

## Problem

The Galgame historical Story transfer did not include transcription, annotation import, video export or editor handoff records. Those records preserve task progress and the IDs needed to follow the original result.

## Decision

Export the four job datasets through Galgame's loopback maintenance API. Verify the source account and project relationships before importing. Video export and handoff batches also verify the exact frozen Story snapshot and revision at the destination. Persist the original task identifiers, state, errors and cross-service IDs with the batch receipt.

## Alternatives considered

Recreating historical tasks would lose the original results and could restart external jobs. Copying the SQLite tables without the project and asset checks could attach tasks to an unrelated account.

## Consequences

Terminal and interrupted states are preserved as source data. The source validation rejects mismatched referenced files or projects. The imported IDs remain available for cross-service reconciliation after all peer histories are present.

## Verification

The isolated legacy rehearsal carries a failed export and completed editor handoff, checks their retained snapshot and target project IDs, and continues after the project and Story batches have already committed. It verifies exact readback, repeated import and rollback. Related Visual migration and image closure tests pass.
