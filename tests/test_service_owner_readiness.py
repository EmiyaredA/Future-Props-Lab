"""Verify browser releases and production workers in the readiness contracts."""

import hashlib
import json
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from studio.apps.audio_annotation.storage.migrations.registry import MIGRATIONS as ANNOTATION
from studio.apps.interview_assistant.storage.migrations.registry import MIGRATIONS as INTERVIEW
from studio.apps.presentation_workshop.storage.migrations.registry import MIGRATIONS as PRESENTATION
from studio.apps.tools.storage.migrations.registry import MIGRATIONS as TOOLS
from studio.assembly.independent.audio_annotation.application import create_app as annotation
from studio.assembly.independent.interview_assistant.application import create_app as interview
from studio.assembly.independent.presentation_workshop.application import create_app as presentation
from studio.assembly.independent.tools.application import create_app as tools
from studio.contracts.gateway.protocol_hash import public_contract
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.tools.tools_native import ToolsNativeOptions
from studio.runtime.database.migrations import apply
from studio.runtime.http.native_ingress import NativeWorkerOptions

ROOT = Path(__file__).resolve().parents[1]
BUILD = "c" * 20
PAGE = b"<!doctype html><title>Owner release</title>"
INGRESS = "a" * 40
IDENTITY = "b" * 40
WORKER = "d" * 40


def application(root, service, migrations, create, **kwargs):
    schema = ROOT / "web/src/generated/openapi.json"
    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    state = root / "state"
    apply(state / "service.db", service, migrations)
    web = root / "web"
    web.mkdir(exist_ok=True)
    (web / "index.html").write_bytes(PAGE)
    (web / "build.json").write_text(
        json.dumps(
            {
                "version": 1,
                "service": service,
                "build_id": BUILD,
                "entry": "index.html",
                "api_sha256": public_contract(json.loads(schema.read_text()), service, catalog),
                "files": [
                    {
                        "path": "index.html",
                        "bytes": len(PAGE),
                        "sha256": hashlib.sha256(PAGE).hexdigest(),
                    }
                ],
            }
        )
    )
    return create(
        state_root=state,
        schema_path=schema,
        catalog=catalog,
        web_root=web,
        public_key=Ed25519PrivateKey.generate().public_key(),
        **kwargs,
    )


def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://service")


@pytest.mark.parametrize(
    ("service", "migrations", "create", "kwargs", "page", "runner"),
    [
        ("annotation", ANNOTATION, annotation, {}, "/apps/audio-annotation", "reference_delivery"),
        (
            "presentation",
            PRESENTATION,
            presentation,
            {"archive_key": "e" * 40},
            "/apps/presentation-workshop",
            "import_delivery",
        ),
    ],
)
async def test_release_requires_healthy_delivery_worker(
    tmp_path, service, migrations, create, kwargs, page, runner
):
    app = application(tmp_path, service, migrations, create, credential=IDENTITY, **kwargs)
    async with client(app) as api:
        assert (await api.get("/ready")).status_code == 503
        async with app.router.lifespan_context(app):
            ready = await api.get("/ready")
            assert ready.json() == {"status": "ready", "service": service, "version": BUILD}
            assert (await api.get(page)).content == PAGE
            await getattr(app.state, runner).stop()
            assert (await api.get("/ready")).status_code == 503


@pytest.mark.parametrize("service", ["interview", "tools"])
async def test_native_readiness_tracks_only_authenticated_fresh_contact(tmp_path, service):
    options = {"ingress": INGRESS, "identity_credential": IDENTITY, "workers": {"fixture": WORKER}}
    if service == "interview":
        app = application(
            tmp_path, service, INTERVIEW, interview, options=NativeWorkerOptions(**options)
        )
        path, body = "/_native/v1/beat", {"available": True, "code": "ready", "version": "fixture"}
        page = "/apps/interview-assistant"
    else:
        app = application(
            tmp_path, service, TOOLS, tools, native_options=ToolsNativeOptions(**options)
        )
        path, body = "/_native/v1/claim", {"wait_seconds": 0}
        page = "/tools"
    headers = {"X-Fpl-Native-Ingress": INGRESS, "Authorization": "Bearer " + WORKER}
    async with app.router.lifespan_context(app), client(app) as api:
        assert (await api.get("/ready")).status_code == 503
        assert (await api.post(path, json=body)).status_code == 403
        assert (await api.get("/ready")).status_code == 503
        assert (await api.post(path, headers=headers, json=body)).status_code == 200
        assert (await api.get("/ready")).json() == {
            "status": "ready",
            "service": service,
            "version": BUILD,
        }
        assert (await api.get(page)).content == PAGE
        if service == "interview":
            host = app.state.interview_host
            seen, status = host.workers["fixture"]
            host.workers["fixture"] = (seen - 600, status)
        else:
            app.state.tools_host.last_worker_contact -= 600
        assert (await api.get("/ready")).status_code == 503
        assert (await api.get("/health")).status_code == 200
