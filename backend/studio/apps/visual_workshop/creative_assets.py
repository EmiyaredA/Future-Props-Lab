"""Validate opaque managed asset references without importing the Assets store."""

import re

from studio.runtime.project_errors import ProjectResourceError

MODEL_PATH = re.compile(r"assets/project-models/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.glb")
MODEL_MIME = "model/gltf-binary"


def model_id(path):
    match = MODEL_PATH.fullmatch(path) if isinstance(path, str) else None
    return match[1] if match else None


def model_path(asset_id):
    return f"assets/project-models/{asset_id}.glb"


def scene_model_assets(document):
    return {
        identity
        for object_ in document.get("objects", [])
        if isinstance(object_, dict) and isinstance(object_.get("asset"), dict)
        if (identity := model_id(object_["asset"].get("path")))
    }


def remap_scene_models(document, asset_ids):
    from copy import deepcopy

    result = deepcopy(document)
    for object_ in result["objects"]:
        if identity := model_id(object_.get("asset", {}).get("path")):
            object_["asset"]["path"] = model_path(asset_ids[identity])
            object_["asset"]["id"] = f"project-model-{asset_ids[identity]}"
    return result


async def require_project_assets(project_id, *, inspect, images=(), models=()):
    images, models = set(images), set(models)
    if not images and not models:
        return
    if inspect is None:
        raise ProjectResourceError("项目素材校验未配置", "visual_asset_scope_unavailable", 503)
    if len(images | models) > 500:
        raise ProjectResourceError("关联素材数量超过限制", "visual_asset_scope_limit", 422)
    found = await inspect(project_id, images | models)
    if any(found.get(identity, ("", ""))[0] != "image" for identity in images) or any(
        found.get(identity, ("", ""))[1] != MODEL_MIME for identity in models
    ):
        raise ProjectResourceError(
            "素材已删除、类型不符或不属于当前项目", "visual_asset_scope", 422
        )
