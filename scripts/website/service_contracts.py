"""Generate/check the complete service ownership manifest without importing a database."""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fpl_deployment.contracts import generate  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(generate(ROOT, check=args.check).relative_to(ROOT))
