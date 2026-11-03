# Agent Note: Bind Creative Skill installs to published file trees

Status: implemented

## Problem

Creative stores published Skill files as an extracted directory, while the existing `content_sha256` identifies the original uploaded ZIP. A later transport ZIP can have different compression, member order or timestamps, so comparing its byte hash to that old value cannot establish that its files are the published files.

## Decision

The private Skill installation descriptor adds an optional, versioned canonical file-tree SHA-256. The algorithm hashes sorted UTF-8 relative paths, file sizes and individual file hashes with a domain prefix; it ignores ZIP metadata, rejects symlinks, special files, ambiguous case-folded paths and configured size/count overflows. Creative verifies the requested digest from the exact release directory of its originating account before initially recording an install intent and again before first submission. File hashing runs outside database transactions, and the publication and source path are rechecked before the source transaction commits. Integrations independently hashes the extracted archive and requires the same digest before applying it. The archive byte hash remains a separate transfer-integrity check.

Historical descriptors without a tree digest preserve their original serialized form, allowing an already committed receipt to be recovered. A new Skill installation without a digest fails closed. An existing outbox intent can still be recovered after source withdrawal or loss; that does not authorize a new target application.

## Alternatives considered

- Comparing the original ZIP digest to a repacked archive rejects equivalent file trees and cannot verify releases for which only extracted files remain.
- Trusting a digest supplied by a caller would let the caller substitute different files.
- Requiring the source file to remain available before retrieving a previously committed target receipt would break recovery after withdrawal.

## Consequences

These checks are building blocks; they do not constitute a production authorization boundary. The target must obtain a trusted, current publication decision bound to the exact batch, and source changes can occur after a source-side check. The private HTTP endpoint remains fail-closed without its Identity-backed authorization, and Creative has no completed service entry or production transport. No existing public API or registered migration changes. Older unresolved Skill intents cannot be newly applied without a new trusted proof, although an existing matching receipt remains recoverable.

## Verification

Isolated tests compare different ZIP compression and member order, reject changes to file paths and bytes, enforce limits and symlink rejection, reject mismatched target contents, and exercise source-account release lookup, tampered source data, missing verifier configuration and pending-intent replay. Creative gateway, source outbox, target installation and service-contract regression tests run without real data or credentials.
