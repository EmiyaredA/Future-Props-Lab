"""Supported ZEALMAN workflow contracts and pure request preparation."""

from __future__ import annotations

import secrets
from typing import Any

U17 = "U17-9图1视频3音频V1-api"
U06 = "U06-9图3音频-V5"
WORKFLOWS = {
    U17: {"image": 9, "audio": 3, "video": 1},
    U06: {"image": 9, "audio": 3, "video": 0},
}
RATIOS = {
    "16:9": "16:9 (Widescreen)",
    "9:16": "9:16 (Portrait Widescreen)",
    "4:3": "4:3 (Standard)",
    "3:4": "3:4 (Portrait Standard)",
    "1:1": "1:1 (Square)",
}
REFERENCE_MIME_TYPES = {
    "image": {"image/png", "image/jpeg", "image/webp", "image/gif"},
    "audio": {"audio/mpeg", "audio/wav", "audio/x-wav"},
    "video": {"video/mp4", "video/quicktime"},
}


def normalize_request(
    model: str, payload: dict[str, Any], explicit_fields: set[str]
) -> dict[str, Any]:
    """Validate a workflow request before uploads; snapshot defaults and the seed once."""
    caps = parameter_options(model)
    result = dict(payload)
    if not str(result.get("prompt") or "").strip():
        raise ValueError("请输入生成提示词")
    if not 4 <= result["duration"] <= 15:
        raise ValueError("工作流视频时长必须为 4 至 15 秒")
    if result.get("mode") == "frames":
        raise ValueError("当前工作流不支持首尾帧模式，请使用全能参考")
    for kind, field in (
        ("image", "reference_asset_ids"),
        ("audio", "audio_asset_ids"),
        ("video", "video_asset_ids"),
    ):
        if len(result.get(field, [])) > caps["reference_limits"][kind]:
            raise ValueError(
                f"当前工作流最多支持 {caps['reference_limits'][kind]} 个"
                f"{ {'image': '图片', 'audio': '音频', 'video': '视频'}[kind] }参考素材"
            )
    if result.get("audio_asset_ids") and not (
        result.get("reference_asset_ids") or result.get("video_asset_ids")
    ):
        raise ValueError("参考音频需要搭配至少一张图片或一个视频")
    unsupported = {
        name
        for name in explicit_fields & {"resolution", "watermark", "generate_audio"}
        if result.get(name) is not None
    }
    if (
        not caps["supports_ratio"]
        and "ratio" in explicit_fields
        and result.get("ratio") is not None
    ):
        unsupported.add("ratio")
    if unsupported:
        raise ValueError("当前工作流不支持参数：" + ", ".join(sorted(unsupported)))
    for field in ("resolution", "watermark", "generate_audio"):
        result.pop(field, None)
    if not caps["supports_ratio"]:
        result.pop("ratio", None)
    else:
        result["ratio"] = result.get("ratio") or "16:9"
    result["workflow_parameters"] = normalize_parameters(
        model, result.get("workflow_parameters") or {}
    )
    return result


def profile(model: str) -> dict[str, Any]:
    if model not in WORKFLOWS:
        raise ValueError("ZEALMAN 仅支持 U17 与 U06 工作流")
    return WORKFLOWS[model]


def parameter_options(model: str) -> dict[str, Any]:
    return {
        "reference_limits": dict(profile(model)),
        "reference_mime_types": {
            kind: sorted(types) for kind, types in REFERENCE_MIME_TYPES.items()
        },
        "max_reference_bytes": 45 * 1024 * 1024,
        "parameters": (
            {
                "megapixels": {"default": 0.9, "minimum": 0.1, "maximum": 2.0, "step": 0.1},
                "upscale_factor": {"default": 1.5, "minimum": 1.0, "maximum": 2.0, "step": 0.1},
            }
            if model == U17
            else {
                "width": {"default": 1344, "minimum": 256, "maximum": 2048, "step": 32},
                "height": {"default": 768, "minimum": 256, "maximum": 2048, "step": 32},
                "seed": {"default": None, "minimum": 0, "maximum": 2**50, "step": 1},
            }
        ),
        "supports_ratio": model == U17,
        "joint_audio": True,
    }


def normalize_parameters(model: str, values: dict[str, Any]) -> dict[str, Any]:
    specs = parameter_options(model)["parameters"]
    known = {name for workflow in WORKFLOWS for name in parameter_options(workflow)["parameters"]}
    # Shared nullable schemas round-trip every workflow's fields through canvas drafts.
    # Null is absent; an actual value for another workflow remains unsupported.
    supplied = {name: value for name, value in values.items() if value is not None}
    if set(values) - known or set(supplied) - specs.keys():
        raise ValueError("当前工作流不支持这些参数")
    result = {}
    for name, spec in specs.items():
        value = supplied.get(name, spec["default"])
        if name == "seed" and value is None:
            value = secrets.randbelow(2**50 + 1)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{name} 必须是数字")
        if not spec["minimum"] <= value <= spec["maximum"]:
            raise ValueError(f"{name} 超出支持范围")
        if name in {"width", "height", "seed"} and value != int(value):
            raise ValueError(f"{name} 必须是整数")
        if name in {"width", "height"} and value % 32:
            raise ValueError("宽高必须为 32 的倍数")
        result[name] = value
    return result


def prepare_input_values(
    model: str, payload: dict[str, Any], references: dict[str, list[str]]
) -> dict[str, Any]:
    """Use public API names; slot zero is Picture/Video/Audio 1, never a node ID."""
    contract = profile(model)
    if set(references) - contract.keys():
        raise ValueError("ZEALMAN 不支持此参考素材类型")
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("请输入生成提示词")
    duration = payload["duration"]
    if not 4 <= duration <= 15:
        raise ValueError("工作流视频时长必须为 4 至 15 秒")
    values = {"prompt": prompt, "value": duration}
    params = normalize_parameters(model, payload.get("workflow_parameters") or {})
    if model == U17:
        values.update(
            aspect_ratio=RATIOS[payload.get("ratio", "16:9")],
            megapixels=params["megapixels"],
            value_2=params["upscale_factor"],
        )
    else:
        values.update(param_4=params["width"], param_5=params["height"], seed=params["seed"])
    for kind, limit in contract.items():
        supplied = references.get(kind, [])
        if len(supplied) > limit:
            raise ValueError(f"当前工作流不支持此{kind}参考数量")
        for index, filename in enumerate(supplied):
            if not isinstance(filename, str) or not filename.strip():
                raise ValueError("ZEALMAN 参考素材上传未返回有效文件名")
            values[f"ref_{kind}_{index}"] = filename
    return values
