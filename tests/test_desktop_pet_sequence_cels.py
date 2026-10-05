"""A global cel registry reuses exact frames without rewriting uploaded packages."""

from __future__ import annotations

import copy
import io
import json
import zipfile

import httpx
import pytest
from PIL import Image

from app.apps.desktop_pet.frame_sequences import validate_frame_sequences
from app.apps.desktop_pet.whale_package import read_whale_package
from app.main import app
from test_desktop_pet_frame_sequences import sequence_archive, sequence_model
from test_desktop_pet_sequence_ranges import range_model


def cel_model():
    model = range_model()
    seq = model["frameSequences"]
    registry = {}
    for clip in seq["clips"].values():
        frames = []
        for index, frame in enumerate(clip["frames"]):
            # Mix inline declarations and references. Identical cels may have
            # separate IDs; neither ID nor texture is a part registration.
            if index % 2:
                frames.append(copy.deepcopy(frame))
            else:
                key = next((key for key, value in registry.items() if value == frame), None)
                if key is None:
                    key = f"cel_{len(registry)}"
                    registry[key] = copy.deepcopy(frame)
                frames.append(key)
        clip["frames"] = frames
    registry["constructor"] = dict(copy.deepcopy(next(iter(registry.values()))), texture="unused")
    seq["cels"] = registry
    return model


def cel_archive(model, *, missing=None, dimensions=None):
    sizes = {
        f"{'schemes/' + scheme['id'] + '/' if index else ''}tex/sequence_atlas.png": (64, 16)
        for index, scheme in enumerate(model["schemes"])
    }
    with zipfile.ZipFile(io.BytesIO(sequence_archive(model, dimensions=sizes))) as source:
        entries = {name: source.read(name) for name in source.namelist()}
    for index, scheme in enumerate(model["schemes"]):
        path = f"{'schemes/' + scheme['id'] + '/' if index else ''}tex/unused.png"
        png = io.BytesIO()
        Image.new("RGBA", (dimensions or {}).get(path, (64, 16)), (90, 70, 50, 255)).save(
            png, format="PNG"
        )
        entries[path] = png.getvalue()
    if missing:
        entries.pop(missing, None)
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as package:
        for name, value in entries.items():
            package.writestr(name, value)
    return result.getvalue()


def test_registry_mixed_frames_ranges_and_all_outfits_preserve_raw_upload_without_mutation():
    model = cel_model()
    before = json.dumps(model, sort_keys=True)
    result = read_whale_package(cel_archive(model))
    assert json.dumps(model, sort_keys=True) == before
    assert result.model == model
    assert isinstance(result.model["frameSequences"]["clips"]["idle"]["frames"][0], str)
    assert validate_frame_sequences(model) == {"sequence_atlas", "unused"}
    assert "unused" not in {part["tex"] for part in result.model["parts"]}
    for index, scheme in enumerate(model["schemes"]):
        prefix = f"schemes/{scheme['id']}/" if index else ""
        assert f"{prefix}tex/unused.png" in result.images


@pytest.mark.parametrize("registry", [None, [], "cel_0", True, {"a": "cel_0"}, {"../a": {}}])
def test_registry_only_accepts_safe_own_ids_and_complete_frames(registry):
    model = cel_model()
    model["frameSequences"]["cels"] = registry
    with pytest.raises(ValueError):
        validate_frame_sequences(model)


@pytest.mark.parametrize(
    "value",
    ["absent", "toString", "__proto__", None, {"cel": "cel_0"}, {"ref": "cel_0", "durationMs": 80}],
)
def test_references_cannot_alias_override_or_resolve_missing_own_entries(value):
    model = cel_model()
    model["frameSequences"]["clips"]["idle"]["frames"][0] = value
    with pytest.raises(ValueError):
        validate_frame_sequences(model)


def test_safe_prototype_like_id_is_valid_only_when_explicitly_declared():
    model = sequence_model()
    frame = copy.deepcopy(model["frameSequences"]["clips"]["idle"]["frames"][0])
    model["frameSequences"]["cels"] = {"constructor": frame}
    model["frameSequences"]["clips"]["idle"]["frames"] = ["constructor"]
    assert read_whale_package(sequence_archive(model)).model == model


