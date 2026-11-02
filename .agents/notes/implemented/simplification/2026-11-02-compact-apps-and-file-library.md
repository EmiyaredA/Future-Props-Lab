# Agent Note: Compact applications and file library

Status: implemented

## Problem

Application cards reserve a dedicated call-to-action row, folders share large media card rows, and the file page repeats its heading above the browser toolbar. The homepage also duplicates section navigation immediately above the same sections.

## Decision

Remove the homepage jump strip and put file upload in the independently collapsible section header. Application cards retain complete icons, one-line descriptions and two visible tags; filtering still uses every capability. File management owns a scoped compact stylesheet: folder and media collections use separate grid rows and share compact list rows. Library upload and create-folder remain primary actions; Radix provides the secondary operations menu. The file page explicitly passes its local-directory operation into that menu. Existing preview, upload, cache ownership, migration and project-picker contracts remain intact.

## Alternatives considered

Merely lowering minimum heights retains the empty CTA/footer regions and forces small folders to match thumbnail rows. Applying compact rules globally would also shrink editor asset pickers, which have different interaction requirements.

## Consequences

Desktop application cards are 96px, folders 72px, media cards 132px and list rows 48px. Narrow screens use 56px list rows and 44px action targets. Secondary file operations require opening a menu; they retain their existing handlers. No HTTP, persistence or permission changes are introduced.

## Verification

36 component tests and seven browser journeys pass, including measured density at 1440, 1280 and 390px in both themes, menu keyboard focus, previews, upload and shared cache refresh. TypeScript and ESLint pass. Screenshots capture the application, file grid/list and homepage sections. Formal deployment retains the running server's existing file-preview contract because the separate file-preview API work is not active in that server.
