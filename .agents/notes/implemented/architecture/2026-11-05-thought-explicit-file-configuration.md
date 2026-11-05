# Agent Note: Thought explicit file configuration

Status: implemented

## Problem

Thought website uploads, archives and community files selected the process-global configuration.
The compatibility metadata adapter independently constructed its storage from global settings, so
an isolated application could query one database and read files from another configured root.

## Decision

The website protocol supplies its own application settings for upload, archive and community file
operations. Community file adapters retain those settings. Metadata reads receive an explicit file
storage adapter from assembly, retaining owner, revision and file existence checks before copying.
A package-wide architecture check forbids global configuration getters in Thought.

## Alternatives considered

- Resetting global settings between applications retains shared mutable configuration.
- Passing a root path from browser requests would change the trusted storage boundary.
- Keeping a default storage constructor would conceal missing assembly.

## Consequences

Public paths, permission rules, data layout and ciphertext remain unchanged. Metadata tests can use
a separately configured isolated store. Session-based service discovery is still present and requires
a separate migration; this batch does not claim that dependency injection is fully complete.

## Verification

151 isolated Thought, community and architecture cases pass. The added metadata case reads the
injected store and rejects foreign owners and changed revisions without creating output files.
OpenAPI and service ownership stale checks preserve existing external contracts.
