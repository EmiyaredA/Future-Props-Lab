"""Read the bundled native Amadeus model for offline rendering checks.

This reader has no project, database, import or Cubism attachment lifecycle.
"""

from __future__ import annotations

import io
import json
import zipfile

from PIL import Image

from studio.contracts.media_rendering.character_document import CharacterDocument


def read_package(data: bytes) -> tuple[str, CharacterDocument, dict]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("format") != "fpllive2d" or manifest.get("version") not in (2, 3):
            raise ValueError("Unsupported bundled avatar format")
        document = CharacterDocument.model_validate(manifest["document"])
        assets = {}
        for part in document.parts:
            if part.asset_id in assets:
                continue
            png = archive.read(f"assets/{part.asset_id}.png")
            with Image.open(io.BytesIO(png)) as image:
                image.verify()
                assets[part.asset_id] = (png, image.width, image.height)
        return manifest["title"], document, assets
