from __future__ import annotations

import asyncio
import io
import json
import stat
import zipfile
from pathlib import PurePosixPath

from app.apps.live2d_workshop.models import Live2DAsset, Live2DProject
from app.apps.live2d_workshop.projects import APP, Live2DInvalid, Live2DProjectsStore, decode_png
from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.project_transactions import importing_project_layout
from app.capabilities.media_rendering.live2d.document import CharacterDocument
from app.runtime.ids import new_id

MAX_PACKAGE = 256 * 1024 * 1024


def read_package(data: bytes) -> tuple[str, CharacterDocument, dict]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            files = archive.infolist()
            if len(files) > 260 or sum(f.file_size for f in files) > MAX_PACKAGE:
                raise Live2DInvalid("工程包解压大小或文件数过大")
            names = set()
            for f in files:
                path = PurePosixPath(f.filename)
                if (
                    f.filename in names
                    or path.is_absolute()
                    or ".." in path.parts
                    or "\\" in f.filename
                    or stat.S_ISLNK(f.external_attr >> 16)
                    or f.is_dir()
                ):
                    raise Live2DInvalid("工程包包含不安全或重复路径")
                names.add(f.filename)
            if (
                "manifest.json" not in names
                or archive.getinfo("manifest.json").file_size > 16 * 1024 * 1024
            ):
                raise Live2DInvalid("工程包缺少有效清单")
            manifest = json.loads(archive.read("manifest.json"))
            if not isinstance(manifest, dict):
                raise Live2DInvalid("工程清单必须为对象")
            if manifest.get("format") != "fpllive2d" or manifest.get("version") not in (1, 2, 3):
                raise Live2DInvalid("不支持的工程格式或版本")
            document = CharacterDocument.model_validate(manifest["document"])
            assets = {}
            for part in document.parts:
                if part.asset_id not in assets:
                    name = f"assets/{part.asset_id}.png"
                    if name not in names:
                        raise Live2DInvalid(f"工程素材缺失：{part.name}")
                    assets[part.asset_id] = decode_png(archive.read(name))
            allowed = {"manifest.json", "thumbnail.png"} | {f"assets/{key}.png" for key in assets}
            if names - allowed:
                raise Live2DInvalid("工程包含未登记文件")
            return str(manifest.get("title", "导入角色"))[:120], document, assets
    except (zipfile.BadZipFile, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise Live2DInvalid("工程包损坏或清单无效") from exc


class Live2DPackages(Live2DProjectsStore):
    async def export(self, project_id: str) -> bytes:
        row = await self.row(project_id)
        doc = CharacterDocument.model_validate(row.document)
        paths = await self.paths(project_id)
        title = row.title
        thumb = await self.preview(project_id, width=256)

        def pack() -> bytes:
            out = io.BytesIO()
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(
                    "manifest.json",
                    json.dumps(
                        {
                            "format": "fpllive2d",
                            "version": 3,
                            "title": title,
                            "document": doc.model_dump(mode="json", by_alias=True),
                        },
                        ensure_ascii=False,
                    ),
                )
                archive.writestr("thumbnail.png", thumb)
                for asset_id in {p.asset_id for p in doc.parts}:
                    path = paths.get(asset_id)
                    if path is None or not path.is_file():
                        raise Live2DInvalid("工程素材缺失，无法导出")
                    archive.write(path, f"assets/{asset_id}.png")
            return out.getvalue()

        return await asyncio.to_thread(pack)

    async def import_package(self, incoming: IncomingFile):
        data = await incoming.read(MAX_PACKAGE + 1)
        if len(data) > MAX_PACKAGE:
            raise Live2DInvalid("工程包超过 256 MiB")
        title, doc, assets = await asyncio.to_thread(read_package, data)
        mapping = {key: new_id() for key in assets}
        for part in doc.parts:
            part.asset_id = mapping[part.asset_id]
        row = Live2DProject(
            id=new_id(),
            workspace_id=self.workspace_id,
            title=title or "导入角色",
            document=doc.model_dump(mode="json", by_alias=True),
        )
        async with importing_project_layout(
            self.session, self.storage, APP, row.id, workspace_id=self.workspace_id
        ):
            self.session.add(row)
            await self.session.flush()
            for old_id, (png, width, height) in assets.items():
                asset_id = mapping[old_id]
                path = self.root(row.id) / "assets" / f"{asset_id}.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(png)
                self.session.add(
                    Live2DAsset(
                        id=asset_id,
                        project_id=row.id,
                        workspace_id=self.workspace_id,
                        name=f"{asset_id}.png",
                        width=width,
                        height=height,
                    )
                )
        await self.session.refresh(row)
        return self.out(row)
