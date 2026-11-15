"""Pinned AutoDL workflows authored by zealman; no runtime catalog scraping."""

from __future__ import annotations

import re
import secrets
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from studio.contracts.model_service.schemas.video_capabilities import VideoCapabilitiesOut

BASE_URL = "https://www.autodl.art"
PREFIX = "minimax_h3_"
MOTION = "wan2.2animate-v4-motion_retargeting"
TITI = PREFIX + "zm_titi"
TITIM = PREFIX + "zm_titim"
IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"]
AUDIO_MIMES = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac", "audio/x-flac"]
MAX_REFERENCE_BYTES = 45 * 1024 * 1024


@dataclass(frozen=True)
class Workflow:
    label: str
    images_min: int = 1
    images_max: int = 9
    audio_min: int = 0
    audio_max: int = 0
    duration_max: int = 15
    resolutions: tuple[str, ...] = ("480p", "768p")
    square: bool = False
    seed_min: int | None = 1
    mode: str = "reference"
    prompt: bool = True
    flac: bool = True
    duration_min: int = 1
    default_duration: int | None = None
    prompt_required: bool = True
    max_prompt_length: int = 20000
    video_required: bool = False
    uses_temporary_reference_urls: bool = False
    supports_subject: bool = False
    single_image_field: bool = False


def character_replacement(label: str, *, multiple: bool) -> Workflow:
    return Workflow(
        label,
        images_max=9 if multiple else 1,
        duration_min=5,
        duration_max=25,
        default_duration=10,
        resolutions=("768p",),
        seed_min=None,
        prompt_required=False,
        max_prompt_length=2048,
        video_required=True,
        uses_temporary_reference_urls=True,
        supports_subject=multiple,
        single_image_field=not multiple,
    )


WORKFLOWS = {
    TITI: character_replacement("H3全自动角色动迁替换", multiple=False),
    TITIM: character_replacement("H3全自动多角色动迁替换", multiple=True),
    PREFIX + "zm_nono": Workflow(
        "H3多图多音频生视频(影视画质)",
        audio_max=3,
        resolutions=("480p", "768p", "960p"),
        seed_min=None,
        flac=False,
    ),
    PREFIX + "zm_u30": Workflow(
        "H3多图多音频生视频(超清画质)",
        audio_max=3,
        resolutions=("480p", "768p", "960p"),
        seed_min=0,
    ),
    PREFIX + "zm_u24": Workflow(
        "H3多图多音频生视频(升级画质)", audio_max=3, square=True, seed_min=0
    ),
    PREFIX + "zm_u08": Workflow("H3多图多音频生视频(高速版)", audio_max=3, square=True, seed_min=0),
    PREFIX + "image_audio_to_video_v2_15s": Workflow(
        "H3多图多音频生视频15秒", images_min=0, audio_max=3
    ),
    PREFIX + "lightx2v_v5_15s": Workflow("H3多图生视频15秒", square=True),
    PREFIX + "image_audio_to_video_v2": Workflow(
        "H3多图多音频生视频",
        images_min=0,
        audio_max=3,
        duration_max=10,
        resolutions=("480p", "768p", "1080p"),
    ),
    PREFIX + "image_audio_to_video": Workflow(
        "H3图生视频-音频同步(自动对口型)",
        images_max=1,
        audio_min=1,
        audio_max=1,
        resolutions=("480p", "768p", "1080p"),
        seed_min=None,
        prompt=False,
    ),
    PREFIX + "lightx2v_v5": Workflow(
        "H3多图参考生视频", duration_max=10, resolutions=("480p", "768p", "1080p"), square=True
    ),
    PREFIX + "lightx2v_no_pic": Workflow(
        "H3文生视频", images_min=0, images_max=0, square=True, mode="text"
    ),
    PREFIX + "lightx2v": Workflow(
        "H3首尾帧生成视频", images_min=2, images_max=2, square=True, mode="frames"
    ),
    MOTION: Workflow(
        "动作迁移",
        images_max=1,
        resolutions=("464x832", "832x464"),
        prompt=False,
        video_required=True,
        single_image_field=True,
    ),
}


def profile(model: str) -> Workflow:
    if model not in WORKFLOWS:
        raise ValueError("AutoDL 不支持此工作流")
    return WORKFLOWS[model]


def uses_temporary_reference_urls(model: str) -> bool:
    return profile(model).uses_temporary_reference_urls


def reference_upload_url(
    provider_kind: str, model_slug: str, default_url: str, autodl_url: str
) -> str:
    if provider_kind == "autodl_video" and autodl_url:
        spec = WORKFLOWS.get(model_slug)
        if spec and spec.uses_temporary_reference_urls:
            return autodl_url
    return default_url


