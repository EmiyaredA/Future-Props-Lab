# Agent Note: Model configuration ownership

Status: implemented

## Problem

Model playground and inference components silently selected process-global configuration. Two
application factories could therefore use separate databases but share the wrong input directory,
upload limit or temporary-media provider policy. A module-level inference root helper concealed
this dependency from deletion, text inputs and task preparation.

## Decision

All Models components receive their configuration explicitly. Website and independent HTTP adapters
use their current application's settings; inference file operations use an owned InferenceStorage
instance. Catalogue capability discovery receives the upload-configured decision as a value.
The global inference root helper and its re-export are removed. Models production code cannot call
get_settings, enforced across the whole application package.

## Alternatives considered

- Keeping optional defaults would preserve the ambiguous root selection in tests and future callers.
- Rebinding global configuration during application construction would make concurrent instances race.
- Putting configuration in Session.info would hide the dependency in a storage object.

## Consequences

HTTP schemas, account ownership, task revisions and persisted paths remain unchanged. Callers of
internal constructors must explicitly supply configuration. Native retention tests pass the native
scenario's settings instead of monkeypatching a module root. This batch removes configuration
lookup; existing ORM-backed components still need the planned use-case and storage decomposition.

## Verification

Model inference, playground, generation references, transcription, native retention and controlled
provider regressions cover normal operations and uncertain results. A two-configuration test uses
the same account ID with different roots and limits, checks the rejected upload leaves no record,
and verifies the accepted file exists only under the chosen application's root. Architecture,
OpenAPI, service ownership, source closure and import gates guard both entry styles.
