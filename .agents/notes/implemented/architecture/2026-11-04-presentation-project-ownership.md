# Agent Note: Give Presentation its own project and reference outcomes

Status: implemented

## Problem

Presentation saved document revisions and library file references in the compatibility database. An independent document service needs to validate media, protect references across transactions, and preserve operation replay after restart.

## Decision

The standalone owner mounts the six published project and editing operations with the shared Presentation use cases. It stores projects, template identities, operation receipts and reference outcomes in its own SQLite database. The compatibility assembler binds its existing file library behavior. Independent writes ask Identity for bounded, signed library queries and exact-version SVG bytes. Assets prepares reference pins before the source CAS transaction. The source transaction records the document and outcome together. Delivery retries the exact Assets settlement.

## Alternatives considered

- Mounting the shared file directory would bypass file ownership and revision checks.
- Updating a reference projection after an uncoordinated document write would allow a concurrent delete to remove an in-use file.

## Consequences

Assets accepts library media only. SVG recoloring uses the existing validator. Project deletion releases the reference after the source revision commits. The partial image keeps the production readiness probe closed pending the remaining API, browser and historical migration.

## Verification

The isolated Identity, Assets and Presentation test covers the published schema, a scoped SVG original, foreign accounts, revision conflicts, operation replay, file deletion before and after settlement, and recovery after Assets commits but its reply is lost.

The library stores templates and complete examples. A bundle obtains both reference outcomes before opening its source write transaction. Both rows and both committed outcomes are written together. On a known source rollback the service records abort outcomes for the successful preparations. Template apply checks the target revision again inside the project CAS transaction after remote preparation. The isolated test updates the template between those steps and checks that the original document and revision survive.
