# Agent Note: Group contract and quality commands

Status: implemented

## Problem

Contract tools and repository checks are scattered between the script
root and website operations. References include both package commands
and the paths recorded by generators.

## Decision

Contract generation and schema reads live in scripts/contracts.
Quality checks live in scripts/checks. Existing package commands
invoke their new targets. The protected SDK documentation generator
keeps its established entry point.

## Alternatives considered

Forwarding scripts would preserve both paths and make ownership less
clear for CI and code generation.

## Consequences

Generated source headers identify the relocated commands. Schema data
and generated SDK operations retain their existing contents.

## Verification

Contract, SDK, official seed, note and documentation protection checks
run through their package commands. The SDK documentation tests exercise
the retained protected entry point.
