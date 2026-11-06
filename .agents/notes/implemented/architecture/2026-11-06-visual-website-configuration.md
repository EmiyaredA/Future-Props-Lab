# Agent Note: Bind Visual website configuration

Status: implemented

## Problem

Website generation, assistant tools, and acceptance could read process-global
settings even when their SQL sessions belonged to a different website instance.
Generation capabilities, acceptance availability, and file readability could
therefore disagree with the configuration of the serving website.

## Decision

The website HTTP boundary supplies settings to Visual generation, conversations,
and acceptance. The assistant stream binds the same settings used to prepare
the conversation to its generation tool handlers. Node acceptance binds the
scheme catalogue and a configured asset store to the shared node records.
Run signatures and sampling use the same application configuration.

## Alternatives considered

Keeping an optional global fallback would let unconfigured callers silently
select the wrong account storage root. Binding dependencies through the SQL
session would obscure the configuration needed by asynchronous tool handlers.

## Consequences

Constructors and tool factories require explicit configuration. Independent
Visual continues using its existing service ports. Public HTTP shapes, task
receipts, and persisted records are preserved.

## Verification

Two independently assembled website instances exercise distinct generation
upload policies and acceptance schemes through real account sessions. Each
resolves its own uploaded material in node acceptance, and cross-instance
project access returns 404. The component architecture guard covers the entire
Visual package.
