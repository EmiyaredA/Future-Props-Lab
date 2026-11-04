# Agent Note: Run Director projects, bytes and editor sessions in one independent owner

Status: implemented

## Problem

The Director Desk project and motion records, content-addressed files and open-editor tool bridge previously ran in the compatibility application. Their storage and transient session lifetimes must follow the same Director process.

## Decision

Both deployments use the existing Director router. The compatibility app supplies its own session factory and filesystem layout. The Director image supplies an owned SQLite database and its private file tree, checks the published operation contract and optionally serves the matching browser program. The editor broker is scoped to the application instance and uses its supplied database session factory for ownership checks.

Project deletion takes a short writer lock before moving files to trash. Project uploads stage bytes outside the project directory and check the project again under the writer lock before publishing. The Director process reconciles interrupted deletes on startup by checking the owning project record. Motion writes and unused library file cleanup serialize their reference checks.

## Alternatives considered

- Copying the compatibility API would create two implementations of the editor protocol.
- Mounting the compatibility storage root would widen the Director container's access beyond its own files.
- Keeping process-global editor sessions would share state across unrelated application instances in tests and recovery.

## Consequences

The Director service owns both project and motion tables and all associated raw files. An editor reconnects after service restart. Project records, motion data and committed files persist. The browser entry uses the existing editor and account context. Historical transfer and full-stack acceptance remain readiness requirements.

## Verification

The owned app hashes all 18 published operations. Tests cover cross-account access, file upload and readback, revision conflict, motion library state, editor polling and replay, and recovery of a project file tree staged before an interrupted delete. The compatibility routes also pass their existing tests.

The installed three-container run verifies the 390px project list, WebGL deep link and editor initialization save, stale browser build rejection, anonymous public-lane protection and file persistence after Director restart. A paused upload also proves that project deletion cannot be followed by a late publication that recreates its directory.
