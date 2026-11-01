# Agent Note: Retire character workshops and decouple bundled avatars

Status: implemented

## Problem

Live2D and desktop pet editing and runtime are no longer part of the product. Home depended on private pet projects, while Amadeus could depend on a mutable Live2D project. Removing either application without resolving these dependencies broke unrelated entry points.

## Decision

Remove both applications, their HTTP operations, SDK methods, Electron windows and IPC, tooling, current guides and dedicated tests. Preserve historical migrations and introduce `0118_retire_character_workshops` to drop their eight application tables. Agent Workbench owns the previous Live2D badge. Home plays the user-selected transparent Kurisu idle clip with a static fallback and reduced-motion support. Amadeus keeps its bundled model and the pure rendering code it needs, with no account project lookup.

The user explicitly authorized an exception for this one-time deployment cleanup: stop the application, back up the complete runtime and config, verify integrity, apply the registered migration and purge only the retired applications' private file trees across accounts. This is an offline maintenance operation, not a new API or enduring admin permission. Preserve other data, audit logs, imported thought notes and the backup. Do not restart the live instance automatically.

On 2026-11-02 the user renewed this authorization explicitly: “批准这次清理作为仓库规则的一次性例外。先和占用数据锁的任务协调好，停机并重新备份后再清理 Live2D 和桌宠的正式数据，其他数据保留。” The user also explicitly approved sending and receiving coordination messages with the website transition and lock-owning tasks. This exception is limited to the two retired applications; it does not amend the general persistent-data rule or authorize other cleanup. The maintenance loads the frozen, tested `0118` migration from desktop baseline `1c0087b2`, checks every retained table's content and schema, and verifies retained runtime files against a fresh stopped-backup manifest.

## Alternatives considered

- Hiding application cards leaves callable APIs, Electron runtime and unused assets.
- A new retirement API creates a permanent capability for a one-time task; the user explicitly declined it.
- Reusing the pet renderer for Home retains the application lifecycle and private data dependency.

## Consequences

Old character projects and pet chats cannot be reopened after migration; recovery requires the stopped full backup and the matching old application version. Current guides and SDK references remove retired operations. Documentation protection reports these explicitly requested product deletions; its policy is not weakened. The source character assets retain the repository's internal handoff rights limitations.

## Verification

Migration regression covers populated accounts, chat children, repeat application, unchanged other tables and user records, migration history, foreign keys and integrity. HTTP regression checks removed routes return 404. Home tests cover media failure, page visibility and changing reduced-motion preferences. Existing Amadeus pose and rendering checks remain independent of workshop APIs. Offline cleanup is validated against isolated directories before the formal deployment is touched.

The initial formal cleanup was rejected by automatic approval. After the user explicitly renewed the one-time rule exception and cross-thread coordination authorization, the owning task exited normally and both data locks were independently verified free. The approved maintenance then held both locks, made and verified a fresh complete stopped backup, and applied the frozen registered `0118` migration. Four Live2D projects, two pet projects, their child tables and six retired file namespaces are removed. All 140 other database tables, their schema and historical migration records compare unchanged; all 59,603 retained runtime files match the stopped backup, and the configuration bytes and encryption key remain unchanged. Final SQLite integrity and foreign-key checks pass. The locks are independently verified released and this task does not restart an app, backend, website or tunnel. The website transition receives the schema and backup handoff. Local evidence is preserved in `.local/workshop-retirement/approved-cleanup.json`, `formal-state.json` and `approved-handoff.json`.
