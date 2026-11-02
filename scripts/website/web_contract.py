"""Read checked-in schemas only; this command never imports the application or its database."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fpl_runtime.protocol_hash import public_contract  # noqa: E402
from fpl_runtime.routing import RouteCatalog  # noqa: E402

if __name__ == "__main__":
    print(
        public_contract(
            json.loads((ROOT / "web/src/generated/openapi.json").read_text()),
            sys.argv[1],
            RouteCatalog.read(ROOT / "deploy/contracts/ownership.json"),
        )
    )
