import asyncio
import os
import sys
from pathlib import Path
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import text

root = Path(os.environ["MANAGEMENT_TEST_ROOT"])
identity_root, management_root = root / "identity", root / "management"
os.environ["FPL_CONFIG_FILE"] = str(root / "absent.toml")
os.environ["FPL_DATABASE_PATH"] = str(identity_root / "service.db")
from fpl_identity.accounts import create_account  # noqa: E402
from fpl_identity.application import create_app as identity_app  # noqa: E402
from fpl_identity.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS  # noqa: E402
from fpl_management.application import create_app  # noqa: E402
from fpl_management.migrations.registry import MIGRATIONS  # noqa: E402
from fpl_management.models import NativeJob  # noqa: E402
from fpl_runtime.claims import HEADER  # noqa: E402
from fpl_runtime.identity_client import LiveAuthorization  # noqa: E402
from fpl_runtime.migrations import apply, check  # noqa: E402
from fpl_runtime.routing import RouteCatalog  # noqa: E402

assert "app.main" not in sys.modules and "app.orm" not in sys.modules
assert not any(name.startswith("app.apps.") or name.startswith("app.llm.") for name in sys.modules)
apply(identity_root / "service.db", "identity", IDENTITY_MIGRATIONS)
apply(management_root / "service.db", "management", MIGRATIONS)
key = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
gateway_token, management_token = "business_gateway_" * 3, "management_gateway_" * 3
service_token, native_token, worker_token = (
    "service_token_" * 3,
    "native_ingress_" * 3,
    "worker_private_" * 3,
)
identity = identity_app(
    state_root=identity_root,
    catalog=catalog,
    gateway_token=gateway_token,
    local_origin="http://127.0.0.1:9000",
    public_origin="https://studio.example.test",
    private_key=key,
    management_gateway_token=management_token,
    management_local_origin="http://127.0.0.1:9002",
    management_public_origin="https://admin.example.test",
    service_credentials={"management": service_token},
)
identity_transport = httpx.ASGITransport(app=identity)
management = create_app(
    state_root=management_root,
    catalog=catalog,
    public_key=key.public_key(),
    identity=LiveAuthorization(
        service="management", credential=service_token, transport=identity_transport
    ),
    native_ingress_token=native_token,
    workers={"mac": worker_token},
)
admin_origin = "http://127.0.0.1:9002"
password = "Management-Testing-Password-2026!"


