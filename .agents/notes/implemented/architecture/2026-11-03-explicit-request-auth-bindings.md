# Agent Note: Request authentication and database bindings

Status: implemented

## Problem

Business routes importing the shared dependency module initialize the old database and account ORM even if a service later overrides the session dependency. This leaves independent route assembly coupled to the monolith's configuration and persistence before any request arrives.

## Decision

Each ASGI assembly explicitly provides its own database session factory. Identity and the recovery website additionally install their account-database authentication adapters. Other business services consume only verified signed actors. The shared route dependency module holds no account queries or global session factory. Account credential validation stays in console governance, while storage-free protocol preconditions remain in the Identity capability, preserving Cookie precedence, CSRF, session purpose, role and key revocation behavior. WebSocket authentication requires an explicit installed adapter and otherwise fails closed.

## Alternatives considered

- Dependency overrides occur after imports, so they do not prevent legacy initialization.
- Replacing imported modules or global session factories at runtime creates implicit mutable dependencies.
- Copying the full account schema into every service violates independent ownership.

## Verification

Fresh-process dependency imports load neither account ORM nor the old database. Independent app tests demonstrate separate session factories and owners; unbound business requests cannot fall back to browser cookies or socket authentication. Identity's source closure now rejects the old database factory. Sixty-five focused architecture/website/binding/packaging checks pass, including original login, forced password changes, CSRF, API Key allowlist and trusted listeners. The final full backend run passes 1997 tests with four conditional skips. Contract/SDK, Python lint/format and note checks pass. The seven-container run `fpl-isolated-agents-1b8b3e9f7c` verifies the final Identity image, independent Portal stop/recovery, login, native synchronization, media/file operations and responsive browser themes.

## Consequences

Database credential checks belong to console governance, and storage-free HTTP preconditions remain in the Identity capability. This preserves the existing dependency direction instead of exempting the new file from architecture rules. Recovery website test assemblies install the same explicit bindings as the actual website; missing bindings never select a global database implicitly.

## Risks

The recovery website and Identity must install the database-auth callbacks before serving requests. Missing bindings fail closed. Signed WebSocket ingress and remaining business execution ports are separate requirements; this change does not grant browser cookies or host authority to a service.
