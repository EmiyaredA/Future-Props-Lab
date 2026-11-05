# Agent Note: Thought library metadata and version-bound export bytes

Status: implemented

## Problem

Thought validates covers, note attachments, table attachments and template content by querying Assets ORM. Markdown/HTML export resolves Assets storage keys directly. These consumers cannot operate on an independently owned Thought database. Simply replacing each query with HTTP also places network waits after project or template writer reservations.

## Decision

`asset_metadata.py` owns the immutable metadata value and explicit session/request port. The recovery site installs `legacy_asset_metadata.py`; independent consumers never fall back to that adapter. Covers, note references, multitable references and Markdown conversion resolve their ordinary-library metadata through this port. This also consistently excludes Motion project files, alongside the other private project scopes.

`fpl_runtime/thought_assets.py` owns the private protocol. The exact metadata query is bound into its digest-bearing destination path; content requests bind a file ID and immutable revision. Identity checks the original owned Thought operation, current actor and the file-read permission before signing the target request. Assets derives the owner from this assertion, rejects project files, and returns metadata without storage keys, paths or owner parameters. The private routes reject browser Origin/Cookie requests and are absent from public OpenAPI. Metadata requests have a two-MiB request limit.

`fpl_thought/asset_metadata.py` sends these explicit requests without retrying, following redirects or inheriting proxy settings. Markdown/HTML export downloads exact-version bytes to its own short-lived export directory before packaging. Declared length and file revision must match; short, oversized, interrupted or compressed content fails without leaving a partial output or deleting an existing target.

Document creation, template application and subtree duplication prefetch metadata before their writer reservations. One request-local HTTP adapter may reuse the resulting immutable values for at most five seconds; an expired prepared snapshot fails rather than refreshing after a writer has started. The session binding cannot change that request's owner.

## Alternatives considered

- Loading Assets ORM in an independent Thought session violates service ownership even if no writes are made.
- Passing a source owner in a private request grants broader access than the authenticated account and does not prove publication rights.
- Fetching metadata again inside nested create operations unnecessarily waits on the network while SQLite holds its writer reservation.
- Exporting an Assets storage path or mounting the Assets volume couples independent releases to its filesystem and bypasses file authorization.

## Consequences

This is a complete metadata/read/export slice, not a complete Thought deployment. Archives still require explicit staged file-import receipts; uploads, every retention mutation, community source-account file authorization and external-sync runner assembly remain deployment gates. The ordinary-library protocol deliberately cannot serve another account's published files. Community publication, article membership and actual current-body references require their own capability proof; a generic owner parameter is not an acceptable substitute.

Recovery behavior continues through its explicit adapter. Public paths and schemas are unchanged, and formal databases, provider services and persistent configuration are untouched.

## Verification

`tests/test_thought_asset_boundary.py` exercises an actual independently assembled Assets ASGI app and its owned temporary database: metadata owner/digest binding, browser and management-purpose denial, hidden storage details, content revision binding, HTTP export consumer, partial-copy cleanup, preexisting-target preservation, fail-closed missing bindings, actual independent Thought creation with a network-under-writer assertion, and expired snapshots without network refresh.

Existing Thought core/storage/directory, attachment/backup, canvas, knowledge/template and multitable-history tests verify the recovery adapter and retained public behavior. The parent integration batch records the final combined check counts.
