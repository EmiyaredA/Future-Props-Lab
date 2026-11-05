# Agent Note: Keep Visual canvas files available across separate saves

Status: implemented

## Problem

A Visual canvas can display files stored directly in its project or placed from the account library. A canvas write may create output history, remove old nodes or carry a prior file after its library placement was removed. Visual and Assets own separate transactions.

## Decision

Visual reuses the canvas update, task validation, output registration and revision rules with an injected Assets check. Identity authorizes a preparation only for the exact Visual project creation or Canvas write. Assets looks up files, placements and prior prepared or committed pins in one transaction. A carried library file can inherit protection from an earlier prepared save even if the earlier source commit acknowledgement has yet to arrive. Unavailable carried IDs can remain in an old document without obtaining a pin or exposing another project's file metadata. A new unavailable ID fails validation.

Visual records the new Canvas version, node outputs and the reference outcome in the same transaction. The owner settles the prepared pins by the same durable delivery protocol as Thought and Galgame. Project creation initializes a separate empty Canvas projection at revision zero. Updating project certification or metadata does not advance the Canvas revision. Canvas operation batches store the original response and request fingerprint in the Visual partition of the edit receipt table in the same source transaction. The published node output list and detail share a Visual-only query that verifies both project ownership and node membership.

## Alternatives considered

- Having Visual read the Assets database would couple file placement and canvas storage and would fail to retain files before an independent write.
- Rejecting every missing carried ID would prevent previously supported edits that leave an existing unavailable reference intact.
- Dropping prospective pins when the current library placement disappears could leave a successful predecessor or successor save without protection.

## Consequences

The installed Visual project creation and Canvas save require Identity and Assets. Historical import must seed and verify Canvas projections, and later Visual operations that mutate Canvas or its outputs must participate in this protocol. The project application keeps its full readiness gate.

## Verification

The isolated HTTP test uses real Identity, Visual and Assets services. It exercises cross-account rejection, rejection of unplaced library files, the actual placement API, source save, placement removal before confirmation, a successive save, preserved output ID and the final file pin. Operation-batch verification repeats the same ID and rejects a different body with that ID. The output read checks cover version identity, pagination and an invalid node. Legacy canvas safety, output version and owner boundary tests cover the compatibility adapter.

Installed acceptance runs Visual with the six existing peer containers. It verifies the same node output ID and asset after removing the library placement, then restores the same versions from isolated snapshots and reads the Canvas and downloaded bytes again.
