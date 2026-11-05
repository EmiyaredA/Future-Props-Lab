"""Calculate the positions of a Visual review's requested video interval."""

from app.capabilities.media_rendering.sample_positions import review_positions
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError


def positions(duration_ms, start=0, end=None):
    try:
        return review_positions(duration_ms, start, end)
    except ValueError as exc:
        raise AcceptanceError(str(exc)) from exc


def check_specifications(metadata, config):
    failures = []
    for name, field in (("宽度", "width"), ("高度", "height")):
        target = config.get("min_" + field)
        if target and metadata[field] < target:
            failures.append(f"{name}小于 {target}")
    if config.get("ratio"):
        width, height = map(int, config["ratio"].split(":"))
        if abs(metadata["width"] / metadata["height"] - width / height) > 0.02:
            failures.append("画幅不符合要求")
    duration = metadata.get("duration_ms", 0) / 1000
    if config.get("min_duration") is not None and duration < config["min_duration"]:
        failures.append("时长不足")
    if config.get("max_duration") is not None and duration > config["max_duration"]:
        failures.append("时长过长")
    if config.get("require_audio") and not metadata.get("has_audio"):
        failures.append("缺少音轨")
    return (
        ("failed", "；".join(failures))
        if failures
        else ("passed", "文件可解码，已启用的规格条件均满足。")
    )