async def scenario():
    async with (
        identity.router.lifespan_context(identity),
        management.router.lifespan_context(management),
    ):
        async with identity.state.database.sessions() as session:
            admin, _ = await create_account(
                session,
                username="management-admin",
                display_name="Admin",
                password=password,
                platform_role="admin",
            )
            owner = admin.id
            user, _ = await create_account(
                session,
                username="management-user",
                display_name="User",
                password=password,
                platform_role="user",
            )
        headers = {
            "X-Fpl-Gateway": management_token,
            "X-Fpl-Ingress": "local",
            "Origin": admin_origin,
        }
        async with httpx.AsyncClient(
            transport=identity_transport, base_url=admin_origin, headers=headers
        ) as browser:
            login = await browser.post(
                "/v1/auth/login", json={"username": "management-admin", "password": password}
            )
            assert login.status_code == 200, login.text
            assert (
                "fpl_management_session" in browser.cookies and "fpl_session" not in browser.cookies
            )
            browser.headers["X-CSRF-Token"] = browser.cookies["fpl_management_csrf"]
            assert (await browser.get("/v1/platform/accounts")).status_code == 200
            token = browser.cookies["fpl_management_session"]
            async with httpx.AsyncClient(
                transport=identity_transport,
                base_url="http://127.0.0.1:9000",
                headers={"X-Fpl-Gateway": gateway_token, "X-Fpl-Ingress": "local"},
                cookies={"fpl_session": token},
            ) as business:
                assert (await business.get("/v1/auth/me")).status_code == 401
                assert (await business.get("/v1/platform/accounts")).status_code == 404
            async with httpx.AsyncClient(
                transport=identity_transport, base_url=admin_origin, headers=headers
            ) as normal:
                assert (
                    await normal.post(
                        "/v1/auth/login", json={"username": "management-user", "password": password}
                    )
                ).status_code == 401
            assert (await browser.post("/v1/auth/register", json={})).status_code == 404

            async def assertion(method, path, *, public=False):
                auth_headers = {
                    "X-Fpl-Target-Service": "management",
                    "X-Fpl-Request-Method": method,
                    "X-Fpl-Request-Uri": path,
                }
                if public:
                    auth_headers.update(
                        {
                            "Host": "admin.example.test",
                            "Origin": "https://admin.example.test",
                            "X-Fpl-Ingress": "public",
                        }
                    )
                response = await browser.get("/_internal/v1/authorize", headers=auth_headers)
                assert response.status_code == 204, response.text
                return response.headers[HEADER]

            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=management), base_url="http://management"
            ) as client:
                path = "/v1/management/runtime"
                response = await client.get(path, headers={HEADER: await assertion("GET", path)})
                assert response.status_code == 200 and response.json()["local_browser"] is True, (
                    response.text
                )
                assert (await client.get(path)).status_code == 401
                actions = "/v1/management/application/actions"
                body = {"action": "start", "request_id": str(uuid4())}
                accepted = await client.post(
                    actions, json=body, headers={HEADER: await assertion("POST", actions)}
                )
                assert accepted.status_code == 202, accepted.text
                again = await client.post(
                    actions, json=body, headers={HEADER: await assertion("POST", actions)}
                )
                assert again.status_code == 202 and again.json()["id"] == accepted.json()["id"], (
                    again.text
                )
                different = await client.post(
                    actions,
                    json={**body, "action": "stop"},
                    headers={HEADER: await assertion("POST", actions)},
                )
                assert different.status_code == 409
                remote = await client.post(
                    actions,
                    json={"action": "stop", "request_id": str(uuid4())},
                    headers={
                        HEADER: await assertion("POST", actions, public=True),
                        "X-Fpl-Ingress": "local",
                    },
                )
                assert remote.status_code == 403
                malicious = await client.post(
                    actions,
                    json={**body, "command": "echo unsafe"},
                    headers={HEADER: await assertion("POST", actions)},
                )
                assert malicious.status_code == 422
                worker_headers = {
                    "X-Fpl-Native-Ingress": native_token,
                    "Authorization": "Bearer " + worker_token,
                }
                assert (
                    await client.post("/_native/v1/claim", json={"wait_seconds": 0})
                ).status_code == 403
                claim = await client.post(
                    "/_native/v1/claim", json={"wait_seconds": 0}, headers=worker_headers
                )
                lease = claim.json()["lease"]
                assert lease and lease["job_id"] == accepted.json()["id"], claim.text
                assert (
                    await client.post(
                        "/_native/v1/authorize", json={"lease": lease}, headers=worker_headers
                    )
                ).status_code == 200
                outcome = {"status": "completed", "result": {"phase": "running"}}
                for _ in range(2):
                    delivered = await client.post(
                        "/_native/v1/receipt",
                        json={"lease": lease, "outcome": outcome},
                        headers=worker_headers,
                    )
                    assert delivered.status_code == 200, delivered.text
                report = await client.post(
                    "/_native/v1/report",
                    json={"application": {"phase": "running"}},
                    headers=worker_headers,
                )
                assert report.status_code == 200, report.text
                apppath = "/v1/management/application"
                observed = await client.get(
                    apppath, headers={HEADER: await assertion("GET", apppath, public=True)}
                )
                assert observed.status_code == 200 and observed.json()["phase"] == "running"
                revoked = await client.post(
                    actions,
                    json={"action": "stop", "request_id": str(uuid4())},
                    headers={HEADER: await assertion("POST", actions)},
                )
                assert revoked.status_code == 202
                await browser.post("/v1/auth/logout")
                claim = await client.post(
                    "/_native/v1/claim", json={"wait_seconds": 0}, headers=worker_headers
                )
                assert claim.json()["lease"] is None
                async with management.state.database.sessions(
                    info={"owner_user_id": owner}
                ) as session:
                    row = await session.get(NativeJob, revoked.json()["id"])
                    assert row.status == "failed" and row.error_code == "authorization_revoked"
        async with management.state.database.sessions() as session:
            tables = {
                r[0]
                for r in (
                    await session.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
                ).all()
            }
            assert tables == {
                "_fpl_service_schema",
                "management_native_jobs",
                "management_host_snapshot",
            }, tables
        try:
            check(identity_root / "service.db", "management", MIGRATIONS)
            raise AssertionError("foreign database accepted")
        except ValueError:
            pass


asyncio.run(scenario())
print("Management sessions, revocation, native receipts and storage isolation passed")
