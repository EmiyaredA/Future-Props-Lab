"""Compatibility adapter for atomic imports into the shared library and project store."""

import asyncio
import tempfile
from pathlib import Path
from uuid import uuid4

from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.presentation_workshop.exchange.archives import MAX_BYTES
from studio.apps.presentation_workshop.exchange.transfers import remap_document
from studio.apps.presentation_workshop.schemas.document import PresentationProjectIn
from studio.runtime.ids import new_id


async def import_legacy_presentation(projects, title, document, files, _source_sha256, *, settings):
    library = AssetLibrary(projects.session, settings)
    staged = []
    paths = []
    identities = {}
    await projects.session.rollback()
    try:
        with tempfile.TemporaryDirectory(prefix="fpl-presentation-import-") as directory:
            for identity, file in files.items():
                source = Path(directory) / uuid4().hex
                await asyncio.to_thread(source.write_bytes, file.content)
                work = asyncio.create_task(
                    library.stage_local_copy(
                        source,
                        owner_user_id=projects.owner_user_id,
                        filename=file.filename,
                        content_type=file.mime_type,
                        max_bytes=MAX_BYTES,
                        defer_persistence=True,
                    )
                )
                try:
                    row, path = await asyncio.shield(work)
                except asyncio.CancelledError:
                    try:
                        _, cancelled_path = await work
                        cancelled_path.unlink(missing_ok=True)
                    finally:
                        raise
                staged.append(row)
                paths.append(path)
                row.id = new_id()
                identities[identity] = row.id

            projects.session.add_all(staged)
            return await projects.create(
                PresentationProjectIn(title=title, document=remap_document(document, identities))
            )
    except BaseException:
        await projects.session.rollback()
        for path in paths:
            path.unlink(missing_ok=True)
        raise
