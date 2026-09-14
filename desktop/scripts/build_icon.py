"""Build the macOS icon without redrawing or mutating the project brand mark."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "web/public/brand/brand-mark.png"
ASSETS = ROOT / "desktop/assets"
MASTER = ASSETS / "app-icon.png"
ICON = ASSETS / "app-icon.icns"


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def gradient(size: int) -> Image.Image:
    top = (255, 250, 238)
    bottom = (224, 112, 76)
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    for y in range(size):
        position = y / (size - 1)
        eased = position * position * (3 - 2 * position)
        row = tuple(
            round(start + (end - start) * eased)
            for start, end in zip(top, bottom, strict=True)
        )
        for x in range(size):
            distance = ((x - size * 0.46) ** 2 + (y - size * 0.31) ** 2) ** 0.5 / size
            light = max(0.0, 0.075 * (1 - distance / 0.65))
            pixels[x, y] = (*tuple(round(value + (255 - value) * light) for value in row), 255)
    return image


def build_master() -> Image.Image:
    size = 1024
    tile_box = (42, 34, 982, 974)
    tile_size = tile_box[2] - tile_box[0]
    canvas = Image.new("RGBA", (size, size))

    shadow_mask = rounded_mask(tile_size, 205).filter(ImageFilter.GaussianBlur(24))
    shadow_layer = Image.new("RGBA", (tile_size, tile_size), (73, 40, 24, 82))
    shadow_layer.putalpha(shadow_mask)
    canvas.alpha_composite(shadow_layer, (tile_box[0], tile_box[1] + 16))

    tile = gradient(tile_size)
    mask = rounded_mask(tile_size, 205)
    tile.putalpha(mask)
    canvas.alpha_composite(tile, tile_box[:2])

    border = Image.new("RGBA", (tile_size, tile_size))
    draw = ImageDraw.Draw(border)
    draw.rounded_rectangle(
        (4, 4, tile_size - 5, tile_size - 5),
        radius=201,
        outline=(166, 74, 45, 155),
        width=8,
    )
    draw.rounded_rectangle(
        (14, 14, tile_size - 15, tile_size - 15),
        radius=193,
        outline=(255, 255, 255, 105),
        width=5,
    )
    border.putalpha(ImageChops.multiply(border.getchannel("A"), mask))
    canvas.alpha_composite(border, tile_box[:2])

    logo = Image.open(SOURCE).convert("RGBA")
    target = 714
    logo = logo.resize((target, target), Image.Resampling.LANCZOS)
    logo_shadow = Image.new("RGBA", logo.size, (44, 22, 11, 0))
    logo_shadow.putalpha(
        logo.getchannel("A").filter(ImageFilter.GaussianBlur(15)).point(lambda alpha: alpha * 0.38)
    )
    position = ((size - target) // 2, (size - target) // 2 - 7)
    canvas.alpha_composite(logo_shadow, (position[0], position[1] + 16))
    canvas.alpha_composite(logo, position)
    return canvas


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Missing brand source: {SOURCE}")
    with SOURCE.open("rb") as source:
        if source.read(42).startswith(b"version https://git-lfs.github.com/spec/v1"):
            raise SystemExit("Brand source is still a Git LFS pointer")
    ASSETS.mkdir(parents=True, exist_ok=True)
    master = build_master()
    master.save(MASTER, optimize=True)
    iconutil = shutil.which("iconutil")
    if iconutil is None:
        raise SystemExit("macOS iconutil is required to build the desktop icon")
    with tempfile.TemporaryDirectory(prefix="fpl-icon-") as directory:
        iconset = Path(directory) / "app-icon.iconset"
        iconset.mkdir()
        outputs = {
            "icon_16x16.png": 16,
            "icon_16x16@2x.png": 32,
            "icon_32x32.png": 32,
            "icon_32x32@2x.png": 64,
            "icon_128x128.png": 128,
            "icon_128x128@2x.png": 256,
            "icon_256x256.png": 256,
            "icon_256x256@2x.png": 512,
            "icon_512x512.png": 512,
            "icon_512x512@2x.png": 1024,
        }
        for name, output_size in outputs.items():
            master.resize((output_size, output_size), Image.Resampling.LANCZOS).save(iconset / name)
        subprocess.run([iconutil, "-c", "icns", str(iconset), "-o", str(ICON)], check=True)
    print(f"Built {MASTER.relative_to(ROOT)} and {ICON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