def test_absent_or_empty_registry_keeps_inline_legacy_packages_and_rejects_string_frames():
    model = sequence_model()
    assert read_whale_package(sequence_archive(model)).model == model
    model["frameSequences"]["cels"] = {}
    assert read_whale_package(sequence_archive(model)).model == model
    model["frameSequences"]["clips"]["idle"]["frames"] = ["missing"]
    with pytest.raises(ValueError):
        validate_frame_sequences(model)
    model["frameSequences"].pop("cels")
    with pytest.raises(ValueError):
        validate_frame_sequences(model)


@pytest.mark.parametrize(
    "key,value",
    [
        ("durationMs", False),
        ("durationMs", 0),
        ("durationMs", float("inf")),
        ("grip", [float("nan"), 1]),
        ("foot", [8, 17]),
        ("head", [[8, 0], [8, 7]]),
        ("rect", [0, 0, 15, 16]),
        ("rect", [0.5, 0, 16, 16]),
        ("texture", "../outside"),
        ("scale", 1),
        ("box", [0, 0, 16, 16]),
        ("ref", "cel_0"),
        ("contacts", {"left": [17, 8]}),
        ("supports", {"unknown": [8, 8]}),
    ],
)
def test_unused_cels_have_the_same_finite_head_bounds_and_strict_frame_validation(key, value):
    model = cel_model()
    model["frameSequences"]["cels"]["constructor"][key] = value
    with pytest.raises(ValueError):
        validate_frame_sequences(model)


@pytest.mark.parametrize("index", [0, 1, 2])
def test_unused_registry_textures_are_required_in_every_authorized_outfit(index):
    model = cel_model()
    scheme = model["schemes"][index]
    prefix = f"schemes/{scheme['id']}/" if index else ""
    with pytest.raises(ValueError, match="贴图缺失"):
        read_whale_package(cel_archive(model, missing=f"{prefix}tex/unused.png"))


def test_unused_real_png_rect_is_checked_even_when_all_outfits_share_the_same_wrong_size():
    model = cel_model()
    model["frameSequences"]["cels"]["constructor"]["rect"] = [48, 0, 16, 16]
    dimensions = {
        f"{'schemes/' + scheme['id'] + '/' if index else ''}tex/unused.png": (32, 16)
        for index, scheme in enumerate(model["schemes"])
    }
    with pytest.raises(ValueError, match="实际范围"):
        read_whale_package(cel_archive(model, dimensions=dimensions))


@pytest.mark.parametrize("field", ["rect", "grip", "foot", "head", "contacts", "supports"])
def test_range_endpoints_resolve_registry_frames_and_still_check_all_registration_metadata(field):
    model = cel_model()
    seq = model["frameSequences"]
    branch = seq["transitions"][-1]["branches"][0]
    frame = seq["clips"][branch["clip"]]["frames"][branch["range"][0]]
    frame = copy.deepcopy(seq["cels"][frame] if isinstance(frame, str) else frame)
    if field == "rect":
        frame[field][0] += 16
    elif field == "head":
        for point in frame[field]:
            point[0] += 1
    elif field in {"contacts", "supports"}:
        frame[field] = {"bottom" if field == "contacts" else "legBack": [9, 16]}
    else:
        frame[field][0] += 1
    seq["cels"]["mismatched"] = frame
    seq["clips"][branch["clip"]]["frames"][branch["range"][0]] = "mismatched"
    with pytest.raises(ValueError, match="首尾画面与锚点登记"):
        validate_frame_sequences(model)


def test_registry_declarations_and_every_use_share_the_existing_2048_budget():
    model = sequence_model()
    seq = model["frameSequences"]
    frame = copy.deepcopy(seq["clips"]["idle"]["frames"][0])
    seq["cels"] = {"one": frame}
    seq["transitions"] = []
    seq["clips"] = {"idle": {"frames": ["one"] * 127, "loop": True}}
    seq["clips"].update({f"clip_{i}": {"frames": ["one"] * 128, "loop": True} for i in range(15)})
    assert validate_frame_sequences(model) == {"sequence_atlas"}  # 1 + 2047
    seq["clips"]["idle"]["frames"].append("one")
    with pytest.raises(ValueError, match="总帧数"):
        validate_frame_sequences(model)


