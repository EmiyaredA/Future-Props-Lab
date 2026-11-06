# Agent Note: Use a short private path for the native CLI tool socket

Status: implemented

## Problem

A long TMPDIR could make the run-owned Unix socket exceed the macOS path
limit. Claude Code and other relay clients would fail before the run
emitted an event.

## Decision

Place the socket in a unique, mode 0700 directory under the short
system path /tmp. Keep the per-run token, socket permissions and cleanup.

## Alternatives considered

Using the caller's temporary directory for the socket makes its address
length depend on the project and test environment.

## Consequences

Only the short-lived socket directory uses the fixed system location.
The existing run owns its connection, tool grants and cleanup lifecycle.

## Verification

The existing Claude Code end-to-end regression executes the native tool
relay with a deliberately long default temporary directory.
