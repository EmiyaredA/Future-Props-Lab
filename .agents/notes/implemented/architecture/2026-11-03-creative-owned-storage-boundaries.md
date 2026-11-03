# Agent Note: Creative owned storage and explicit service ports

Status: implemented

## Problem

Creative catalogue operations implicitly query the Identity user table and assume integrations share a database. Three owned tables cannot be independently migrated while requiring Identity foreign keys. Public catalogue records use `origin_owner_user_id` and need write protection without hiding other authors’ published items.

Creative uploads compared a loaded revision without a database CAS. Upload and publish cleanup could delete files after the database committed but its response was lost. Following symlinks while publishing a Skill could expose files outside its owned draft.

## Decision

The independent Creative migration owns item, release and installation tables. Account identifiers are opaque; only owned relationships retain foreign keys. The recovery database keeps its original registered SQL and physical Identity foreign keys. The Creative service session allows public catalogue reads and binds item/release writes to the origin account; it refuses unscoped writes, unchecked bulk insertion and owner or release-parent changes. Installations retain the standard account-scoped guard. Public read visibility remains an explicit Creative use-case rule.

Creative receives author display, integration source snapshots, Skill archive parsing and installation through explicit ports. The recovery site alone injects existing database adapters. Source values contain no foreign paths; a Skill is exported as bounded ZIP bytes and checksum, verified, safely parsed into Creative-owned staging and saved as a Creative-owned draft. Other account integrations are absent. ZIP extraction and raster previews avoid importing other services’ ORM into Creative HTTP modules.

Cover and Skill uploads stage outside the write transaction, then use root-owner and revision CAS. Confirmed pre-commit failures remove staged files; once commit begins, an unknown response retains possible committed bytes. Skill publication checks CAS before inserting its release and keeps possible committed release files. File resolution and Skill publication reject parent traversal and symlinks including directory links.

The independent browser entry keeps existing paths and account permissions; its selectors use the shared keyboard-operable control. Editing registers the shared unsaved navigation guard; on the recovery site it explicitly adapts the existing App guard, while a standalone shell uses its own protection context. Only one guard registers when both are supplied.

## Alternatives considered

- Ordinary account filtering on public items would hide other authors’ published catalogue items.
- A copy of Identity users or Integration tables in Creative breaks service ownership.
- Deleting files on every exception loses committed data when only the database response is lost.
- Comparing a previously loaded revision cannot prevent concurrent uploads.
- Persisting an Integration-owned Skill directory path couples Creative drafts to foreign storage and deletion.

## Consequences

The three-table schema, service-specific session and route modules can load without Identity, Integrations or Assets ORM. Creative is not yet independently deployable: the author port needs a scoped Identity HTTP implementation; source and installation ports need authenticated target protocols, durable operation receipts and cancellation recovery; project certification must be owned by its source app. Retained orphan files also require reconciliation. Formal data and configuration remain untouched.

## Verification

Isolated tests exercise migration replay and wrong-service rejection, owned foreign keys, account-bound ORM/bulk writes, private installation visibility, fresh-process creation with no foreign ORM, upload CAS, commit reply loss for cover/Skill/publish, owned Skill snapshots after source removal, source digest mismatch and directory symlink rejection. Existing recovery catalogue and installation journeys pass. Frontend tests cover five existing route shapes, permission gating, keyboard select operation and unsaved navigation protection in both entry points without duplicate dialogs.
