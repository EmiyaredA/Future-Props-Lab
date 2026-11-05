# Agent Note: Visual project deletion with Assets settlement

Status: implemented

## Problem

Visual and Assets hold separate databases. Removing a project must release its Canvas and conversation references, remove its private originals and file hierarchy, and preserve independent library files and references.

## Decision

Visual checks the project revision and the Canvas version, collects its conversation IDs, and asks Assets to prepare deletion through a grant tied to the published project DELETE. Assets checks the Canvas projection, unsettled child references and independent consumers of the project's originals. Its prepared intent fences new Canvas and conversation references and project file publication. Visual then checks the same Canvas and child scope under its write lock, clears restrictive acceptance records, and commits the project deletion with the durable decision. Assets applies that decision once, clears pins and placements, and schedules original file cleanup in its own transaction. A failed source CAS records an abort. Delivery can retry a committed result after restart or a missing reply.

## Alternatives considered

Deleting the project first and sending a best-effort cleanup would leave a window for new consumers and allow undiscoverable orphaned files. Synchronously deleting files before the source CAS would make concurrent project edits unrecoverable.

## Consequences

A project with active generation, acceptance, conversation work, a reserved segment handoff, or an external original consumer remains visible and returns a conflict. A library original can still be downloaded after its project placement is removed. Project upload staging occurs outside the Assets write lock, then revalidates the scope before publishing the row.

## Verification

The signed Visual, Identity and Assets regression covers revision conflict, a separate history pin, a file upload attempting to publish during preparation, loss of the committed acknowledgement, idempotent delivery, preservation of the library original and durable file cleanup. The file placement, Canvas reference and Video segment handoff suites exercise neighboring paths.
