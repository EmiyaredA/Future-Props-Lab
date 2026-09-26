"""Validate a Cubism runtime archive before it can be attached to a character."""

from __future__ import annotations

import io
import json
import stat
import zipfile
from pathlib import PurePosixPath

from app.apps.live2d_workshop.projects import Live2DInvalid

MAX_CUBISM_PACKAGE = 256 * 1024 * 1024
MAX_CUBISM_FILES = 1024


def inspect_cubism_package(data: bytes) -> dict:
    if len(data) > MAX_CUBISM_PACKAGE:
        raise Live2DInvalid("Cubism 运行包超过 256 MiB")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if (
                len(entries) > MAX_CUBISM_FILES
                or sum(e.file_size for e in entries) > MAX_CUBISM_PACKAGE
            ):
                raise Live2DInvalid("Cubism 运行包解压大小或文件数过大")
            names: set[str] = set()
            for entry in entries:
                path = PurePosixPath(entry.filename)
                if entry.is_dir():
                    continue
                if (
                    entry.filename in names
                    or path.is_absolute()
                    or not path.parts
                    or any(part in ("", ".", "..") for part in path.parts)
                    or "\\" in entry.filename
                    or stat.S_ISLNK(entry.external_attr >> 16)
                ):
                    raise Live2DInvalid("Cubism 运行包包含不安全或重复路径")
                names.add(entry.filename)
            if any(name.lower().endswith((".moc", ".mtn")) for name in names):
                raise Live2DInvalid("Cubism 2 的 .moc/.mtn 不能作为 Cubism 3 运行包导入")
            manifests = sorted(name for name in names if name.lower().endswith(".model3.json"))
            if len(manifests) != 1:
                raise Live2DInvalid("运行包必须包含且仅包含一个 .model3.json")
            model_path = manifests[0]
            if archive.getinfo(model_path).file_size > 2 * 1024 * 1024:
                raise Live2DInvalid("model3.json 过大")
            model = json.loads(archive.read(model_path))
            if not isinstance(model, dict) or model.get("Version") not in (3, "3"):
                raise Live2DInvalid("仅支持 Cubism 3/4/5 的 model3.json 运行清单")
            refs = model.get("FileReferences")
            if not isinstance(refs, dict):
                raise Live2DInvalid("model3.json 缺少 FileReferences")
            root = PurePosixPath(model_path).parent

            def reference(value: object, label: str) -> str:
                if not isinstance(value, str) or not value:
                    raise Live2DInvalid(f"{label} 文件路径无效")
                relative = PurePosixPath(value)
                if (
                    relative.is_absolute()
                    or any(p in ("", ".", "..") for p in relative.parts)
                    or "\\" in value
                ):
                    raise Live2DInvalid(f"{label} 文件路径不安全")
                full = str(root / relative)
                if full not in names:
                    raise Live2DInvalid(f"缺失引用文件：{full}")
                return full

            moc = reference(refs.get("Moc"), "Moc")
            if not moc.lower().endswith(".moc3") or not archive.read(moc)[:4] == b"MOC3":
                raise Live2DInvalid(".moc3 文件格式无效")
            textures = refs.get("Textures")
            if not isinstance(textures, list) or not textures:
                raise Live2DInvalid("运行包缺少贴图")
            texture_paths = [reference(item, "贴图") for item in textures]
            if not all(path.lower().endswith(".png") for path in texture_paths):
                raise Live2DInvalid("贴图须为 PNG")
            for key in ("Physics", "Pose", "UserData", "DisplayInfo"):
                if refs.get(key):
                    reference(refs[key], key)
            motions: dict[str, list[str]] = {}
            for group, items in (refs.get("Motions") or {}).items():
                if not isinstance(items, list):
                    raise Live2DInvalid("动作组清单无效")
                motions[group] = [
                    reference(item.get("File") if isinstance(item, dict) else None, "动作")
                    for item in items
                ]
            expressions = []
            for item in refs.get("Expressions") or []:
                if not isinstance(item, dict) or not isinstance(item.get("Name"), str):
                    raise Live2DInvalid("表情清单无效")
                expressions.append(
                    {"name": item["Name"], "path": reference(item.get("File"), "表情")}
                )
            return {
                "modelPath": model_path,
                "mocPath": moc,
                "textures": texture_paths,
                "motions": motions,
                "expressions": expressions,
                "physics": bool(refs.get("Physics")),
                "pose": bool(refs.get("Pose")),
                "fileCount": len(names),
                "sdkCheck": "pending",
            }
    except (zipfile.BadZipFile, json.JSONDecodeError, TypeError, AttributeError) as exc:
        raise Live2DInvalid("Cubism 运行包损坏或清单无效") from exc