def require_reference_delivery(model: str, *, upload_configured: bool) -> None:
    if uses_temporary_reference_urls(model) and not upload_configured:
        raise ValueError("当前 AutoDL 工作流需要配置参考素材临时上传服务")


def capabilities(model: str, *, upload_configured: bool = False) -> VideoCapabilitiesOut:
    spec = profile(model)
    motion = model == MOTION
    ratios = ["9:16", "16:9"] + (["1:1"] if spec.square else [])
    return VideoCapabilitiesOut(
        duration_min=spec.duration_min,
        duration_max=spec.duration_max,
        default_duration=spec.default_duration,
        supports_auto_duration=False,
        resolutions=list(spec.resolutions),
        ratios=[] if motion else ratios,
        reference_limits={
            "image": spec.images_max,
            "audio": spec.audio_max,
            "video": int(spec.video_required),
        },
        reference_minimums={
            "image": spec.images_min,
            "audio": spec.audio_min,
            "video": int(spec.video_required),
        },
        reference_mime_types={
            "image": IMAGE_MIMES,
            "audio": AUDIO_MIMES if spec.flac else AUDIO_MIMES[:3],
            "video": ["video/mp4", "video/webm"],
        },
        audio_only=spec.images_min == 0,
        default_generate_audio=False,
        supported_modes=["text", "reference"]
        if spec.images_min == 0 and spec.audio_max
        else [spec.mode],
        supports_prompt=spec.prompt,
        prompt_required=spec.prompt and spec.prompt_required,
        max_prompt_length=spec.max_prompt_length,
        supports_duration=not motion,
        duration_label="音频截取时长" if not spec.prompt and not motion else "时长",
        supports_ratio=not motion,
        supports_watermark=False,
        supports_generate_audio=False,
        supports_seed=spec.seed_min is not None,
        seed_minimum=spec.seed_min or 0,
        default_resolution="464x832" if motion else "768p",
        default_ratio=None if motion else "9:16",
        resolution_ratios={
            resolution: (["9:16"] if resolution == "960p" else ratios)
            for resolution in spec.resolutions
        }
        if not motion
        else {},
        reference_video_upload_configured=not spec.uses_temporary_reference_urls
        or upload_configured,
        uses_temporary_reference_urls=spec.uses_temporary_reference_urls,
        supports_video_subject_to_replace=spec.supports_subject,
    )


def normalize_request(
    model: str, payload: dict[str, Any], *, explicit_fields: set[str] | None = None
) -> dict[str, Any]:
    spec, caps = profile(model), capabilities(model)
    result = dict(payload)
    if result.get("mode", "reference") not in caps.supported_modes:
        raise ValueError("当前 AutoDL 工作流不支持此生成模式")
    prompt = str(result.get("prompt") or "").strip()
    if spec.prompt:
        if spec.prompt_required and not prompt:
            raise ValueError("AutoDL 提示词不能为空")
        if len(prompt) > spec.max_prompt_length:
            raise ValueError(f"AutoDL 提示词最多支持 {spec.max_prompt_length} 个字符")
        result["prompt"] = prompt
    else:
        if prompt:
            raise ValueError("当前 AutoDL 工作流不支持提示词")
        result.pop("prompt", None)
    if model == MOTION:
        result.pop("duration", None)
        result.pop("ratio", None)
    else:
        duration = result.get("duration", spec.default_duration or 5)
        if spec.default_duration is not None and explicit_fields is not None:
            if "duration" not in explicit_fields:
                duration = spec.default_duration
        if type(duration) is not int or not spec.duration_min <= duration <= spec.duration_max:
            raise ValueError(
                f"当前 AutoDL 工作流时长必须为 {spec.duration_min} 至 {spec.duration_max} 秒"
            )
        result["duration"] = duration
        result["ratio"] = result.get("ratio") or caps.default_ratio
    result["resolution"] = result.get("resolution") or caps.default_resolution
    if result["resolution"] not in caps.resolutions or (
        caps.supports_ratio and result["ratio"] not in caps.resolution_ratios[result["resolution"]]
    ):
        raise ValueError("当前 AutoDL 工作流不支持此输出尺寸或比例")
    for kind, field in (
        ("image", "reference_asset_ids"),
        ("audio", "audio_asset_ids"),
        ("video", "video_asset_ids"),
    ):
        count = len(result.get(field) or [])
        if kind == "image" and spec.mode == "frames":
            count += bool(result.get("first_frame_asset_id")) + bool(
                result.get("last_frame_asset_id")
            )
        if not caps.reference_minimums[kind] <= count <= caps.reference_limits[kind]:
            label = {"image": "图片", "audio": "音频", "video": "视频"}[kind]
            raise ValueError(
                f"当前 AutoDL 工作流需要 {caps.reference_minimums[kind]} 至 "
                f"{caps.reference_limits[kind]} 个{label}"
            )
    if spec.mode == "frames" and not (
        result.get("first_frame_asset_id") and result.get("last_frame_asset_id")
    ):
        raise ValueError("AutoDL 首尾帧工作流必须同时提供首帧和尾帧")
    for name in ("watermark", "generate_audio"):
        if result.get(name) is not None:
            raise ValueError(f"当前 AutoDL 工作流不支持 {name}")
        result.pop(name, None)
    parameters = {
        k: v for k, v in (result.get("workflow_parameters") or {}).items() if v is not None
    }
    allowed = set()
    if spec.seed_min is not None:
        allowed.add("seed")
    if spec.supports_subject:
        allowed.add("video_subject_to_replace")
    if parameters.keys() - allowed:
        raise ValueError("当前 AutoDL 工作流不支持所选工作流参数")
    if "video_subject_to_replace" in parameters:
        subject = parameters.pop("video_subject_to_replace").strip()
        if subject:
            targets = [target.strip() for target in subject.split(",")]
            if any(
                not re.fullmatch(r"[A-Za-z0-9 '\-]+", target) or not re.search(r"[A-Za-z]", target)
                for target in targets
            ):
                raise ValueError("追踪对象请填写英文，多个对象用英文逗号分隔")
            parameters["video_subject_to_replace"] = ", ".join(targets)
    if spec.seed_min is not None:
        seed = parameters.get("seed")
        if seed is None:
            seed = spec.seed_min + secrets.randbelow(caps.seed_maximum - spec.seed_min + 1)
        if (
            isinstance(seed, bool)
            or not isinstance(seed, int)
            or not spec.seed_min <= seed <= caps.seed_maximum
        ):
            raise ValueError("AutoDL 随机种子超出当前工作流支持范围")
        parameters["seed"] = seed
    result["workflow_parameters"] = parameters
    return result


