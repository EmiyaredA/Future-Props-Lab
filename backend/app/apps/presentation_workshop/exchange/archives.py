"""Bounded, self-contained presentation packages, independent of database state."""

import io
import json
import zipfile
from pathlib import PurePosixPath

from app.apps.presentation_workshop.exchange.contracts import ImportedFile, ParsedPresentation
from app.apps.presentation_workshop.projects import PresentationError
from app.apps.presentation_workshop.schemas.document import PresentationProjectIn

MAX_BYTES = 100 * 1024 * 1024


def checked_archive(content: bytes) -> zipfile.ZipFile:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        items = archive.infolist()
        if len(items) > 5000 or sum(item.file_size for item in items) > MAX_BYTES:
            raise PresentationError(
                "文稿解包后不能超过 100 MiB 或 5000 个文件", 413, "import_too_large"
            )
        seen = set()
        for item in items:
            path = PurePosixPath(item.filename)
            if (
                path.is_absolute()
                or ".." in path.parts
                or "\\" in item.filename
                or item.filename in seen
                or item.flag_bits & 1
                or (item.external_attr >> 16) & 0o170000 == 0o120000
            ):
                raise PresentationError("文稿包包含无效或重复路径", 422, "invalid_package")
            seen.add(item.filename)
        return archive
    except (zipfile.BadZipFile, OSError, ValueError) as exc:
        raise PresentationError("文稿不是有效的 ZIP 文件", 422, "invalid_package") from exc


def read_package(content: bytes) -> ParsedPresentation:
    with checked_archive(content) as archive:
        try:
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("format") != "fplppt" or manifest.get("version") != 1:
                raise ValueError("文稿包版本不受支持")
            project = PresentationProjectIn.model_validate(
                json.loads(archive.read("document.json"))
            )
            assets = {}
            for item in manifest.get("assets", []):
                identity, path = item["id"], item["path"]
                if identity in assets or not path.startswith("assets/"):
                    raise ValueError("素材清单无效")
                assets[identity] = ImportedFile(
                    item["filename"], item["mime_type"], archive.read(path)
                )
            return ParsedPresentation(project.title, project.document, assets)
        except (KeyError, ValueError, TypeError) as exc:
            raise PresentationError("文稿包清单或正文无效", 422, "invalid_package") from exc


def write_package(snapshot, assets) -> bytes:
    buffer = io.BytesIO()
    manifest = {"format": "fplppt", "version": 1, "assets": []}
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "document.json",
            json.dumps(
                {"title": snapshot.title, "document": snapshot.document.model_dump()},
                ensure_ascii=False,
            ),
        )
        for row, path in assets:
            name = f"assets/{row.id}"
            archive.write(path, name)
            manifest["assets"].append(
                {
                    "id": row.id,
                    "path": name,
                    "filename": row.original_filename,
                    "mime_type": row.mime_type,
                }
            )
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
    if buffer.tell() > MAX_BYTES:
        raise PresentationError("文稿包不能超过 100 MiB", 413, "export_too_large")
    return buffer.getvalue()
