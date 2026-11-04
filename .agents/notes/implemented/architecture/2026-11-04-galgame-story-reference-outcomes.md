# Agent Note: Retain Galgame story files across a source commit

Status: implemented

## Problem

A Story revision can change the set of files it needs. The Galgame process owns the revision, but Assets owns the files and decides whether they can be removed. A lost response or a concurrent save can otherwise leave the Story pointing at a file that Assets can delete.

## Decision

Project creation reserves an empty revision-zero Story projection in Assets. For a Story save, Identity binds the original authorized write to the precise project and the digest of its proposed reference change. Assets validates the account and project scope, prepares pins and returns metadata for the requested current file IDs. Galgame applies the published MIME checks to that receipt. It writes the Story revision, current-file index and outcome ledger entry in one transaction. A background delivery confirms the exact committed revision. Older confirmations and repeated deliveries use the original durable receipt. Source transactions that cannot still commit are recovered as aborts. The reference projection also retains files in existing Story snapshots.

The common preparation and delivery implementation lives in `fpl_runtime`. Thought and Galgame each supply their own ledger model, error mapping and use cases. Galgame uses a separate Story resource version so project certification and metadata edits do not advance the file projection.

## Alternatives considered

- Replacing the committed projection before the local CAS could release files still referenced by a successful competing edit.
- Using the project root revision would couple file retention to changes such as certification that do not touch Story content.
- Fetching file metadata independently and preparing pins later would leave a gap in which deletion could succeed.

## Consequences

Galgame project creation and Story writes require the private Identity and Assets endpoints. Historic Story revisions need their reference projection built and checked during historical import. The Story editor's remaining mutations must use the same protocol before public readiness can pass.

## Verification

The isolated service test exercises public creation and Story save against real Identity and Assets routes. It covers asset ownership, exact source binding, revision conflict, lost commit acknowledgement and projection confirmation after Galgame restarts. Existing Thought retention, public Galgame and legacy story workflow tests cover the shared implementation and the compatibility path.

Installed verification adds Assets to the six-service certification stack. It uploads a PNG, saves the Story, downloads the exact bytes and verifies the same Story and file after an offline snapshot restore. The image execution checks that the local file lookup can be inserted without loading Assets ORM metadata.
