"""Pack local Coopanion whale data for explicit API import; never copy art into source."""

from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path

OUTPUT_ROOT = Path(__file__).resolve().parents[1] / ".local" / "desktop-pet"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    source = args.source_dir.resolve()
    output = args.output.resolve()
    if not (source / "model.json").is_file():
        parser.error("--source-dir must point to Coopanion web/whale")
    if output.is_relative_to(source):
        parser.error("--output must be outside the source directory")
    if not output.is_relative_to(OUTPUT_ROOT):
        parser.error("--output must be inside repository .local/desktop-pet/")
    images = sorted(path for path in source.rglob("*.png") if path.is_file())
    if not images:
        parser.error("no PNG images found")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.json", json.dumps({"format": "fpl-coopanion-whale", "version": 1})
        )
        archive.write(source / "model.json", "model.json")
        for image in images:
            archive.write(image, image.relative_to(source).as_posix())
    print(f"Packed {len(images)} PNG files: {output}")


if __name__ == "__main__":
    main()
