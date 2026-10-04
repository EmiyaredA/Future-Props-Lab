"""Read a data-only Coopanion whale archive; uploaded JavaScript is never accepted."""

from __future__ import annotations

import io
import json
import math
import re
import stat
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath

from PIL import Image, UnidentifiedImageError

from .authored_motion import validate_face_source_images
from .human_motion import JOINT_PARENTS, validate_motion_rig
from .whale_motion import PARENTS as WHALE_PARENTS

MAX_ARCHIVE = 32 * 1024 * 1024
MAX_UNPACKED = 64 * 1024 * 1024
NAME = re.compile(r"^[a-zA-Z0-9_-]{1,48}$")


def _finite(value: object, limit: float = 8192) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and abs(value) <= limit
        and math.isfinite(value)
    )


def _reject_nonfinite(value: str) -> None:
    raise ValueError(f"鲸鱼娘模型包含非法数字：{value}")


@dataclass(frozen=True)
class WhalePackage:
    model: dict
    images: dict[str, bytes]


def _expected_paths(model: dict) -> set[str]:
    profile = model.get("rigProfile", "whale")
    if profile not in ("whale", "human-chibi"):
        raise ValueError("桌宠骨架类型不支持")
    human = profile == "human-chibi"
    character = model.get("character")
    if character is not None and (
        not isinstance(character, dict)
        or not isinstance(character.get("name"), str)
        or not 1 <= len(character["name"].strip()) <= 120
    ):
        raise ValueError("桌宠角色名称无效")
    if human and character is None:
        raise ValueError("人物桌宠缺少角色资料")
    parts = model.get("parts")
    feat = model.get("feat")
    schemes = model.get("schemes")
    rig = model.get("motionRig")
    version_two = isinstance(rig, dict) and type(rig.get("version")) is int and rig["version"] == 2
    # The larger candidate budget is accepted only after profile-specific full rig validation below.
    max_parts = 128 if version_two else 80
    if (
        not isinstance(parts, list)
        or not 1 <= len(parts) <= max_parts
        or not isinstance(feat, dict)
        or not isinstance(schemes, list)
        or not 1 <= len(schemes) <= 8
    ):
        raise ValueError("鲸鱼娘模型结构无效")
    units = model.get("units")
    pivots = model.get("pivots")
    view = model.get("view")
    if (
        not isinstance(units, dict)
        or any(not _finite(units.get(key)) for key in ("S", "X0", "FEET"))
        or units["S"] <= 0
        or not isinstance(pivots, dict)
        or any(
            not isinstance(pivots.get(key), list)
            or len(pivots[key]) != 2
            or not all(_finite(value) for value in pivots[key])
            for key in (
                ("body", "neck", "armNear", "armFar", "legBack", "legFront")
                if human
                else (
                    "body",
                    "armNear",
                    "armFar",
                    "legBack",
                    "legFront",
                    "tail",
                    "neck",
                    "finNear",
                    "finFar",
                    "ahoge",
                )
            )
        )
        or not isinstance(view, list)
        or len(view) != 4
        or not all(_finite(value) for value in view)
        or view[2] <= view[0]
        or view[3] <= view[1]
    ):
        raise ValueError("鲸鱼娘骨架定义无效")
    if (human or version_two) and (view[2] - view[0] > 512 or view[3] - view[1] > 512):
        raise ValueError("关节桌宠画布过大")
    sprites = feat.get("sprites")
    eyes = feat.get("eyes")
    if not isinstance(sprites, dict) or (not human and not isinstance(eyes, dict)):
        raise ValueError("鲸鱼娘五官定义无效")
    textures: set[str] = set()
    part_ids: set[str] = set()
    for part in parts:
        if not isinstance(part, dict) or not NAME.fullmatch(str(part.get("tex", ""))):
            raise ValueError("鲸鱼娘部件贴图无效")
        grid, box = part.get("grid"), part.get("box")
        if (
            not isinstance(grid, list)
            or len(grid) != 2
            or not all(isinstance(n, int) and 1 <= n <= 16 for n in grid)
            or not isinstance(box, list)
            or len(box) != 4
            or not all(_finite(n) for n in box)
        ):
            raise ValueError("鲸鱼娘网格定义无效")
        textures.add(part["tex"])
        if human or version_two:
            part_id = part.get("id")
            if (
                not isinstance(part_id, str)
                or not NAME.fullmatch(part_id)
                or part_id in part_ids
                or part.get("parent")
                not in (
                    {
                        "body",
                        "neck",
                        "head",
                        "hair",
                        "bangs",
                        "coat",
                        "armNear",
                        "armFar",
                        "legBack",
                        "legFront",
                        *(JOINT_PARENTS if model.get("motionRig") is not None else ()),
                    }
                    if human
                    else WHALE_PARENTS
                )
                or not _finite(part.get("z"))
                or box[2] <= 0
                or box[3] <= 0
            ):
                raise ValueError("人物桌宠分件定义无效")
            part_ids.add(part_id)
        uv = part.get("uvBox")
        if uv is not None and (
            not isinstance(uv, list)
            or len(uv) != 4
            or not all(_finite(n, 1) and n >= 0 for n in uv)
            or uv[2] <= uv[0]
            or uv[3] <= uv[1]
        ):
            raise ValueError("分件贴图裁切范围无效")
    validate_motion_rig(model)
    required = (
        {
            "hair_back",
            "face",
            "hair_front",
            "torso",
            "coat",
            "arm_near",
            "arm_far",
            "leg_back",
            "leg_front",
            "sit_lower",
        }
        if human
        else {"skirt", "skirt_sit", "tail", "hair_back", "bangs", "brows", "eye_creases"}
    )
    if not required.issubset({part["id"] for part in parts if isinstance(part.get("id"), str)}):
        raise ValueError("鲸鱼娘缺少分件")
    feature_names = set(sprites)
    if not feature_names or any(not NAME.fullmatch(name) for name in feature_names):
        raise ValueError("鲸鱼娘五官贴图无效")
    if human:
        if not {
            "eyes",
            "closed_eyes",
            "angry_eyes",
            "surprised_eyes",
            "brows",
            "neutral_mouth",
            "happy_mouth",
        }.issubset(feature_names):
            raise ValueError("人物桌宠缺少表情贴图")
        if any(
            not isinstance(box, list)
            or len(box) != 4
            or not all(_finite(n) for n in box)
            or box[2] <= box[0]
            or box[3] <= box[1]
            for box in sprites.values()
        ):
            raise ValueError("人物桌宠表情位置无效")
    for eye_id in () if human else ("eyeL", "eyeR"):
        eye = eyes.get(eye_id)
        if not isinstance(eye, dict):
            raise ValueError("鲸鱼娘眼睛定义无效")
        feature_names.update(f"{eye_id}_{piece}" for piece in ("lash", "ball", "iris"))
        if eye.get("rim"):
            feature_names.add(f"{eye_id}_rim")
    paths: set[str] = set()
    scheme_ids: set[str] = set()
    for index, scheme in enumerate(schemes):
        scheme_id = scheme.get("id") if isinstance(scheme, dict) else None
        if (
            not isinstance(scheme_id, str)
            or not NAME.fullmatch(scheme_id)
            or scheme_id in scheme_ids
            or scheme.get("ready") is False
        ):
            raise ValueError("鲸鱼娘配色定义无效")
        scheme_ids.add(scheme_id)
        outfit = scheme.get("outfit")
        if outfit is not None:
            if (
                not human
                or not isinstance(outfit, dict)
                or set(outfit) != {"standingParts", "seatedParts"}
            ):
                raise ValueError("人物桌宠服饰姿态定义无效")
            standing, seated = outfit["standingParts"], outfit["seatedParts"]
            if any(
                not isinstance(group, list)
                or not 1 <= len(group) <= 8
                or any(not isinstance(name, str) or name not in part_ids for name in group)
                or len(set(group)) != len(group)
                for group in (standing, seated)
            ) or set(standing) & set(seated):
                raise ValueError("人物桌宠服饰姿态引用无效")
        prefix = "" if index == 0 else f"schemes/{scheme_id}/"
        paths.update(f"{prefix}tex/{name}.png" for name in textures)
        paths.update(f"{prefix}feat/{name}.png" for name in feature_names)
        paths.add(f"thumbs/{scheme_id}.png")
    return paths


