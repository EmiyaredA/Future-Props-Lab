# Agent Note: Galgame Annotation import worker

Status: implemented

## Problem

The published Galgame import job needs to turn an exact Annotation source into validated voice clips and one revisioned Story across separate service databases.

## Decision

The enqueue operation validates the source and destination revisions and records the exact write assertion with the idempotent job. Identity revalidates the live account and browser Session or API key when issuing original audio, clip upload and Story retention grants. Assets streams the owned audio under its expected SHA-256 and Galgame verifies the received bytes. The shared media capability uses the existing AAC, duration and content-correlation checks. Galgame uploads bounded groups of exact clips and reuses already committed files only when the virtual path and digest agree. The final Story, prior snapshot, master packaging setting, reference decision and task completion commit together.

## Alternatives considered

Reading Annotation or Assets state directly would bypass their ownership checks. Creating a new clip name after every retry would duplicate project files when the acknowledgement was lost. Saving the Story before accepting the route report would expose a failed import until a second revision compensated for it.

## Consequences

The original operation ID, HTTP 202 and task responses remain available. A stopped worker can retry deterministic clipping and settle the existing upload without uploading the same files again. A failed Story acceptance leaves the previous Story current. Generated project clips remain eligible for reuse, matching the previous import behavior. The Galgame image contains the pinned FFmpeg tools, and its task scratch space stays in its own state directory.

## Verification

The signed integration test runs real audio, drops a committed upload reply, restarts job recovery, and checks the single Story snapshot and the two resulting files. It checks replay, different content under the same request ID and rejection after Session revocation. Six isolated containers and Chromium exercise the existing browser entries, complete the import, check both clip hashes and repeat the request after restarting Galgame and Assets.
