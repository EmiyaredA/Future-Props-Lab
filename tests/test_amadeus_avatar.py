from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest
from PIL import Image

from app.apps.live2d_workshop.packages import read_package
from app.capabilities.media_rendering.live2d.evaluate import parameter_values
from app.capabilities.media_rendering.live2d.idle import idle_pose
from app.capabilities.media_rendering.live2d.render import render_frame
from app.main import app

ROOT = Path(__file__).resolve().parents[1]
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


@pytest.mark.asyncio
async def test_bundled_amadeus_round_trips_through_workshop_api() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        imported = await client.post(
            "/v1/live2d-workshop/projects/import",
            files={"file": ("Amadeus.fpllive2d", PACKAGE.read_bytes(), "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        project_id = imported.json()["id"]
        base = f"/v1/live2d-workshop/projects/{project_id}"
        snapshot = (await client.get(f"{base}/document")).json()
        document = snapshot["document"]
        assert set(document["stateBindings"]) == set(STATES)
        assert len(document["parts"]) >= 12
        document["parameters"][0]["name"] = "头部侧倾（已编辑）"
        saved = await client.put(
            f"{base}/document",
            json={"expectedRevision": snapshot["revision"], "document": document},
        )
        assert saved.status_code == 200, saved.text
        exported = await client.get(f"{base}/package")
        assert exported.status_code == 200, exported.text
        _, again, assets = read_package(exported.content)
        assert set(again.state_bindings) == set(STATES)
        assert len(assets) >= 12
        reimported = await client.post(
            "/v1/live2d-workshop/projects/import",
            files={"file": ("Amadeus-edited.fpllive2d", exported.content, "application/zip")},
        )
        assert reimported.status_code == 200, reimported.text
        reopened = (
            await client.get(f"/v1/live2d-workshop/projects/{reimported.json()['id']}/document")
        ).json()["document"]
        assert reopened["parameters"][0]["name"] == "头部侧倾（已编辑）"
        assert set(reopened["stateBindings"]) == set(STATES)
