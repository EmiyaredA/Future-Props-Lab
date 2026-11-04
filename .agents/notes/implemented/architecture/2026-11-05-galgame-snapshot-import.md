# Agent Note: Restore portable Galgame snapshots through Assets

Status: implemented

## Problem

The portable project import has to preserve Story references and file metadata while Galgame and Assets store their own state independently.

## Decision

Reuse the compatibility ZIP validator and remap all source file IDs to new originals staged in Assets. Galgame resolves the optional model binding in the current account through Models. The exact archive digest and Story file ordinals are sealed in Assets. Galgame commits the publication decision before sending it to Assets, where files and initial Story pins are committed together. Galgame then publishes the copied project and metadata in its own transaction.

## Alternatives considered

Inserting files directly into the Assets database would bypass owner validation. Publishing the project before the Assets outcome would expose unavailable files after a restart.

## Consequences

The published import still creates a separate copy. A stopped service can deliver the saved decision and publish the copy without a second set of files. Imports with unknown or unavailable model bindings preserve the existing warning. The Galgame snapshot Compose overlay mounts one archive-only key into Galgame and Assets.

## Verification

Eighty-five focused checks include the original ZIP contract, provider binding scope, revoked grants, exact file IDs and a lost Assets publication reply. Six isolated containers and Chromium completed the ZIP round trip through Gateway. The restored copy had new file IDs, byte-for-byte SHA-256 matches and a ready Story report before and after restart.
