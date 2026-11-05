from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend"))
os.environ.setdefault("FPL_SECRETS_KEY", "Q3kT62dvbHHXXulO5XPCR84_yXK6t-6LXz7BcIYONys=")
os.environ["FPL_STUDIO_TOKEN"] = ""

from fastapi import FastAPI  # noqa: E402

from app.main import app  # noqa: E402
from studio.apps.management.transport.service import router as management_router  # noqa: E402


def management_schema():
    management = FastAPI(title="FPL Management", version="0.1.0")
    management.include_router(management_router)
    return management.openapi()


def aggregate_schema():
    schema = app.openapi()
    schema["paths"].pop("/v1/automation/access", None)
    schema["paths"].pop("/v1/automation/access/actions", None)
    management = management_schema()
    schema["paths"].update(management["paths"])
    schema["components"]["schemas"].update(management["components"]["schemas"])
    return schema


TARGET = REPO_ROOT / "web" / "src" / "generated" / "openapi.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    content = json.dumps(aggregate_schema(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    management = (
        json.dumps(management_schema(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    )
    management_target = TARGET.with_name("management-openapi.json")
    if args.check:
        if not management_target.exists() or management_target.read_text() != management:
            raise SystemExit("Management OpenAPI schema is stale")
    else:
        management_target.write_text(management)
    if args.check:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != content:
            raise SystemExit("OpenAPI schema is stale; run npm run contracts:generate")
        return
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
