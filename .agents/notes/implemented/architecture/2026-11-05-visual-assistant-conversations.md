# Agent Note: Visual assistant conversations

Status: implemented

## Problem

Visual's public conversation and model option endpoints used the compatibility site's shared database for conversation records, model catalog entries and linked attachments.

## Decision

Visual holds the conversations, messages and actions. Models answers an exact delegated request with account-scoped model options, allowed generation IDs and labels. Assets returns metadata for the requested IDs in the conversation's committed or prepared retention projection. The request binds both the project and conversation and a digest of the IDs. Conversation create and delete persist the source change with its Assets outcome. Model changes and titles retain the existing revision and pending-message rules.

## Alternatives considered

Replicating the Models and Assets catalogs would make permission changes and provider edits dependent on synchronization. Sending model credentials or file paths would widen the cross-service interface.

## Consequences

The six conversation management operations retain their public shape. Historical attachments require their retention projection to be imported along with the conversation. Model execution and the approval stream remain separate operations.

## Verification

Directed tests cover published OpenAPI equality, current account options, foreign scopes, digest tampering, historical messages, attachment and action serialization, stale writes, and deletion receipt settlement. The compatibility site's assistant tests verify the shared formatting and catalog rules.
