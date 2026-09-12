from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

FONT_PATH = Path(__file__).resolve().parent / "assets" / "NotoSansSC-Regular.ttf"
GAP = 12
MAX_CELL_EDGE = 1536
CAPTION_BG = (247, 247, 245)
CAPTION_FG = (24, 24, 27)
GRID_BG = (28, 28, 28)


def _font(size: int) -> ImageFont.FreeTypeFont:
    if not FONT_PATH.is_file():
        raise RuntimeError("合成图 caption 字体缺失")
    return ImageFont.truetype(str(FONT_PATH), size)


def _lines(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int
) -> list[str]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    result: list[str] = []
    for paragraph in text.split("\n"):
        current = ""
        for char in paragraph:
            candidate = current + char
            if current and draw.textlength(candidate, font=font) > width:
                result.append(current)
                current = char
            else:
                current = candidate
        result.append(current)
    if not result:
        return [""]
    if len(result) > 2:
        result = result[:2]
        result[-1] = result[-1].rstrip() + "…"
    return result


def render_image_grid(
    paths: list[Path], captions: list[str], output_path: Path, grid_size: int
) -> tuple[int, int]:
    if grid_size not in (4, 9) or len(paths) != grid_size:
        raise ValueError("宫格图片数量必须为 4 或 9")
    images = [ImageOps.exif_transpose(Image.open(path)).convert("RGB") for path in paths]
    try:
        base_width, base_height = images[0].size
        scale = min(1.0, MAX_CELL_EDGE / max(base_width, base_height))
        cell_width = max(1, round(base_width * scale))
        cell_height = max(1, round(base_height * scale))
        has_caption = any(caption.strip() for caption in captions)
        font_size = max(24, min(52, round(cell_width * 0.036)))
        font = _font(font_size)
        draw = ImageDraw.Draw(images[0])
        caption_lines = [
            _lines(draw, caption.strip(), font, max(1, cell_width - font_size * 2))
            if has_caption
            else []
            for caption in captions
        ]
        line_height = round(font_size * 1.35)
        caption_height = (
            max((len(lines) for lines in caption_lines), default=0) * line_height + font_size
            if has_caption
            else 0
        )
        side = 2 if grid_size == 4 else 3
        tile_height = cell_height + caption_height
        canvas = Image.new(
            "RGB",
            (cell_width * side + GAP * (side - 1), tile_height * side + GAP * (side - 1)),
            GRID_BG,
        )
        for index, source in enumerate(images):
            tile = ImageOps.fit(source, (cell_width, cell_height), method=Image.Resampling.LANCZOS)
            tile_canvas = Image.new("RGB", (cell_width, tile_height), CAPTION_BG)
            tile_canvas.paste(tile, (0, 0))
            if has_caption:
                tile_draw = ImageDraw.Draw(tile_canvas)
                lines = caption_lines[index]
                y = cell_height + (caption_height - len(lines) * line_height) // 2
                for line in lines:
                    text_width = tile_draw.textlength(line, font=font)
                    tile_draw.text(
                        ((cell_width - text_width) / 2, y), line, fill=CAPTION_FG, font=font
                    )
                    y += line_height
            x = (index % side) * (cell_width + GAP)
            y = (index // side) * (tile_height + GAP)
            canvas.paste(tile_canvas, (x, y))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output_path, format="PNG", optimize=True)
        return canvas.size
    finally:
        for image in images:
            image.close()
