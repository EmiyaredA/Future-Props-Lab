# Agent Note: Publish Visual uploads with the Canvas decision

Status: implemented

## Problem

Material nodes and output revisions need one owned Canvas CAS. In a split deployment, a concurrent edit or a missing reply could otherwise leave visible files without a Canvas reference or saved nodes with missing originals.

## Decision

Visual binds the exact uploaded filename, media kind, byte count and SHA256 to the authorized public operation. It drains previously decided Canvas reference outcomes before preparing a new upload. Assets journals the upload under the retention intent, checks current authorization before admission and before sealing, and stores private originals outside the write lock. The source Canvas and its decision are written together. Assets then publishes the staged originals and final pins in one transaction. A lost stage reply can recover the exact sealed metadata. A rejected source CAS records the abort; Assets cleans staged files or recovers interrupted writes on restart.

## Alternatives considered

Posting to the public file library first would expose originals before Canvas CAS and leave uploads behind after a conflict. Holding either service's SQLite writer open during file reads and transcoding would delay unrelated writes.

## Consequences

The Assets image includes pinned FFmpeg and only the two shared GIF upload and codec modules from media rendering. Animation uploads to a video node preserve both the playable MP4 and the transparent inspection WebM. Visual multipart and Assets conversion scratch use their own state volumes. An in-progress upload fences competing retention changes for the same Canvas.

## Verification

The signed three-service test covers hidden staging, a lost staging reply, exact PNG bytes, two GIF outputs, and a concurrent text edit that aborts the newer upload and cleans both staged files. The isolated Compose exercise verifies the two published routes, Chromium Canvas loading, media downloads and retained output versions after restart.
