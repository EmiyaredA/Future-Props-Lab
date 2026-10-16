"""Supported ZEALMAN workflow contracts and pure request preparation."""

from __future__ import annotations

import copy
import secrets
from typing import Any

U17 = "U17-9图1视频3音频V1-api"
U06 = "U06-9图3音频-V5"
WORKFLOWS = {
    U17: {
        "reference": "275",
        "prompt": ("250", "PrimitiveStringMultiline", "value"),
        "images": ("248", "249", "247", "246", "279", "280", "281", "282", "283"),
        "audios": ("259", "260", "261"),
        "videos": ("256",),
        "output": ("180", "SaveVideo"),
    },
    U06: {
        "reference": "136",
        "prompt": ("664", "CR Prompt Text", "prompt"),
        "images": ("137", "139", "144", "151", "653", "654", "655", "656", "657"),
        "audios": ("719", "720", "721"),
        "videos": (),
        "output": ("732", "VHS_VideoCombine"),
    },
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
    unsupported = explicit_fields & {"resolution", "watermark", "generate_audio"}
    if not caps["supports_ratio"] and "ratio" in explicit_fields:
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
    contract = profile(model)
    return {
        "reference_limits": {"image": 9, "audio": 3, "video": len(contract["videos"])},
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
    if set(values) - specs.keys():
        raise ValueError("当前工作流不支持这些参数")
    result = {}
    for name, spec in specs.items():
        value = values.get(name, spec["default"])
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


def prepare_workflow(
    template: dict[str, Any], model: str, payload: dict[str, Any], references: dict[str, list[str]]
) -> dict[str, Any]:
    contract = profile(model)
    graph = copy.deepcopy({k: v for k, v in template.items() if k != "_api_config"})

    def inputs(identity: str, class_type: str) -> dict[str, Any]:
        node = graph.get(identity, {})
        if node.get("class_type") != class_type or not isinstance(node.get("inputs"), dict):
            raise ValueError(f"ZEALMAN 工作流结构已变化（节点 {identity}）")
        return node["inputs"]

    prompt_id, prompt_type, prompt_field = contract["prompt"]
    inputs(prompt_id, prompt_type)[prompt_field] = payload["prompt"]
    ref = inputs(contract["reference"], "MiniMaxH3ReferenceToVideo")
    if ref.get("prompt") != [prompt_id, 0]:
        raise ValueError("ZEALMAN 工作流提示词连线已变化")
    size_node = "115" if model == U17 else "665"
    width_output = 0 if model == U17 else 1
    expected_links = {
        "width": [size_node, width_output],
        "height": [size_node, width_output + 1],
        "length": ["131", 1],
    }
    if any(ref.get(key) != value for key, value in expected_links.items()):
        raise ValueError("ZEALMAN 工作流尺寸或时长连线已变化")
    inputs("132", "PrimitiveFloat")["value"] = payload["duration"]
    params = normalize_parameters(model, payload.get("workflow_parameters") or {})
    if model == U17:
        inputs("115", "ResolutionSelector").update(
            aspect_ratio=RATIOS[payload.get("ratio", "16:9")], megapixels=params["megapixels"]
        )
        inputs("182", "PrimitiveFloat")["value"] = params["upscale_factor"]
    else:
        inputs("665", "WJILatentPreset").update(
            {"预设分辨率": "自定义", "自定义宽": params["width"], "自定义高": params["height"]}
        )
        inputs("142", "easy seed")["seed"] = params["seed"]
    for kind, plural, class_type, field in (
        ("image", "images", "LoadImage", "image"),
        ("audio", "audios", "LoadAudio", "audio"),
        ("video", "videos", "VHS_LoadVideo", "video"),
    ):
        supplied = references.get(kind, [])
        if len(supplied) > len(contract[plural]):
            raise ValueError(f"当前工作流不支持此{kind}参考数量")
        for index, identity in enumerate(contract[plural]):
            target = inputs(identity, class_type)
            key = f"ref_{plural}.ref_{kind}_{index}"
            connection = ref.get(key)

            # Audio/video preprocessing may sit between the loader and the reference node.
            def depends(node_id: str, target_id: str, seen: set[str]) -> bool:
                if node_id == target_id:
                    return True
                if node_id in seen:
                    return False
                seen.add(node_id)
                return any(
                    depends(str(v[0]), target_id, seen)
                    for v in graph.get(node_id, {}).get("inputs", {}).values()
                    if isinstance(v, list) and len(v) == 2
                )

            if not isinstance(connection, list) or not depends(str(connection[0]), identity, set()):
                raise ValueError("ZEALMAN 工作流参考连线已变化")
            if index < len(supplied):
                target[field] = supplied[index]
            else:
                ref.pop(key)
    output_id, output_type = contract["output"]
    inputs(output_id, output_type)
    keep: set[str] = set()

    def visit(identity: str) -> None:
        if identity in keep:
            return
        if identity not in graph:
            raise ValueError("ZEALMAN 工作流引用了缺失节点")
        keep.add(identity)
        for value in graph[identity]["inputs"].values():
            if isinstance(value, list) and len(value) == 2:
                visit(str(value[0]))

    visit(output_id)
    if contract["reference"] not in keep:
        raise ValueError("ZEALMAN 最终输出未连接参考生成节点")
    return {identity: graph[identity] for identity in graph if identity in keep}
