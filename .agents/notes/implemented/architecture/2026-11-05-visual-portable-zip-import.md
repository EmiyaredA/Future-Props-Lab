# Agent Note: Visual portable ZIP import

Status: implemented

## Problem

The published Visual ZIP import creates a new project and remaps nested file folders, Canvas identities, historical outputs and review references. The independent Visual database cannot commit the Assets originals or read the model catalog directly.

## Decision

Reuse the compatible snapshot parser and portable values. Models resolves account-owned enabled provider and slug pairs. Assets verifies and stages originals under a digest-bound grant. Visual validates and freezes the remapped records, then persists its decision. Assets applies the ordered folders, original metadata and initial Canvas and review pins in a single transaction. A signed settlement receipt permits Visual to publish the exact frozen graph. The worker can replay a committed decision and abort an interrupted staging attempt.

## Alternatives considered

Publishing the Visual project as soon as the ZIP parsed would expose dangling asset references if file publication failed. Deriving provider identities inside Visual would require direct catalog access and duplicate the owner resolution rule.

## Consequences

This adds an isolated Visual decision table and two isolated Assets staging tables. The existing ZIP upload and its copy semantics remain unchanged. A second completed import of the same ZIP intentionally creates another copy. The isolated Compose overlay provides an independent Visual-to-Assets archive credential.

## Verification

Focused tests cover exact ZIP roundtrip, nested layout, fresh project identities, enabled model resolution, historical review bindings, and replay of a lost publication receipt. Legacy snapshot, acceptance and transparent GIF tests ran against isolated fixtures. Six-service Compose rehearsal fpl-visual-snapshot-import-4f2689a367 compared original hashes, nested layout, GIF inspection versions, model and review bindings after re-export and restart, with Chromium also exercising the Visual application.
