# Agent Note: Models-owned role policy and catalogue reconciliation

Status: implemented

## Problem

Role-template reconciliation reads the old shared settings table and scans workshop task models. The new account-event consumer therefore cannot install the approved role catalogue inside its independent Models database without loading the recovery website's governance implementation.

## Decision

Move catalogue merge and preview rules into the owning LLM catalogue with explicit default-selection and account-task occupancy ports. Keep the recovery website's settings, audit, authorization and cross-workshop occupancy in its adapter. Add owned Models role-policy storage with a registered migration and CAS, masked views and secret replacement/preservation. Supply a local account initializer that applies the current role policy or the existing no-key built-in seed, inside the event receipt transaction.

## Alternatives considered

- Importing legacy governance into Models loads unrelated ORM and the global database.
- Copying its shared settings table gives Models another service's configuration.
- Replacing catalogues wholesale changes referenced IDs and overwrites private choices.

## Verification

Twenty-seven targeted checks pass, covering concurrent policy CAS, secret replacement/preservation/clear and masked conflicts, current-role event initialization, no-key fallback seeding, immutable receipts, retained model IDs/custom defaults, disappeared template entries, private-name collisions and per-account task occupancy. A fresh interpreter imports owned role policy without account/workshop ORM or the legacy database. The independent Identity/Models HTTP scenario now initializes actual owned user/admin policies and retains acknowledgment-loss and role-change coverage. Recovery website template/synchronization tests remain active.

The full backend suite passes 2059 tests with four conditional skips. Contract/SDK checks pass without public API changes. Verification uses temporary owned storage and synthetic secrets; no provider calls, formal data writes or production service changes occur.

## Consequences

Models owns twenty-one tables, including a CAS role-policy table appended as `0004_role_templates`. Account initialization can use owned role policy inside the catalogue/receipt transaction. Stable-ID merge rules and encrypted value handling are shared with the recovery website through explicit storage/occupancy adapters. The recovery adapter retains its existing authorization and audit transaction.

## Risks

Owned policy storage does not by itself complete the public governance HTTP adapter, Identity audit delivery, synchronization grants, Models admission ledger or its remaining asset/native/provider ports. Formal startup remains gated.
