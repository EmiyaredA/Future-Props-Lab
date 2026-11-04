# Agent Note: Visual output version writes

Status: implemented

## Problem

The standalone Visual service could read output history, but the published add, final selection and delete operations still used the compatibility application's file storage.

## Decision

Share the owning Canvas CAS and output mutations. A media add verifies the new file with Assets, including its current project placement. A deletion prepares the remaining current and historical file set before it commits. Final selection switches between already retained outputs. All independent writes respect the Video segment handoff fence. The versioned Visual browser program includes the provider and Agent marks used by acceptance selectors.

## Alternatives considered

Using a historical pin as permission to add another version would allow files removed from the project to be used again. Deleting an output without settling its reference set would keep unused pins indefinitely.

## Consequences

The original output IDs, sequence numbers, fixed-edge and acceptance protections, and optimistic conflict responses are preserved. Deleting a version releases the file when no remaining Canvas or history reference needs it. The original stays available in the project file catalog.

## Verification

Signed tests exercise current placement, version creation, a stale final selection, history numbering, deletion and the remaining pins. Chromium and an isolated five-service Compose run verify the versioned browser and real image files across restart.
