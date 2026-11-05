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

Export preview, JSON, native packages and PPTX use a frozen document revision. Only the two media-producing exports can request non-SVG library bytes. Assets binds each read to the original file revision and checks the library scope. Presentation stages at most 100 MiB of inputs per export under its private state, limits concurrent renders and cleans abandoned staging on restart. The in-process fixture verifies the package contains the canonical SVG and PPTX contains native slide and media parts.

The Presentation browser release mounts the existing project, template and editor routes. Its immutable program manifest includes the starter artwork used during template creation, and the same components resolve those files through the active Vite base. Chromium opens list, template library and document canvas at 390, 768 and 1440 pixels and saves a template through the installed release.

File import uses private archive staging. Assets validates media bytes and reserves existing library references when sealing one project manifest. Presentation persists its document and commit decision before asking Assets to publish. The normal project APIs expose the document only after the exact Assets receipt, in the same local transaction that records completion. A stopped process releases abandoned staging and replays confirmed decisions. The protocol has a distinct peer key and decision domain. The archive staging and recovery primitives remain shared with Thought while each service keeps its own records and projection rules.


Historical migration copies project, template and example rows without rewriting their versioned JSON. Editing receipt pagination encodes the full request ID losslessly. The sealed source recomputes every asset reference and compares it to the original reference tables. Assets accepts projections only for existing library media with completed blob receipts for the same migration plan. The compatibility rehearsal restores the original website after validating both destination databases and restarting the Assets maintenance process during transfer.
