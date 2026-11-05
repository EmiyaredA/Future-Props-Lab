# Agent Note: Galgame portrait upgrade

Status: implemented

## Problem

The independent Galgame project could restore an existing maintenance snapshot, but the published portrait-height preview and upgrade still used the compatibility site.

## Decision

Share the height calculation and document edits between deployments. Preview reads metadata for the same owned project. Apply compares the expected Story revision and uses the existing Story write and Assets retention protocol. The prior Story snapshot, updated Story and local retention outcome commit together.

## Alternatives considered

Writing the snapshot in a separate request would allow a concurrent edit to split the snapshot from the Story revision it describes. Reimplementing Story saves for portrait maintenance would bypass the reference ledger.

## Consequences

The browser keeps the published preview, upgrade and restoration paths. Stale upgrades leave the snapshot history unchanged.

## Verification

Directed tests use a project portrait with known dimensions, compare the preview and applied height, reject a stale upgrade, then restore the one recorded snapshot. The four-service Compose and Chromium rehearsal verifies an upgrade, snapshot, file replacement, exact file download, responsive entry and persisted Story after restart.
