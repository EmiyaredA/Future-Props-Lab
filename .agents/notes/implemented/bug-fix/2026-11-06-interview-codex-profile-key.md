# Agent Note: Preserve the Interview Codex permission profile

Status: implemented

## Problem

The Python namespace migration also changed an external Codex permission profile name to a dotted
Python module name. The generated TOML then described nested permission keys while default_permissions
selected the full dotted name. The existing test checked only a matching string and missed this mismatch.

## Decision

Restore the existing fpl_interview external profile and its filesystem/network keys. Add a comment
that this value is an external configuration contract, independent of source package names. Parse all
CLI configuration overrides as TOML and verify that the selected profile contains exactly the intended
minimal/read-only input and writable work paths, with network disabled.

## Alternatives considered

- Renaming the profile to another name creates an unnecessary external configuration change.
- Quoting dotted TOML keys retains an accidental Python-dependent name.
- Checking only a command substring cannot validate the resulting TOML structure.

## Consequences

The backend Python namespace remains studio. Codex receives the pre-migration configuration keys;
no credentials, databases or formal task state are changed.

## Verification

The Interview preparation regression includes parsed configuration, controlled subprocess events,
cancellation, account boundaries and structured delivery. No real supplier or personal CLI is invoked.
