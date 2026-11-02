"""Prepare or build exactly one independently owned image through Docker CLI."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fpl_deployment.images import build_image, prepare_image  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("service")
    parser.add_argument("--build", action="store_true")
    args = parser.parse_args()
    if args.build:
        release = build_image(ROOT, args.service)
    else:
        _context, release = prepare_image(ROOT, args.service)
    print(json.dumps({key: release[key] for key in ("service", "version", "image")}))
