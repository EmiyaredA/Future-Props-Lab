# Agent Note: Retire character workshops and decouple bundled avatars

Status: implemented

## Problem

Live2D and desktop pet editing and runtime are no longer part of the product. Home depended on private pet projects, while Amadeus could depend on a mutable Live2D project. Removing either application without resolving these dependencies broke unrelated entry points.

## Decision

Remove both applications, their HTTP operations, SDK methods, Electron windows and IPC, tooling, current guides and dedicated tests. Preserve historical migrations and introduce `0118_retire_character_workshops` to drop their eight application tables. Agent Workbench owns the previous Live2D badge. Home plays the user-selected transparent Kurisu idle clip with a static fallback and reduced-motion support. Amadeus keeps its bundled model and the pure rendering code it needs, with no account project lookup.

The user explicitly authorized an exception for this one-time deployment cleanup: stop the application, back up the complete runtime and config, verify integrity, apply the registered migration and purge only the retired applications' private file trees across accounts. This is an offline maintenance operation, not a new API or enduring admin permission. Preserve other data, audit logs, imported thought notes and the backup. Do not restart the live instance automatically.

## Alternatives considered

- Hiding application cards leaves callable APIs, Electron runtime and unused assets.
- A new retirement API creates a permanent capability for a one-time task; the user explicitly declined it.
- Reusing the pet renderer for Home retains the application lifecycle and private data dependency.

## Consequences

Old character projects and pet chats cannot be reopened after migration; recovery requires the stopped full backup and the matching old application version. Current guides and SDK references remove retired operations. Documentation protection reports these explicitly requested product deletions; its policy is not weakened. The source character assets retain the repository's internal handoff rights limitations.

## Verification

Migration regression covers populated accounts, chat children, repeat application, unchanged other tables and user records, migration history, foreign keys and integrity. HTTP regression checks removed routes return 404. Home tests cover media failure, page visibility and changing reduced-motion preferences. Existing Amadeus pose and rendering checks remain independent of workshop APIs. Offline cleanup is validated against isolated directories before the formal deployment is touched.

The formal instance was stopped through its existing unsaved-change guard and a complete backup passed checksum, SQLite integrity and foreign-key checks. Automatic approval rejected executing the offline destructive cleanup because of the persistent-data restriction; this task has not run the formal migration or file purge. A later read-only check found another development launcher holding the formal data locks; this task does not interrupt that separate workflow. The rejection is not bypassed by starting the new application version.
