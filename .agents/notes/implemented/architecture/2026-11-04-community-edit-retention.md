# Agent Note: Retain community document assets under the source account

Status: implemented

## Problem

A community editor can update an article owned by another account. The editor still has their own live browser session, while the document, history and file pins belong to the author. Independent services need to keep these identities separate even when a permission changes during preparation.

## Decision

Thought validates the community role and the files and notes visible through the article. Identity signs a retention capability for the original browser request and exact source revision, with the editor and source owner in separate fields. Assets validates and prepares the owner's existing reference set, returning metadata only for the submitted document's permitted files. The source rechecks the live browser and publication permissions before its compare-and-swap transaction, then commits the document and reference outcome together.

## Alternatives considered

- Issuing an assertion as the source owner would give the editor unrelated account access and lose the editor's audit identity.
- Returning metadata for all retained pins would expose historical and unrelated files to the edit path.
- Committing the document before preparing pins would allow the asset deletion transaction to remove files during the edit.

## Consequences

A permission change before the source write produces an abort outcome. The existing reference worker can settle the exact intent after the browser session ends. Previously signed private account authorizations retain their original digest.

## Verification

The isolated HTTP scenario grants and revokes an editor role, verifies that the source owner retains the resulting note and asset references, rejects a hidden file, and checks the original revision when permission is revoked after remote preparation.