@pytest.mark.parametrize("fault", ["declarations", "clip-uses", "clips"])
def test_registry_does_not_increase_any_existing_frame_or_clip_budget(fault):
    model = cel_model()
    seq = model["frameSequences"]
    frame = next(iter(seq["cels"].values()))
    if fault == "declarations":
        seq["cels"] = {f"cel_{i}": copy.deepcopy(frame) for i in range(2049)}
    elif fault == "clip-uses":
        seq["clips"]["idle"]["frames"] = ["cel_0"] * 129
    else:
        for i in range(65 - len(seq["clips"])):
            seq["clips"][f"extra_{i}"] = {"frames": ["cel_0"], "loop": True}
    with pytest.raises(ValueError):
        validate_frame_sequences(model)


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["unknown-ref", "unused-head", "unused-texture", "endpoint"])
async def test_cel_api_import_cas_and_invalid_updates_keep_raw_registry_config_chat_and_revision(
    fault,
):
    model = cel_model()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("cels.zip", cel_archive(model), "application/zip")},
        )
        assert created.status_code == 200, created.text
        base = f"/v1/desktop-pet/projects/{created.json()['id']}"
        baseline = (await client.get(f"{base}/document")).json()
        chat = (await client.get(f"{base}/chat")).json()
        updated = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": str(baseline["revision"])},
            files={"file": ("replacement.zip", cel_archive(model), "application/zip")},
        )
        assert updated.status_code == 200, updated.text
        saved = updated.json()
        assert saved["revision"] == baseline["revision"] + 1
        assert saved["config"] == baseline["config"]
        assert saved["whaleModel"] == model
        conflict = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": str(baseline["revision"])},
            files={"file": ("stale.zip", cel_archive(model), "application/zip")},
        )
        assert conflict.status_code == 409, conflict.text
        invalid = copy.deepcopy(model)
        seq = invalid["frameSequences"]
        missing = None
        if fault == "unknown-ref":
            seq["clips"]["idle"]["frames"][0] = "absent"
        elif fault == "unused-head":
            seq["cels"]["constructor"]["head"] = [[8, 0], [8, 7]]
        elif fault == "unused-texture":
            missing = "schemes/kurisu-maid/tex/unused.png"
        else:
            seq["clips"]["shared"]["frames"][1] = "constructor"
        payload = cel_archive(invalid, missing=missing)
        rejected = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("invalid.zip", payload, "application/zip")},
        )
        assert rejected.status_code == 422, rejected.text
        rejected_update = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": str(saved["revision"])},
            files={"file": ("invalid.zip", payload, "application/zip")},
        )
        assert rejected_update.status_code == 422, rejected_update.text
        assert (await client.get(f"{base}/document")).json() == saved
        assert (await client.get(f"{base}/chat")).json() == chat


def test_reference_duration_is_inherited_but_inline_endpoint_timing_stays_compatible():
    model = cel_model()
    seq = model["frameSequences"]
    branch = seq["transitions"][-1]["branches"][0]
    frames = seq["clips"][branch["clip"]]["frames"]
    key = "registered_start"
    seq["cels"][key] = copy.deepcopy(frames[branch["range"][0]])
    frames[branch["range"][0]] = key
    before = copy.deepcopy(seq["cels"])
    terminal = frames[branch["range"][1] - 1]
    terminal = copy.deepcopy(seq["cels"][terminal] if isinstance(terminal, str) else terminal)
    frames[branch["range"][1] - 1] = terminal
    terminal["durationMs"] = 123
    assert read_whale_package(cel_archive(model)).model == model
    assert seq["cels"] == before
    assert seq["cels"][key]["durationMs"] == 40


def test_registry_does_not_relax_the_128kib_raw_model_json_budget():
    model = sequence_model()
    seq = model["frameSequences"]
    frame = seq["clips"]["idle"]["frames"][0]
    seq["cels"] = {f"cel_{index}": copy.deepcopy(frame) for index in range(1000)}
    assert validate_frame_sequences(model) == {"sequence_atlas"}
    assert len(json.dumps(model).encode()) > 128 * 1024
    with pytest.raises(ValueError, match="模型过大"):
        read_whale_package(sequence_archive(model))
