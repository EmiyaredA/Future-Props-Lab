"""Apply one complete, ordered segment receipt to the owning task and project."""

from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata


async def settle_segments(session, task, outputs, *, handoff=None):
    expected = task.result_detail["segments"]
    configuration = task.request_payload["segments"]
    if task.kind != "segment_export" or len({item.asset.id for item in outputs}) != len(outputs):
        raise ValueError("分段导出回执范围不符")
    segments, results = [], []
    node_ids = handoff["node_ids"] if handoff else [None] * len(outputs)
    for source, config, file, node_id in zip(
        expected, configuration, outputs, node_ids, strict=True
    ):
        asset = file.asset
        if handoff is None:
            if await session.get(VideoEditorAssetMetadata, asset.id) is not None:
                raise ValueError("分段导出素材标识冲突")
            session.add(
                VideoEditorAssetMetadata(
                    asset_id=asset.id,
                    project_id=task.project_id,
                    processing_status="ready",
                    probe=file.probe,
                    fingerprint=file.sha256,
                )
            )
        spec = {key: config[key] for key in ("resolution", "fps", "quality", "audioMode")}
        segments.append(
            {
                **source,
                "status": "completed",
                "progress": 100,
                "assetId": asset.id,
                "nodeId": node_id,
                "outputFilename": asset.original_filename,
                "outputProbe": file.probe,
                "spec": spec,
            }
        )
        results.append(
            {"name": source["name"], "assetId": asset.id, "nodeId": node_id, "spec": spec}
        )
    task.result_detail = {
        **task.result_detail,
        "targetProjectId": handoff["project_id"] if handoff else None,
        "segments": segments,
        "results": results,
    }
