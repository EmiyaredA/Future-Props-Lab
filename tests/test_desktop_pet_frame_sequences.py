"""Complete-frame packages keep one physical scale and a checked per-outfit atlas closure."""

from __future__ import annotations

import copy
import io
import zipfile

import httpx
import pytest
from PIL import Image

from app.apps.desktop_pet.frame_sequences import validate_frame_sequences
from app.apps.desktop_pet.whale_package import read_whale_package
from app.main import app
from test_desktop_pet_human import archive, human_model
from test_desktop_pet_motion_rig import segmented_model


def frame_sequences():
    frame = {
        "texture": "sequence_atlas",
        "rect": [0, 0, 16, 16],
        "durationMs": 40,
        "grip": [8, 8],
        "foot": [8, 16],
        "head": [[8, 0], [8, 6]],
    }
    return {
        "version": 1,
        "frameSize": [16, 16],
        "modelBox": [-16, 0, 32, 32],
        "headLength": 12,
        "clips": {
            "idle": {"frames": [frame], "loop": True},
            "walk": {
                "frames": [dict(frame, rect=[16, 0, 16, 16])],
                "loop": True,
                "distancePerCycle": 32,
            },
            "start": {"frames": [copy.deepcopy(frame)], "loop": False},
        },
        "transitions": [{"id": "idle-walk", "from": "idle", "to": "walk", "clip": "start"}],
    }


def sequence_model(rig=False):
    model = segmented_model() if rig else human_model()
    model["schemes"].extend([{"id": "kurisu-lab"}, {"id": "kurisu-maid"}])
    model["frameSequences"] = frame_sequences()
    return model


def sequence_archive(model, *, missing=None, dimensions=None):
    with zipfile.ZipFile(io.BytesIO(archive(model))) as source:
        entries = {name: source.read(name) for name in source.namelist()}
    for index, scheme in enumerate(model["schemes"]):
        prefix = "" if index == 0 else f"schemes/{scheme['id']}/"
        path = f"{prefix}tex/sequence_atlas.png"
        if path == missing:
            continue
        png = io.BytesIO()
        size = (dimensions or {}).get(path, (32, 16))
        Image.new("RGBA", size, (150, 75, 55, 255)).save(png, format="PNG")
        entries[path] = png.getvalue()
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as package:
        for name, data in entries.items():
            package.writestr(name, data)
    return result.getvalue()


@pytest.mark.parametrize("rig", [False, True])
def test_full_sequences_register_independent_atlas_for_all_three_outfits_and_keep_old_rig(rig):
    model = sequence_model(rig)
    result = read_whale_package(sequence_archive(model))
    assert result.model == model
    assert validate_frame_sequences(model) == {"sequence_atlas"}
    for path in (
        "tex/sequence_atlas.png",
        "schemes/kurisu-lab/tex/sequence_atlas.png",
        "schemes/kurisu-maid/tex/sequence_atlas.png",
    ):
        assert path in result.images
    assert "sequence_atlas" not in {part["tex"] for part in model["parts"]}


@pytest.mark.parametrize(
    "path",
    [
        "tex/sequence_atlas.png",
        "schemes/kurisu-lab/tex/sequence_atlas.png",
        "schemes/kurisu-maid/tex/sequence_atlas.png",
    ],
)
def test_every_outfit_requires_its_declared_actual_atlas(path):
    with pytest.raises(ValueError, match="贴图缺失"):
        read_whale_package(sequence_archive(sequence_model(), missing=path))


@pytest.mark.parametrize(
    "dimensions",
    [
        {
            "tex/sequence_atlas.png": (16, 16),
            "schemes/kurisu-lab/tex/sequence_atlas.png": (16, 16),
            "schemes/kurisu-maid/tex/sequence_atlas.png": (16, 16),
        },
        {"schemes/kurisu-lab/tex/sequence_atlas.png": (48, 16)},
    ],
)
def test_actual_rect_bounds_and_variant_layout_are_checked(dimensions):
    with pytest.raises(ValueError):
        read_whale_package(sequence_archive(sequence_model(), dimensions=dimensions))


@pytest.mark.parametrize(
    "location,key,value",
    [
        ("top", "version", True),
        ("top", "version", 2),
        ("top", "modelBox", [0, 0, 32, 30]),
        ("top", "modelBox", [0, 0, 0, 0]),
        ("top", "frameSize", [16.5, 16]),
        ("top", "headLength", 0),
        ("top", "scale", 2),
        ("top", "transitions", None),
        ("clip", "loop", 1),
        ("clip", "distancePerCycle", 0),
        ("clip", "frames", []),
        ("frame", "texture", "../outside"),
        ("frame", "texture", "https://outside"),
        ("frame", "rect", [0, 0, 15, 16]),
        ("frame", "rect", [0.1, 0, 16, 16]),
        ("frame", "durationMs", 0),
        ("frame", "durationMs", 60001),
        ("frame", "durationMs", float("inf")),
        ("frame", "grip", [-1, 8]),
        ("frame", "foot", [8, 17]),
        ("frame", "head", [[8, 0], [8, 8]]),
        ("frame", "head", [[8, 0], [8, 0]]),
        ("frame", "head", [[8, 0], [8, 16.1]]),
        ("frame", "box", [0, 0, 32, 32]),
        ("frame", "scale", 1),
        ("frame", "contacts", {"middle": [8, 8]}),
        ("frame", "contacts", {"top": [17, 0]}),
        ("frame", "supports", {"neck": [8, 8]}),
        ("frame", "supports", {"armNear": [8, -1]}),
    ],
)
def test_illegal_namespace_geometry_and_frame_metadata_are_rejected(location, key, value):
    model = sequence_model()
    seq = model["frameSequences"]
    target = seq if location == "top" else seq["clips"]["idle"]
    if location == "frame":
        target = target["frames"][0]
    target[key] = value
    with pytest.raises(ValueError):
        read_whale_package(sequence_archive(model))


