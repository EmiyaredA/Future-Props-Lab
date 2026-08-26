from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ATLAS = Path(
    "/Users/tonghao/Projects/steins-gate-video/assets/games/steins_gate/"
    "ui/phone/atlases/png/PHONE.png"
)
DEFAULT_OUTPUT = REPO_ROOT / "docs/assets/galgame-ui/okabe-main-phone-overlay-v2.png"
CANVAS_SIZE = (1672, 941)


def _compose_phone(atlas: Image.Image) -> Image.Image:
    # PHONE.png stores the original red handset at the left edge. The atlas packs
    # unrelated widgets over the lower-right half, so reconstruct that symmetric
    # navigation panel from its unobstructed left half.
    phone = atlas.crop((4, 16, 562, 1450)).convert("RGBA")
    center_x = phone.width // 2
    lower_start = 850
    clean_left = phone.crop((0, lower_start, center_x, phone.height))
    clean_right = clean_left.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    phone.paste(clean_right, (center_x, lower_start))
    lower_draw = ImageDraw.Draw(phone)
    lower_draw.polygon(
        ((206, 1180), (279, 1115), (352, 1180), (352, 1433), (206, 1433)),
        fill="#2A2426",
    )
    lower_draw.rounded_rectangle(
        (245, 1225, 313, 1405), radius=18, fill="#3B3336", outline="#171315", width=5
    )

    # Reuse the original blue menu texture from the same atlas and fit it inside
    # the handset's display opening.
    menu = atlas.crop((2650, 282, 3070, 840)).convert("RGBA")
    menu = menu.resize((420, 548), Image.Resampling.LANCZOS)
    phone.alpha_composite(menu, (72, 145))

    # Remove neighbouring packed sprites while retaining the handset silhouette.
    silhouette = Image.new("L", phone.size, 0)
    draw = ImageDraw.Draw(silhouette)
    draw.rounded_rectangle((23, 4, 533, 115), radius=22, fill=255)
    draw.rounded_rectangle((20, 58, 538, 790), radius=18, fill=255)
    draw.rounded_rectangle((0, 754, 557, 890), radius=15, fill=255)
    draw.rounded_rectangle((22, 866, 536, 1433), radius=20, fill=255)
    phone.putalpha(silhouette)
    return phone


def build_overlay(atlas_path: Path, output_path: Path) -> None:
    atlas = Image.open(atlas_path).convert("RGBA")
    phone = _compose_phone(atlas)
    target_height = 920
    target_width = round(phone.width * target_height / phone.height)
    phone = phone.resize((target_width, target_height), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    canvas.alpha_composite(phone, (CANVAS_SIZE[0] - target_width - 22, 10))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="从原作 PHONE.png 重组完整冈部手机叠加素材")
    parser.add_argument("--atlas", type=Path, default=DEFAULT_ATLAS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build_overlay(args.atlas, args.output)


if __name__ == "__main__":
    main()
