# Agent Note: Galgame project file edits

Status: implemented

## Problem

Galgame owned the virtual path and packaging metadata, while Assets owned the original file revision and display name. The published edit and delete operations needed one versioned outcome across those services.

## Decision

Use the existing durable reference ledger for exact Galgame file mutations. Assets verifies the project and file revision and reserves the original. Galgame validates and commits its metadata change with the source receipt. Assets advances the original revision or deletes the file after receiving the committed result. Pending delete reservations prevent new file references.

## Alternatives considered

Editing both services independently would allow a path or label to change without the other side's revision advancing. Removing files before the source commits could break Story history after a conflict.

## Consequences

The original operations keep their paths, file revisions and current-value conflicts. Files used by a current Story or saved snapshot remain protected. A lost reply is reconciled through the original receipt.

## Verification

Signed tests cover a virtual path collision, a lost rename acknowledgement followed by a current-value conflict, retained digest and packaging policy, blocked Story file removal and successful removal of an unreferenced file.
