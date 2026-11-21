"""Native project owners report the exact same explicit admission directory."""

from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from studio.assembly.independent.agent_runtime.application import create_app as agent_app
from studio.assembly.independent.amadeus.application import create_app as amadeus_app
from studio.contracts.gateway.routing import RouteCatalog


@pytest.mark.parametrize(
    "service,factory", [("amadeus", amadeus_app), ("agent-runtime", agent_app)]
)
async def test_native_health_reports_mapped_gate(service, factory, tmp_path):
    gate = tmp_path / "admission"
    (gate / "inflight").mkdir(parents=True)
    arguments = dict(
        state_root=tmp_path / service,
        admission_root=gate,
        public_key=Ed25519PrivateKey.generate().public_key(),
        catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
    )
    if service == "amadeus":
        arguments["credential"] = "isolated-native-agent-admission-credential"
    app = factory(**arguments)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            report = (await client.get("/health")).json()
            assert report["service"] == service
            assert report["agent_admission"] == "accepting"
            (gate / "paused").write_text("exact-maintenance-window\n")
            report = (await client.get("/health")).json()
            assert report["agent_admission"] == "paused"
            assert report["agent_admission_id"] == "exact-maintenance-window"
            path = "/v1/amadeus/runs" if service == "amadeus" else "/v1/connections"
            blocked = await client.post(path, json={})
            assert blocked.status_code == 503
            assert blocked.json()["code"] == "agent_maintenance"
            assert list((gate / "inflight").iterdir()) == []
    finally:
        await app.state.database.close()
