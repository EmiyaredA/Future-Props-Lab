"""Seedance version policy; entry points share validation, not provider wire data."""

from app.llm.schemas.video_capabilities import VideoCapabilitiesOut

SEEDANCE_MODELS = {
    "doubao-seedance-2-0-260128": "Seedance 2.0",
    "doubao-seedance-2-5-260628": "Seedance 2.5",
}
VIDEO_RATIOS = ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9", "adaptive"]


def video_capabilities(kind: str, slug: str, *, upload_configured=False):
    if kind != "volcengine_video":
        return None
    if slug not in SEEDANCE_MODELS:
        raise ValueError("方舟视频当前支持 Seedance 2.0 和 2.5 官方模型 ID")
    newer = slug == "doubao-seedance-2-5-260628"
    return VideoCapabilitiesOut(
        duration_max=30 if newer else 15,
        resolutions=["480p", "720p", "1080p"] + ([] if newer else ["4k"]),
        ratios=VIDEO_RATIOS,
        reference_limits={
            "image": 30 if newer else 9,
            "video": 10 if newer else 3,
            "audio": 10 if newer else 3,
        },
        audio_only=newer,
        frames_require_adaptive_ratio=newer,
        reference_video_upload_configured=upload_configured,
    )


def normalize_video_parameters(kind: str, slug: str, payload: dict) -> dict:
    result = dict(payload)
    caps = video_capabilities(kind, slug)
    duration = result.get("duration", 5)
    result["duration"] = duration
    if caps is None:
        # The shared request schema accepts the union; preserve older provider limits.
        if not 2 <= duration <= 15:
            raise ValueError("当前模型视频时长必须为 2–15 秒")
        if result.get("resolution") not in {None, "480p", "720p", "1080p"}:
            raise ValueError("当前模型不支持所选分辨率")
        if result.get("ratio") not in {None, *VIDEO_RATIOS[:5]}:
            raise ValueError("当前模型不支持所选比例")
        limits = {"reference_asset_ids": 9, "video_asset_ids": 3, "audio_asset_ids": 3}
    else:
        if duration != -1 and not caps.duration_min <= duration <= caps.duration_max:
            raise ValueError(f"当前模型视频时长必须为 4–{caps.duration_max} 秒或自动")
        for field, default in {
            "resolution": "720p",
            "ratio": "adaptive"
            if caps.frames_require_adaptive_ratio and result.get("mode") == "frames"
            else "16:9",
            "watermark": True,
            "generate_audio": True,
        }.items():
            if result.get(field) is None:
                result[field] = default
        if result["resolution"] not in caps.resolutions:
            raise ValueError("当前模型不支持所选分辨率")
        if result["ratio"] not in caps.ratios:
            raise ValueError("当前模型不支持所选比例")
        if caps.frames_require_adaptive_ratio and result.get("mode") == "frames":
            if result["ratio"] != "adaptive":
                raise ValueError("Seedance 2.5 首帧及首尾帧模式必须使用自适应比例")
        limits = {
            "reference_asset_ids": caps.reference_limits["image"],
            "video_asset_ids": caps.reference_limits["video"],
            "audio_asset_ids": caps.reference_limits["audio"],
        }
    for field, limit in limits.items():
        if len(result.get(field) or []) > limit:
            label = {
                "reference_asset_ids": "参考图片",
                "video_asset_ids": "参考视频",
                "audio_asset_ids": "参考音频",
            }[field]
            raise ValueError(f"当前模型最多支持 {limit} 个{label}")
    if (
        (not caps or not caps.audio_only)
        and result.get("audio_asset_ids")
        and not (result.get("reference_asset_ids") or result.get("video_asset_ids"))
    ):
        raise ValueError("参考音频必须搭配参考图片或视频")
    return result
