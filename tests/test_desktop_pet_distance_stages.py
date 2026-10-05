"""Optional authored distance stages do not weaken package or material limits."""

import copy

import httpx
import pytest

from app.apps.desktop_pet.frame_sequences import validate_frame_sequences
from app.apps.desktop_pet.whale_package import read_whale_package
from app.main import app
from test_desktop_pet_frame_sequences import sequence_archive, sequence_model


def staged_model():
    model = sequence_model()
    seq = model["frameSequences"]
    clip = seq["clips"]["walk"]
    clip["frames"] *= 4
    clip["distanceAtFrame"] = [0, 0, 16, 16, 32]
    return model


def test_optional_track_keeps_uploaded_form_and_all_outfit_asset_closure():
    model = staged_model()
    before = copy.deepcopy(model)
    assert validate_frame_sequences(model) == {"sequence_atlas"}
    assert read_whale_package(sequence_archive(model)).model == before
    assert model == before
    del model["frameSequences"]["clips"]["walk"]["distanceAtFrame"]
    assert validate_frame_sequences(model) == {"sequence_atlas"}


@pytest.mark.parametrize(
    "track",
    [
        None,
        "0,16,32",
        [],
        [0, 32],
        [1, 1, 16, 16, 32],
        [0, 0, 16, 15, 32],
        [0, 0, 16, 16, 31],
        [0, 0, 16, 16, 33],
        [0, False, 16, 16, 32],
        [0, float("nan"), 16, 16, 32],
        [0, float("inf"), 16, 16, 32],
        [0, -1, 16, 16, 32],
    ],
)
def test_track_rejects_malformed_nonfinite_or_nonmonotonic_boundaries(track):
    model = staged_model()
    model["frameSequences"]["clips"]["walk"]["distanceAtFrame"] = track
    with pytest.raises(ValueError, match="阶段累计距离"):
        validate_frame_sequences(model)


@pytest.mark.parametrize("mode", ["no-distance", "nonloop", "oversize"])
def test_stage_track_requires_a_bounded_distance_loop(mode):
    model = staged_model()
    clip = model["frameSequences"]["clips"]["walk"]
    if mode == "no-distance":
        del clip["distancePerCycle"]
    elif mode == "nonloop":
        clip["loop"] = False
    else:
        clip["distancePerCycle"] = 513
        clip["distanceAtFrame"][-1] = 513
    with pytest.raises(ValueError):
        validate_frame_sequences(model)


def test_registry_references_are_counted_before_expansion_and_track_does_not_mutate_them():
    model = staged_model()
    seq = model["frameSequences"]
    seq["cels"] = {"source": copy.deepcopy(seq["clips"]["walk"]["frames"][0])}
    seq["clips"]["walk"]["frames"] = ["source"] * 4
    before = copy.deepcopy(model)
    assert validate_frame_sequences(model) == {"sequence_atlas"}
    assert model == before
    seq["cels"]["unused"] = dict(seq["cels"]["source"], texture="missing")
    with pytest.raises(ValueError, match="贴图缺失"):
        read_whale_package(sequence_archive(model))


@pytest.mark.parametrize("outfit", ["", "schemes/kurisu-lab/", "schemes/kurisu-maid/"])
def test_declaring_stages_does_not_make_missing_outfit_atlases_optional(outfit):
    with pytest.raises(ValueError, match="贴图缺失"):
        read_whale_package(
            sequence_archive(staged_model(), missing=f"{outfit}tex/sequence_atlas.png")
        )


@pytest.mark.asyncio
async def test_invalid_track_import_and_cas_replacement_preserve_saved_configuration():
    model = staged_model()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("stages.zip", sequence_archive(model), "application/zip")},
        )
        assert created.status_code == 200, created.text
        base = f"/v1/desktop-pet/projects/{created.json()['id']}"
        baseline = (await client.get(f"{base}/document")).json()
        model["frameSequences"]["clips"]["walk"]["distanceAtFrame"][2] = 33
        invalid = sequence_archive(model)
        for url, data in [
            ("/v1/desktop-pet/projects/import-whale", {}),
            (f"{base}/replace-package", {"expectedRevision": str(baseline["revision"])}),
        ]:
            response = await client.post(
                url, data=data, files={"file": ("bad.zip", invalid, "application/zip")}
            )
            assert response.status_code == 422, response.text
        assert (await client.get(f"{base}/document")).json() == baseline
