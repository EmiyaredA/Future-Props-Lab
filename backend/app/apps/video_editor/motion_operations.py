"""Build the same top-track insertion for Motion exports in both assemblies."""

from pathlib import Path


def motion_operations(document, *, asset_id, filename, duration_us, track_id, clip_id):
    tracks = document["tracks"]
    operations = [
        {"type": "reorderTrack", "trackId": track["id"], "order": track["order"] + 1}
        for track in sorted(tracks, key=lambda track: track["order"], reverse=True)
    ]
    operations.extend(
        [
            {
                "type": "addTrack",
                "track": {
                    "id": track_id,
                    "kind": "visual",
                    "name": "特效制作",
                    "order": 0,
                    "clips": [],
                },
            },
            {
                "type": "addClip",
                "clip": {
                    "id": clip_id,
                    "trackId": track_id,
                    "kind": "video",
                    "name": Path(filename).stem,
                    "timelineStartUs": 0,
                    "durationUs": duration_us,
                    "sourceInUs": 0,
                    "assetId": asset_id,
                    "fitMode": "contain",
                    "transform": {
                        "x": 960,
                        "y": 540,
                        "scaleX": 1,
                        "scaleY": 1,
                        "rotation": 0,
                        "opacity": 1,
                    },
                },
            },
        ]
    )
    return operations
