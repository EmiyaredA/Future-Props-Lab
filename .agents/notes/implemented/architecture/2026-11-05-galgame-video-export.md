# Agent Note: Render and publish complete Galgame videos independently

Status: implemented

## Problem

A Galgame export needs the approved Story and file versions, deterministic media rendering, and an original that stays downloadable after task and service restarts.

## Decision

Galgame commits the frozen Story and render dispatch together. Rendering reserves the digest-bound job, revalidates its original grants, and writes a sealed MP4 only after verifying the H.264 and AAC tracks, resolution, frame rate and duration. Galgame streams that sealed file into the existing Assets intake. The intake and task record the same asset identity and digest before Galgame publishes completion. The temporary Rendering copy is released after the durable outcome. Project deletion can retry release with current account authority.

## Alternatives considered

Returning only the preflight would leave the production export unavailable. Re-rendering or uploading after every lost response could duplicate files or silently change the frozen Story. Sharing a volume would bypass owner scopes.

## Consequences

Existing clients keep the 202 task, status, cancellation and range-download operations. The stable filename includes a short task identifier so simultaneous exports of the same ending cannot collide. The file size setting belongs to Assets. A cancel request before registration stops the job. An upload already in registration settles through its durable receipt.

## Verification

Eighty-eight focused tests cover actual MP4 creation, the lost Assets response, cancellation, project cleanup, migration compatibility and the published contract. Isolated Compose rendered a clip with audio, verified range reads and matched the full file SHA-256 after restarting Galgame, Rendering and Assets. Chromium exercised the existing Galgame browser entry in the same deployment.
