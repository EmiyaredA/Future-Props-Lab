"""Build the standard 1080p timeline for baking a video's chroma settings."""

from studio.contracts.video_editor.timeline_document import parse_timeline_document


def bake_video_document(source_asset, name, duration_us, clip_id, chroma):
    return parse_timeline_document(
        {
            "settings": {"width": 1920, "height": 1080, "fps": 30, "backgroundColor": "#000000"},
            "tracks": [
                {
                    "id": "bake-visual",
                    "kind": "visual",
                    "name": "画面",
                    "order": 0,
                    "clips": [
                        {
                            "id": clip_id,
                            "trackId": "bake-visual",
                            "kind": "video",
                            "name": name,
                            "timelineStartUs": 0,
                            "durationUs": max(1, duration_us),
                            "assetId": source_asset,
                            "fitMode": "contain",
                            "muted": True,
                            "chromaKey": chroma.model_dump(mode="json", by_alias=True),
                        }
                    ],
                }
            ],
        }
    )
