"""Human sprites share the existing data-only import envelope and tenant boundary."""

from __future__ import annotations

import copy
import io
import json
import zipfile

import httpx
import pytest
from PIL import Image

from app.apps.desktop_pet.projects import DesktopPetProjects, PetNotFound
from app.apps.desktop_pet.whale_package import read_whale_package
from app.main import app
from app.runtime.db import SessionLocal


def human_model() -> dict:
    parents = {
        "hair_back": "hair",
        "hair_front": "bangs",
        "face": "head",
        "torso": "body",
        "coat": "coat",
        "arm_near": "armNear",
        "arm_far": "armFar",
        "leg_back": "legBack",
        "leg_front": "legFront",
        "sit_lower": "body",
    }
    return {
        "rigProfile": "human-chibi",
        "character": {"name": "牧濑红莉栖", "persona": {"personality": "聪明、理性，有一点傲娇"}},
        "units": {"S": 1, "X0": 128, "FEET": 256},
        "view": [0, -8, 256, 280],
        "pivots": {
            name: [128, 128]
            for name in ("body", "neck", "armNear", "armFar", "legBack", "legFront")
        },
        "parts": [
            {
                "id": name,
                "tex": name,
                "parent": parent,
                "z": index,
                "box": [64, 64, 64, 64],
                "grid": [2, 2],
            }
            for index, (name, parent) in enumerate(parents.items())
        ],
        "feat": {
            "sprites": {
                name: [96, 96, 112, 112]
                for name in (
                    "eyes",
                    "closed_eyes",
                    "angry_eyes",
                    "surprised_eyes",
                    "brows",
                    "neutral_mouth",
                    "happy_mouth",
                )
            }
        },
        "schemes": [{"id": "kurisu-classic", "brand": "牧濑红莉栖", "label": "经典便服"}],
    }


def archive(model: dict, extra: tuple[str, bytes] | None = None) -> bytes:
    png = io.BytesIO()
    Image.new("RGBA", (16, 16), (150, 75, 55, 255)).save(png, format="PNG")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr(
            "manifest.json", json.dumps({"format": "fpl-coopanion-whale", "version": 1})
        )
        package.writestr("model.json", json.dumps(model))
        for name in (
            {f"tex/{part['tex']}.png" for part in model["parts"]}
            | {f"feat/{name}.png" for name in model["feat"]["sprites"]}
            | {"thumbs/kurisu-classic.png"}
        ):
            package.writestr(name, png.getvalue())
        if extra:
            package.writestr(*extra)
    return output.getvalue()


@pytest.mark.parametrize(
    "mutation",
    [
        lambda m: m.update(rigProfile="uploaded-code"),
        lambda m: m.update(character={"name": "  "}),
        lambda m: m.update(view=[-8192, -8, 8192, 280]),
        lambda m: m["parts"][0].update(parent="arbitrary"),
        lambda m: m["parts"].append(copy.deepcopy(m["parts"][0])),
        lambda m: m["parts"][0].update(box=[0, 0, -10, 100]),
        lambda m: m["feat"]["sprites"].update(eyes=[96, 96, 112, float("inf")]),
        lambda m: m["feat"]["sprites"].pop("closed_eyes"),
        lambda m: m["parts"].pop(0),
    ],
)
def test_rejects_invalid_human_rig(mutation):
    model = human_model()
    mutation(model)
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


@pytest.mark.parametrize("extra", [("run.js", b"alert(1)"), ("../escape.png", b"bad")])
def test_human_import_remains_data_only(extra):
    with pytest.raises(ValueError):
        read_whale_package(archive(human_model(), extra))


@pytest.mark.asyncio
async def test_human_import_name_thumbnail_defaults_cas_and_workspace_isolation():
    model = human_model()
    assert "tail" not in {part["id"] for part in model["parts"]}
    data = archive(model)
    assert read_whale_package(data).model == model
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("kurisu.zip", data, "application/zip")},
        )
        assert created.status_code == 200, created.text
        project = created.json()
        assert project["title"] == project["sourceTitle"] == "牧濑红莉栖"
        assert project["sourceType"] == "coopanion-whale"
        assert (await client.get(project["thumbnailUrl"])).status_code == 200
        base = f"/v1/desktop-pet/projects/{project['id']}"
        document = (await client.get(f"{base}/document")).json()
        assert document["whaleModel"]["rigProfile"] == "human-chibi"
        config = document["config"]
        assert config["schemeId"] == "kurisu-classic"
        assert config["events"]["pet"]["expressionId"] == "shy"
        assert config["persona"]["personality"] == model["character"]["persona"]["personality"]
        chat = (await client.get(f"{base}/chat")).json()
        assert chat["proactiveLinesEnabled"] is False
        saved = await client.put(f"{base}/document", json={"expectedRevision": 0, "config": config})
        assert saved.status_code == 200, saved.text
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 0, "config": config})
        ).status_code == 409
        bad = copy.deepcopy(config)
        bad["schemeId"] = "deepseek"
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 1, "config": bad})
        ).status_code == 422
        assert (await client.get(f"{base}/document")).json()["config"] == config
        async with SessionLocal() as session:
            with pytest.raises(PetNotFound):
                await DesktopPetProjects(session, "another-workspace").get(project["id"])
