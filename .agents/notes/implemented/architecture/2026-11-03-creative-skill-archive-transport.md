# Agent Note: Build Creative Skill transport archives from published files

Status: implemented

## Problem

A published Skill is stored as extracted files, while an independent Integrations service requires a bounded ZIP stream and an immutable transfer descriptor. The original uploaded ZIP is not retained and its byte digest cannot be reused for a newly generated archive.

## Decision

Creative builds a private install batch from currently published releases and resolves every Skill to the originating account's exact release directory. A packer writes a sorted ZIP with fixed timestamps and attributes to a private anonymous temporary file, checks file count, expanded and ZIP size limits, verifies the tree before and after packing, and derives a transfer SHA-256 and tree SHA-256. The sender reopens the published release and rebuilds the archive, requiring the complete descriptor to match the persisted batch. Integrations verifies both the transport digest and extracted tree before installing.

Packing runs outside database write transactions and in a worker thread. Temporary files close on success, failure and completion of a cancelled worker. The source outbox and target authority revalidate the current release and publication fence before an installation can commit.

## Alternatives considered

- Reusing the old upload SHA-256 for a new ZIP confuses original transport bytes with published file contents.
- Sending an arbitrary caller-provided archive would let the caller substitute content.
- Keeping temporary source files after a failed attempt without an authenticated result would create untracked storage and weaken recovery.

## Consequences

The current format uses uncompressed ZIP entries to avoid compressor-dependent output. It can reject a previously valid compressed Skill whose expanded files exceed the target's archive-size limit, and a bundle can exceed the target request-size limit. ZIP writer compatibility across future Python changes is not yet a versioned on-disk contract. Large/archive-compatible transfer and durable cross-version retry remain required before production cutover. This provider and batch builder are explicit ports and are not wired to a production Creative service or gateway. No real user data or published asset is modified by tests.

## Verification

Temporary-directory tests verify reproducible output despite file timestamp changes, archive and expanded size limits, account-scoped paths, symbolic-link rejection, changed published files, and cancellation cleanup. An isolated pair of actual Creative and Integrations ASGI routes, separate databases, signed request evidence and authenticated target result transport installs a Skill and verifies the final target file bytes. No live provider, persistent database or production credential is used.