def validate_references(model: str, references: list[tuple[str, str, int]]) -> None:
    caps = capabilities(model)
    if sum(size for _, _, size in references) > MAX_REFERENCE_BYTES:
        raise ValueError("AutoDL 参考素材总大小不能超过 45 MB")
    for kind, mime, size in references:
        if kind in {"image", "audio"} and size > (30 if kind == "image" else 15) * 1024 * 1024:
            raise ValueError("AutoDL 单图最多 30 MB，单音频最多 15 MB")
        if mime not in caps.reference_mime_types.get(kind, []):
            raise ValueError("当前 AutoDL 工作流不支持此参考素材格式")


def prepare_payload(
    model: str, payload: dict[str, Any], content: list[dict[str, Any]]
) -> dict[str, Any]:
    spec = profile(model)
    resolution = payload["resolution"]
    if model == MOTION:
        resolution = {"464x832": "464*832px(竖版)", "832x464": "832*464px(横版)"}[resolution]
    else:
        resolution += {"9:16": "竖", "16:9": "横", "1:1": "(1:1)"}[payload["ratio"]]
    result: dict[str, Any] = {"resolution": resolution}
    if spec.prompt and payload.get("prompt"):
        result["prompt"] = payload["prompt"]
    subject = (payload.get("workflow_parameters") or {}).get("video_subject_to_replace")
    if spec.supports_subject and subject:
        result["video_subject_to_replace"] = subject
    if model != MOTION:
        result["duration" if spec.prompt else "audio_duration"] = payload["duration"]
    if spec.seed_min is not None:
        result["seed"] = payload["workflow_parameters"]["seed"]
    counters = {"image": 0, "audio": 0, "video": 0}
    for item in content:
        kind = item.get("type")
        if kind not in counters:
            continue
        value = item.get("url") if kind == "image" else item.get(f"{kind}_url")
        if not isinstance(value, str) or not value:
            raise ValueError("AutoDL 参考素材缺少有效内容")
        value = value.replace("data:audio/x-wav;", "data:audio/wav;", 1).replace(
            "data:audio/x-flac;", "data:audio/flac;", 1
        )
        if spec.uses_temporary_reference_urls:
            url = urlsplit(value)
            if url.scheme != "https" or not url.hostname or url.username or url.password:
                raise ValueError("当前 AutoDL 工作流的参考素材需要有效的 HTTPS URL")
        if kind == "video":
            name = "ref_video"
        elif kind == "image" and spec.single_image_field:
            name = "ref_image"
        elif spec.mode == "frames":
            name = item.get("role")
            if name not in {"first_frame", "last_frame"}:
                raise ValueError("AutoDL 首尾帧素材缺少明确角色")
        else:
            name = f"ref_{kind}_{counters[kind]}"
        result[name] = value
        counters[kind] += 1
    return result
