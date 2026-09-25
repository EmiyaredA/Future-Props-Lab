"""Check the review-only rig package and pixel evidence without touching user data."""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".local/output/live2d-rig-review"
sys.path.insert(0, str(ROOT / "backend"))

from app.apps.live2d_workshop.packages import read_package  # noqa: E402
from app.capabilities.media_rendering.live2d.evaluate import (  # noqa: E402
    evaluate,
    parameter_values,
)


def check() -> None:
    package = OUT / "kurisu-rig-draft.fpllive2d"
    title, doc, assets = read_package(package.read_bytes())
    assert "验收草案" in title
    assert len(doc.parts) >= 30 and len(doc.bones) >= 12
    assert not doc.motions and not doc.expressions and not doc.state_bindings
    assert set(assets) == {part.asset_id for part in doc.parts}
    assert {"avatar", "stage"} == set(doc.cameras)
    assert all(
        part.skin_weights and len(part.skin_weights) == len(part.vertices) for part in doc.parts
    )
    for part in doc.parts:
        for weights in part.skin_weights or []:
            assert 1 <= len(weights) <= 4
            assert abs(sum(weight.weight for weight in weights) - 1) < 1e-6
    assert not any(part.visible for part in doc.parts if part.id.endswith("-hand"))
    with zipfile.ZipFile(package) as archive:
        assert len([name for name in archive.namelist() if name.startswith("assets/")]) == len(
            doc.parts
        )
    manifest = json.loads((OUT / "layer-manifest.json").read_text())
    assert len(manifest["layers"]) == len(doc.parts)
    assert all(
        (OUT / "layers" / f"{index + 1:02d}-{layer['id']}.png").is_file()
        for index, layer in enumerate(manifest["layers"])
    )
    approved = Image.open(ROOT / "web/src/features/amadeus/art/kurisu-neutral.png").convert("RGBA")
    reconstructed = (
        Image.open(OUT / "neutral-layer-reconstruction.png")
        .convert("RGBA")
        .crop((0, 0, *approved.size))
    )
    difference = ImageChops.difference(approved, reconstructed)
    means = ImageStat.Stat(difference).mean
    assert max(means) < 0.5, f"Neutral drawing differs from approved art: {means}"
    assert difference.getchannel("A").getextrema()[1] <= 1
    for pose in ("neutral", "eye-closed", "head-left", "body-and-arms"):
        for suffix in ("stage", "48", "76"):
            image = Image.open(OUT / f"{pose}-{suffix}.png")
            assert image.getbbox() is not None
    base = evaluate(doc, parameter_values(doc))[0]
    posed = evaluate(doc, parameter_values(doc, overrides={"ParamAngleX": -30}))[0]
    base_head = next(part for part in base if part["id"] == "face")
    posed_head = next(part for part in posed if part["id"] == "face")
    assert base_head["worldVertices"] != posed_head["worldVertices"]
    print(f"Verified {len(doc.parts)} layers, {len(doc.bones)} bones, PSD and package")


if __name__ == "__main__":
    check()
