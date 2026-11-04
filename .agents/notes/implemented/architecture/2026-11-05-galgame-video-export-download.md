# Agent Note: Galgame video export downloads

Status: implemented

## Problem

The existing Galgame video export URL depended on shared file storage to read the original artifact.

## Decision

Read the output asset ID from the owned export task, then request a signed grant bound to the exact project and export URL. Assets checks the current account and Galgame project scope and serves the original file. The Galgame proxy streams the bytes and forwards the range, length and attachment headers.

## Alternatives considered

Returning a redirect would change the public download journey. Passing arbitrary file IDs from the browser would give the download endpoint authority outside the saved export.

## Consequences

Saved video downloads keep their public URL and support seeking and resumable ranges. Files from another project remain inaccessible even when that project belongs to the same account.

## Verification

The signed mesh test checks exact bytes, attachment name, 206 and 416 responses, private cache policy and same-account cross-project rejection. Published OpenAPI equality covers the preserved route.
