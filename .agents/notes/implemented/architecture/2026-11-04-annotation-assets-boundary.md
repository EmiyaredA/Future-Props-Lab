# Agent Note: Authorize Annotation audio inputs and project references

Status: implemented

## Problem

Audio annotation previously used the file library model and local file paths in its own project transactions. An independent owner needs bounded access to the account's originals and protection against concurrent deletion.

## Decision

Identity delegates individual metadata query digests and byte reads at one file revision. Assets validates the account and library scope. Listing requests can obtain metadata. Creation, import and segment reads can obtain bounded audio bytes. Retention authorization admits exactly one owned audio source for a new project and ties release to the exact deleted project path.

## Alternatives considered

- Reading the Assets database or mounting its file volume would bypass account and revision checks.
- Keeping a copy of every audio original in Annotation would duplicate the library lifecycle.

## Consequences

Library metadata shape and query normalization are shared with the existing Thought protocol. Annotation receives the display name it needs for the project list. The independent project application consumes these ports and stores its source outcome atomically with the project. It uses a private state-directory spool for the bounded original and derived PCM. Compatibility binds the original file and model use cases. The independent Models execution and historical migration remain cutover requirements.

## Verification

The isolated Identity and Assets fixture confirms scoped delegation, changed queries and versions, rejected browser and cross-account access, and deletion protection before and after the reference is committed. It releases the reference using a signed request for the exact project.

The installed four-container run exercises a real WAV upload, clip generation, stale browser version rejection, process restart and the responsive project and editor entry points.
