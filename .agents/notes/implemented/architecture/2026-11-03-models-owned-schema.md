# Agent Note: Models-owned schema and external identifiers

Status: implemented

## Problem

Inference and transcription ORM metadata still requires account and asset tables to resolve foreign keys. Template-sync and admission records also refer to account/workshop tables. An independent Models database cannot create or write those mappings without recreating other services' schemas.

## Decision

Models ORM describes only locally enforceable relationships. Account IDs and source asset/workshop task IDs are opaque external identifiers, validated by authenticated service interfaces rather than cross-database foreign keys. Move Models-owned admission and template-sync records into LLM-owned model modules. Register a new independent Models migration for the existing owned catalogue, logs, test/inference and governance tables; keep its earlier defaults migration unchanged.

The recovery website continues using its existing database and registered SQL migrations. Its physical historical constraints remain in place; this change does not alter that database, rewrite migration history or remove existing cascading behavior there. New service tables are created only by the independent service registry, without external schemas.

## Alternatives considered

- Creating dummy account/asset tables in Models defeats ownership and makes local integrity misleading.
- Copying the complete database into Models is explicitly excluded by the deployment plan.
- Runtime monkeypatching of metadata or mapper tables creates hidden shared state.

## Verification

Temporary databases validate all 19 owned tables, inference/transcription/admission writes without account/asset/workshop schemas, local-only foreign keys, SQLite integrity, idempotent upgrades and foreign-service rejection. Read-only checks of a freshly migrated recovery database verify the original physical account, asset and workshop foreign keys remain present. Ninety-five targeted schema, architecture, Identity packaging and legacy governance checks pass; the full backend suite passes 2005 tests with four conditional skips. Contract/SDK and Python lint/format checks pass. The new SQL's Python literal formatting preserves its byte value and registered checksum. No runtime data is imported or changed.

## Consequences

Independent Models can resolve and write its mappings without dummy external tables or another service's ORM. Governance record ownership now matches the service manifest and directory gate. The recovery schema remains stricter according to its frozen historical SQL; new service integrity is enforced locally and cross-service access still requires validated interfaces and receipts.

## Risks

Opaque identifiers do not grant access. Models must still use Identity/Assets APIs and durable task/reference receipts. These schema changes do not implement missing business ports or authorize switching formal data.
