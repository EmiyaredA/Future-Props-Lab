# Agent Note: Give Motion an independent document and edit receipt store

Status: implemented

## Problem

Motion project creation, edits and asset validation relied on shared project paths and the combined database. A separate project process needs ownership checks and durable edit replay without direct access to Assets records.

## Decision

Motion owns projects, documents and edit batch receipts. Compatibility injects its existing directory and project-file adapter. The standalone service commits project creation locally. Editing obtains an Identity delegation bound to the exact project and canonical asset ID query. Assets validates the account and Motion project scope and returns the file media types.

## Alternatives considered

- Sharing the Assets database or its directory would bypass ownership and deployment boundaries.
- Accepting arbitrary account library files as direct layer references would change existing project-file semantics.

## Consequences

The installed image mounts six project and document operations. Remaining file operations, deletion, rendering and video handoff continue under the closed readiness gate.

## Verification

The signed in-process test covers same-project acceptance, other-scope denial, revision conflicts, another account and replay after restart. The four-container acceptance checks the installed ingress, scope rejection and the exact saved edit after restarting Motion.

The five published file operations use request-bound Assets grants. Source discovery and project lists follow the original scope. Uploads bind the raw SHA256 and byte count. Copy requests bind the canonical source ID set. Assets saves each exact receipt in the same transaction as its new project files. Reads preserve byte ranges and close the upstream stream when the download ends. Installed validation exercises an original upload, account-library copy, byte range and document save.
