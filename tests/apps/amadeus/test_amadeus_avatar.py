from __future__ import annotations

import hashlib
from pathlib import Path
from statistics import median

from PIL import Image

from studio.apps.media_rendering.local.live2d.bundle import read_package
from studio.apps.media_rendering.local.live2d.evaluate import parameter_values
from studio.apps.media_rendering.local.live2d.idle import idle_pose
from studio.apps.media_rendering.local.live2d.render import render_frame

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / "web/public/brand/amadeus/amadeus.fpllive2d"
POSTER = ROOT / "web/public/brand/amadeus/amadeus-poster.png"
STAGE = ROOT / "web/public/brand/amadeus/amadeus-stage-poster.png"
STATES = ("idle", "listening", "thinking", "tool", "success", "error", "paused")


def test_bundled_amadeus_has_editable_layers_and_seven_distinct_poses(tmp_path: Path) -> None:
    title, document, assets = read_package(PACKAGE.read_bytes())
    assert title == "红莉栖 · Amadeus"
    assert document.schema_version == 3
    assert len(document.parts) >= 18
    assert len(document.bones) >= 12
    assert all(part.skin_weights for part in document.parts)
    assert set(document.cameras) == {"avatar", "stage"}
    assert set(document.state_bindings) == set(STATES)
    paths = {}
    for asset_id, (png, _, _) in assets.items():
        path = tmp_path / f"{asset_id}.png"
        path.write_bytes(png)
        paths[asset_id] = path
    with Image.open(POSTER) as poster:
        assert poster.size == (512, 512)
        assert poster.mode == "RGBA"
        assert poster.getpixel((0, 0))[3] == 0
        alpha = poster.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
        head_rows = [alpha.crop((0, y, poster.width, y + 1)).getbbox() for y in range(65, 225)]
        centers = [(bounds[0] + bounds[2]) / 2 for bounds in head_rows if bounds]
        assert len(centers) == len(head_rows)
        assert abs(median(centers) - poster.width / 2) <= 2
    with Image.open(STAGE) as stage:
        assert stage.size == (512, 768)
        assert stage.getbbox()

    signatures = set()
    for state in STATES:
        binding = document.state_bindings[state]
        motion = next(item for item in document.motions if item.id == binding.motion_id)
        expression = next(item for item in document.expressions if item.id == binding.expression_id)
        assert {track.parameter_id for track in motion.tracks}.isdisjoint(expression.values)
        values = parameter_values(document, motion.duration // 2, motion.id, expression.id)
        assert all(
            parameter.minimum <= values[parameter.id] <= parameter.maximum
            for parameter in document.parameters
        )
        for size in (48, 76):
            avatar = document.cameras["avatar"]
            frame = render_frame(
                document,
                paths,
                frame=motion.duration // 2,
                motion_id=motion.id,
                expression_id=expression.id,
                width=size,
                height=size,
                crop=(avatar.x, avatar.y, avatar.width, avatar.height),
            )
            assert frame.getbbox()
            if size == 76:
                signatures.add(hashlib.sha256(frame.tobytes()).hexdigest())
    assert len(signatures) == len(STATES)


def test_idle_pose_respects_active_tracks_and_bone_weights() -> None:
    _, document, _ = read_package(PACKAGE.read_bytes())
    binding = document.state_bindings["idle"]
    values = parameter_values(document, 0, binding.motion_id, binding.expression_id)
    idle, rotations = idle_pose(document, values, 1700, binding.motion_id, binding.expression_id)
    assert idle["ParamAngleX"] == values["ParamAngleX"]
    assert idle["ParamBreath"] != values["ParamBreath"]
    assert set(rotations) == set(document.idle_behavior.spring_bones)
