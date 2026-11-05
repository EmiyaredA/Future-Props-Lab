# Agent Note: Visual provider plans in Models

Status: implemented

## Problem

Visual task creation must preserve provider admission, input snapshots and unknown submission outcomes across process boundaries. Provider credentials and execution quotas belong to Models.

## Decision

The Visual owner supplies a frozen plan and separate exact original-read grants. Models validates the current account's model, downloads the versioned input bytes, applies the shared legacy parameter rules and checks capacity before writing a prepared batch. A signed source decision activates the exact plan. The shared provider task driver submits and polls once per accepted execution, materializes a verified file and persists the result digest. A retry of known result materialization never resubmits the provider. Models releases temporary originals after submission and recovers unreferenced staging under its service lock.

## Alternatives considered

Submitting directly during preparation would allow a provider call after a failed Canvas CAS. Forwarding the whole provider credential and upload configuration to Visual would violate ownership.

## Consequences

Models owns new private plan and execution tables and counts prepared jobs against admission. Signed status and result routes can reconcile a committed source decision after a browser session expires. Provider submission still requires current authority. The Visual-facing dispatch, acknowledgements and published routes are a subsequent slice.

## Verification

Deterministic service tests cover immutable preparation and activation replay, late abort tombstones, provider interruption without resubmission, exact result bytes and digest, foreign-account denial, existing quota behavior and the legacy provider tests.