@pytest.mark.parametrize(
    "fault",
    [
        "missing-idle",
        "missing-transitions",
        "invalid-block",
        "unknown-transition",
        "missing-clip",
        "duplicate-id",
        "duplicate-pair",
    ],
)
def test_initialization_and_transition_references_are_explicit(fault):
    model = sequence_model()
    seq = model["frameSequences"]
    if fault == "missing-idle":
        seq["clips"].pop("idle")
    elif fault == "missing-transitions":
        seq.pop("transitions")
    elif fault == "invalid-block":
        model["frameSequences"] = None
    elif fault == "unknown-transition":
        seq["transitions"][0]["hardCut"] = True
    elif fault == "missing-clip":
        seq["transitions"][0]["to"] = "held"
    elif fault == "duplicate-id":
        seq["transitions"].append(
            {"id": "idle-walk", "from": "walk", "to": "idle", "clip": "start"}
        )
    else:
        seq["transitions"].append({"id": "other", "from": "idle", "to": "walk", "clip": "start"})
    with pytest.raises(ValueError):
        read_whale_package(sequence_archive(model))


@pytest.mark.parametrize("bound", ["clips", "per-clip", "total", "transitions"])
def test_description_count_limits_are_independent_of_existing_zip_budgets(bound):
    seq = frame_sequences()
    clip = copy.deepcopy(seq["clips"]["idle"])
    if bound == "clips":
        seq["clips"].update({f"clip_{n}": copy.deepcopy(clip) for n in range(64)})
    elif bound == "per-clip":
        seq["clips"]["idle"]["frames"] *= 129
    elif bound == "total":
        clip["frames"] *= 128
        seq["clips"] = {"idle": clip, **{f"clip_{n}": copy.deepcopy(clip) for n in range(16)}}
    else:
        seq["transitions"] *= 129
    with pytest.raises(ValueError):
        validate_frame_sequences({"frameSequences": seq})


def test_head_two_percent_bound_and_local_supports_do_not_automatically_claim_edges():
    model = sequence_model()
    frame = model["frameSequences"]["clips"]["idle"]["frames"][0]
    frame["head"][1][1] = 6.12
    frame["contacts"] = {"top": [8, 0], "bottom": [8, 16]}
    frame["supports"] = {"armNear": [8, 0], "legBack": [8, 16]}
    assert read_whale_package(sequence_archive(model)).model == model
    frame["head"][1][1] = 6.121
    with pytest.raises(ValueError, match="头部比例"):
        read_whale_package(sequence_archive(model))


@pytest.mark.asyncio
async def test_invalid_sequence_import_and_cas_replacement_preserve_saved_document():
    model = sequence_model()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("sequence.zip", sequence_archive(model), "application/zip")},
        )
        assert created.status_code == 200, created.text
        base = f"/v1/desktop-pet/projects/{created.json()['id']}"
        baseline = (await client.get(f"{base}/document")).json()
        model["frameSequences"]["clips"]["walk"]["frames"][0]["head"] = [[8, 0], [8, 8]]
        invalid = sequence_archive(model)
        response = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("invalid.zip", invalid, "application/zip")},
        )
        assert response.status_code == 422, response.text
        response = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": str(baseline["revision"])},
            files={"file": ("invalid.zip", invalid, "application/zip")},
        )
        assert response.status_code == 422, response.text
        assert (await client.get(f"{base}/document")).json() == baseline


def test_old_package_without_sequence_block_is_unchanged():
    model = human_model()
    assert validate_frame_sequences(model) == set()
    assert read_whale_package(archive(model)).model == model


def test_valid_maximum_description_does_not_relax_the_model_json_size_budget():
    model = sequence_model()
    seq = model["frameSequences"]
    clip = copy.deepcopy(seq["clips"]["idle"])
    clip["frames"] *= 128
    seq["clips"] = {"idle": clip, **{f"clip_{n}": copy.deepcopy(clip) for n in range(15)}}
    seq["transitions"] = []
    assert validate_frame_sequences(model) == {"sequence_atlas"}
    with pytest.raises(ValueError, match="模型过大"):
        read_whale_package(sequence_archive(model))