def read_whale_package(data: bytes) -> WhalePackage:
    if len(data) > MAX_ARCHIVE:
        raise ValueError("鲸鱼娘资源包超过 32 MiB")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            files = archive.infolist()
            if len(files) > 450 or sum(item.file_size for item in files) > MAX_UNPACKED:
                raise ValueError("鲸鱼娘资源包解压大小或文件数过大")
            names: set[str] = set()
            for item in files:
                path = PurePosixPath(item.filename)
                if (
                    item.filename in names
                    or path.is_absolute()
                    or ".." in path.parts
                    or "\\" in item.filename
                    or item.is_dir()
                    or stat.S_ISLNK(item.external_attr >> 16)
                ):
                    raise ValueError("鲸鱼娘资源包包含不安全路径")
                names.add(item.filename)
            if "manifest.json" not in names or "model.json" not in names:
                raise ValueError("鲸鱼娘资源包缺少清单或模型")
            if (
                archive.getinfo("manifest.json").file_size > 1024
                or archive.getinfo("model.json").file_size > 128 * 1024
            ):
                raise ValueError("鲸鱼娘模型过大")
            manifest = json.loads(archive.read("manifest.json"), parse_constant=_reject_nonfinite)
            if manifest != {"format": "fpl-coopanion-whale", "version": 1}:
                raise ValueError("鲸鱼娘资源包版本不支持")
            model = json.loads(archive.read("model.json"), parse_constant=_reject_nonfinite)
            if not isinstance(model, dict):
                raise ValueError("鲸鱼娘模型无效")
            expected = _expected_paths(model)
            if names != expected | {"manifest.json", "model.json"}:
                raise ValueError("鲸鱼娘贴图缺失或资源包包含未登记文件")
            images = {}
            dimensions: dict[str, tuple[int, int]] = {}
            for name in sorted(expected):
                content = archive.read(name)
                if len(content) > 16 * 1024 * 1024:
                    raise ValueError("鲸鱼娘单张贴图超过 16 MiB")
                with Image.open(io.BytesIO(content)) as image:
                    image.load()
                    if (
                        image.format != "PNG"
                        or not 1 <= image.width <= 4096
                        or not 1 <= image.height <= 4096
                    ):
                        raise ValueError("鲸鱼娘 PNG 无效")
                    dimensions[name] = image.size
                images[name] = content
            for scheme in model["schemes"][1:]:
                prefix = f"schemes/{scheme['id']}/"
                for name in expected:
                    if name.startswith(prefix):
                        base = name[len(prefix) :]
                        if (
                            base.startswith(("tex/", "feat/"))
                            and dimensions[name] != dimensions[base]
                        ):
                            raise ValueError("鲸鱼娘配色贴图尺寸不一致")
            validate_face_source_images(model, dimensions)
            return WhalePackage(model=model, images=images)
    except (
        zipfile.BadZipFile,
        KeyError,
        TypeError,
        json.JSONDecodeError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        OSError,
    ) as exc:
        raise ValueError("鲸鱼娘资源包损坏") from exc
