# Agent Note: Visual portable ZIP export

Status: implemented

## Problem

The Visual project archive previously read its Canvas, outputs, reviews, file library and model catalog from one SQLite database. The independent project owner needs the existing archive shape with complete original files and without direct access to Assets or Models data.

## Decision

Freeze owned Visual rows in a read snapshot, end the database transaction, and request versioned original metadata from Assets. The exact file set is bound to a digest and project-scoped grant. Assets includes project originals and referenced library originals retained by the Canvas or acceptance projection, preserving the placement folder when present. Models returns portable provider kind and slug for model IDs owned by the actor. Recheck authorization before downloading the archive and clean temporary copies after response or recovery.

## Alternatives considered

A cross-service filesystem mount would make original reads depend on Assets internals and bypass the account, placement and revision checks.

## Consequences

The published Visual ZIP path and manifest remain compatible with the existing format. Missing or changed originals block export. A retained library file without a project placement is exported at the project root. The export stages bounded original bytes and an output ZIP in Visual.

## Verification

Focused independent-owner tests exercise nested folders, preserved outputs and acceptance bindings, portable model labels, archive SHA256 and cross-project denial.
 The six-service Compose and Chromium rehearsal verified the same archive structure and exact file hashes after restart, including both GIF output versions.
