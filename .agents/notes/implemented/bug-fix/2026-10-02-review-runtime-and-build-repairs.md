# Agent Note: Review runtime and build repairs

Status: implemented

## Problem

Outdated asset digests and incomplete editor fixtures blocked builds. Concurrent timeline writes reused a revision, while provider error frames and premature EOF appeared successful. Project file selection omitted folders and lost selections on filtering. Desktop Agent access omitted the existing Skill Markdown read operation.

## Decision

TimelineSaveQueue owns a project's serialized writes, successful undo/redo history and retained failed intents. State-dependent builders run against committed snapshots; inverse templates capture current before-values. Transform field edits merge only the explicitly edited field into the preceding saved clip. Failures pause subsequent intents and request a server refresh. Explicit discard clears retained intents and obsolete history; uncertain writes are never replayed automatically. Navigation waits for successful saves or requires explicit discard. Disposed queues ignore late callbacks.

Provider adapters parse complete SSE frames, reject sanitized error events and require terminal signals. OpenAI-compatible streams accept a finish reason or DONE; Anthropic requires message_stop. Public event shapes remain unchanged and partial text is recorded with error status. File selectors reuse folder/list APIs and preserve selection snapshots. Desktop access adds only the existing Skill Markdown read route.

Verified LFS OIDs replace obsolete digests. The incomplete Pi snapshot removes unused Node execution exports, with source-coverage tests. Browser motion data loads as a same-origin asset while offline execution retains embedded JSON and digest validation. Three core, renderer and examples follow their owning modules; mutually dependent director resource/automation modules share one chunk. Existing bundle budgets are unchanged. Identical expression-control CSS uses equal-specificity selector grouping. Browser screenshots use the isolated Playwright output directory. Formatting and fixture repairs preserve registered migration SQL. Director scene sampling is separated from resource lifecycle; workspace, timeline and responsive CSS retain the original cascade order and meet file budgets.

## Alternatives considered

Disabling every editor action during a request loses rapid input and leaves alternate entrypoints unprotected. Retrying uncertain writes risks repeating accepted operations. Cross-folder search would expand the public API; folder navigation satisfies the selected interaction.

## Consequences

Failed edits remain in the current editor's memory until explicit discard or window closure. Discard resets undo history because its before-values may not match refreshed state. Provider raw errors are not exposed. Existing official knowledge library work is preserved and the relevant guides describe these behaviors.

## Verification

Deterministic provider/API tests cover error frames, partial output, premature EOF and failed durable logs. Queue and inspector tests cover revision sequencing, undo/redo, retention, discard, isolation and different transform fields queued from one render. File picker tests cover nested navigation, preserved selections, project changes, retry and keyboard navigation. Desktop SDK checks use temporary data and read-only credentials, including Skill Markdown through the actual Unix gateway. Five production-preview browser journeys cover director renderer initialization, folders, narrow layouts, queued writes, real CAS conflicts, vertical dragging and deterministic editing/export. Full backend tests, standalone SDK workflows, desktop checks and the quality gates are executed; the task response records final counts and limits.
