# Agent Note: Preserve the mainline cloud controls during the service split

Status: implemented

## Problem

Mainline added desktop access, TOTP and project execution after the previous ownership generation. Its browser policies and WebSocket contracts must survive the merge into the service branch.

## Decision

Portal serves the cloud controls page. Identity owns TOTP and session unlock records. The already registered Remote capability owns desktop connections, preferences and the WebSocket. Agents owns workbench conversations and execution. Agent Runtime owns the shared CLI connections. Identity serves the existing TOTP operations and uses its own tables for factors and verified sessions. The generated manifest includes HTTP, WebSocket, data, page roots and per-field TOML ownership.

The compatibility WebSocket authenticator still delegates credential validation to the application. The shared dependency checks the requested permission after authentication. Desktop uses cloud-control access and realtime model tests use model access.

## Alternatives considered

- A new Cloud Control service would duplicate existing account, desktop and workbench authorities.
- Forwarding the complete browser Cookie to Remote would expose its account credential to a business service.
- Retaining the previous CLI grant endpoints would restore authorization semantics that mainline replaced.

## Consequences

The merged contracts identify each remaining deployment dependency. Remote's scoped desktop ticket transport and isolated startup, historical TOTP migration and Agents' execution adapter still have cutover gates. The website continues with the compatibility runtime until those gates are met.

## Verification

Contract tests check ownership for the new HTTP operations, desktop WebSocket, tables and configuration fields. The compatibility tests exercise the account and listener permissions. Generated API, SDK and official Thought package reflect both branches.


The Portal entry binds the account and both Workbench destinations to the updated cloud workspace. CLI enablement requires the trusted local listener, an administrator session and recent password verification. The catalog hides executable paths outside that lane.

Agents owns the chat and turn schema, exact transcript routes and live reauthorized SSE. Interrupted turns become interrupted records on startup, with unknown approval results preserved. Chat creation, starting new turns and approval writes remain unavailable until the Mac execution port is connected. The Compose liveness probe checks process health while the service readiness endpoint reports the execution gate.
