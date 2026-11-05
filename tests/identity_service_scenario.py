"""Fresh-process integration scenario for the account-only ASGI application."""

import asyncio
import base64
import hashlib
import os
import sys
import time
from dataclasses import replace
from pathlib import Path

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from studio.apps.identity.accounts import create_account
from studio.apps.identity.storage.migrations.registry import MIGRATIONS
from studio.apps.identity.storage.service_models import AccountEvent
from studio.assembly.independent.identity.application import create_app
from studio.contracts.creative_workshop.creative_install_evidence import (
    INSTALL_PATH,
    verify_install_evidence,
)
from studio.contracts.creative_workshop.creative_source_evidence import (
    SOURCE_PATH,
    verify_source_evidence,
)
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import HEADER, issue_context, verify_context
from studio.runtime.database.migrations import apply

state = Path(os.environ["IDENTITY_TEST_ROOT"])
assert "studio.assembly.website.application" not in sys.modules
assert "studio.assembly.website.routes" not in sys.modules
assert "studio.assembly.website.models" not in sys.modules
assert "studio.runtime.database.website" not in sys.modules
assert not any(
    name.startswith("studio.apps.model_service") or name.startswith("app.apps")
    for name in sys.modules
)

private = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
app = create_app(
    state_root=state,
    catalog=catalog,
    gateway_token="test-gateway-token-" * 3,
    local_origin="http://127.0.0.1:19000",
    public_origin="https://studio.example.test",
    private_key=private,
    management_gateway_token="management-test-gateway-" * 3,
    management_local_origin="http://127.0.0.1:19002",
    management_public_origin="https://admin.example.test",
    service_credentials={
        "agents": "agents-test-service-credential-123456",
        "gateway": "gateway-test-service-credential-123456",
        "creative": "creative-test-service-credential-123456",
        "assets": "assets-test-service-credential-123456",
    },
)
apply(state / "service.db", "identity", MIGRATIONS)
transport = httpx.ASGITransport(app=app)
headers = {
    "X-Fpl-Gateway": "test-gateway-token-" * 3,
    "X-Fpl-Ingress": "local",
    "X-Fpl-Client-Ip": "127.0.0.1",
}
password = "Identity-Test-Password-2026!"


async def creative_catalog(browser, unsafe, owner):
    from studio.apps.creative_workshop.storage.migrations.registry import (
        MIGRATIONS as CREATIVE_MIGRATIONS,
    )
    from studio.assembly.independent.creative_workshop.application import (
        create_app as create_creative,
    )
    from studio.contracts.creative_workshop.creative_authors import ITEM, PATH

    root = state.parent / "creative"
    credential = "creative-test-service-credential-123456"
    apply(root / "service.db", "creative", CREATIVE_MIGRATIONS)
    source_reads = []

    async def mesh(request):
        if request.url.host != "integrations":
            return await transport.handle_async_request(request)
        source_reads.append(request.url.path)
        return httpx.Response(
            200,
            json={
                "title": "Imported tool",
                "summary": "Test only",
                "manifest": {"method": "GET", "url": "https://example.test/api"},
                "skill_archive": None,
                "skill_sha256": "",
            },
        )

    creative = create_creative(
        state_root=root,
        catalog=catalog,
        public_key=private.public_key(),
        credential=credential,
        transport=httpx.MockTransport(mesh),
    )

    async def assertion(method, path):
        response = await browser.get(
            "/_internal/v1/authorize",
            headers={
                **unsafe,
                "X-Fpl-Target-Service": "creative",
                "X-Fpl-Request-Method": method,
                "X-Fpl-Request-Uri": path,
            },
        )
        assert response.status_code == 204, response.text
        return response.headers[HEADER]

    async with (
        creative.router.lifespan_context(creative),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=creative), base_url="http://creative"
        ) as client,
    ):
        draft = {"kind": "tool_api", "title": "Test tool"}
        assert (await client.post(ITEM, json=draft)).status_code == 401
        response = await client.post(
            ITEM, json=draft, headers={HEADER: await assertion("POST", ITEM)}
        )
        assert response.status_code == 201, response.text
        item = response.json()
        assert item["author_user_id"] == owner
        assert item["author_name"] == "Identity Admin"
        item_path = ITEM + "/" + item["id"]
        token = await assertion("GET", item_path)
        assert (await client.get(item_path, headers={HEADER: token})).status_code == 404
        draft_response = await client.get(
            item_path, params={"draft": True}, headers={HEADER: token}
        )
        assert draft_response.status_code == 200, draft_response.text
        assert draft_response.json()["author_name"] == "Identity Admin"
        assert (await client.get("/ready")).status_code == 503
        source_token = await assertion("POST", SOURCE_PATH)
        source_body = b'{"kind":"tool_api","source_id":"tool"}'
        attested = await client.post(
            SOURCE_PATH,
            headers={HEADER: source_token, "Content-Type": "application/json"},
            content=source_body,
        )
        assert attested.status_code == 403, attested.text
        async with httpx.AsyncClient(transport=transport, base_url="http://identity") as gateway:
            evidence = await gateway.post(
                "/_internal/v1/authorization/creative-source-evidence",
                headers={"Authorization": "Bearer gateway-test-service-credential-123456"},
                json={
                    "assertion": source_token,
                    "body_base64": base64.b64encode(source_body).decode(),
                },
            )
        assert evidence.status_code == 200, evidence.text
        source_headers = {
            HEADER: source_token,
            "X-Fpl-Creative-Source-Evidence": evidence.json()["evidence"],
            "Content-Type": "application/json",
        }
        altered = await client.post(SOURCE_PATH, content=source_body + b" ", headers=source_headers)
        assert altered.status_code == 403, altered.text
        first = await client.post(SOURCE_PATH, content=source_body, headers=source_headers)
        assert first.status_code == 201, first.text
        repeated = await client.post(SOURCE_PATH, content=source_body, headers=source_headers)
        assert repeated.json() == first.json() and len(source_reads) == 1

    lookup = {
        "assertion": token,
        "source_method": "GET",
        "source_path": item_path,
        "item_id": "other-item",
        "author_id": owner,
    }
    async with httpx.AsyncClient(transport=transport, base_url="http://identity") as peer:
        peer_headers = {"Authorization": "Bearer " + credential}
        assert (await peer.post(PATH, json=lookup)).status_code == 403
        assert (await peer.post(PATH, json=lookup, headers=peer_headers)).status_code == 403
        lookup["item_id"] = item["id"]
        assert (
            await peer.post(PATH, json=lookup, headers={**peer_headers, "Cookie": "x=y"})
        ).status_code == 403
        response = await peer.post(PATH, json=lookup, headers=peer_headers)
        assert response.json() == {"name": "Identity Admin"}, response.text


async def scenario():
    async with app.router.lifespan_context(app):
        async with app.state.database.sessions() as session:
            user, _ = await create_account(
                session,
                username="identity-admin",
                display_name="Identity Admin",
                password=password,
                platform_role="admin",
            )
            owner = user.id
            events = list(await session.scalars(select(AccountEvent)))
            assert len(events) == 1 and events[0].payload["user_id"] == owner
        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1:19000", headers=headers
        ) as client:
            login = await client.post(
                "/v1/auth/login", json={"username": "identity-admin", "password": password}
            )
            assert login.status_code == 200, login.text
            assert login.json()["user"]["id"] == owner
            assert (await client.get("/v1/auth/me")).status_code == 200
            assert (await client.get("/v1/platform/accounts")).status_code == 404
            csrf = client.cookies.get("fpl_csrf")
            unsafe = {"X-CSRF-Token": csrf, "Origin": "http://127.0.0.1:19000"}
            await creative_catalog(client, unsafe, owner)
            rejected = await client.post("/v1/auth/logout")
            assert rejected.status_code == 403
            assert (await client.get("/v1/not-a-real-operation")).status_code == 404
            assert (await client.get("/v1/model-entries")).status_code == 404
            auth_headers = {
                "X-Fpl-Target-Service": "agents",
                "X-Fpl-Request-Method": "GET",
                "X-Fpl-Request-Uri": "/v1/agent-workbench/sessions",
                "X-Fpl-Context": "forged-context",
            }
            authorized = await client.get("/_internal/v1/authorize", headers=auth_headers)
            assert authorized.status_code == 204, authorized.text
            actor = verify_context(
                authorized.headers[HEADER],
                service="agents",
                method="GET",
                path="/v1/agent-workbench/sessions",
                public_key=private.public_key(),
            )
            assert actor.user_id == owner and actor.local
            assert actor.reauthenticated_at is not None
            created_key = await client.post(
                "/v1/account/api-keys",
                headers=unsafe,
                json={"name": "Model attribution fixture", "scopes": ["studio:read"]},
            )
            assert created_key.status_code == 201
            issued = created_key.json()
            key_headers = {
                "X-Fpl-Target-Service": "models",
                "X-Fpl-Request-Method": "GET",
                "X-Fpl-Request-Uri": "/v1/model-inference/options",
                "Authorization": "Bearer " + issued["secret"],
            }

            async def authorize_key():
                async with httpx.AsyncClient(
                    transport=transport,
                    base_url="http://127.0.0.1:19000",
                    headers={**headers, **key_headers},
                ) as automation:
                    return await automation.get("/_internal/v1/authorize")

            key_context = await authorize_key()
            assert key_context.status_code == 204
            key_actor = verify_context(
                key_context.headers[HEADER],
                service="models",
                method="GET",
                path="/v1/model-inference/options",
                public_key=private.public_key(),
            )
            assert key_actor.user_id == owner and not key_actor.local
            assert key_actor.api_key_name == issued["api_key"]["name"]
            assert key_actor.api_key_prefix == issued["api_key"]["key_prefix"]
            assert issued["secret"] not in repr(key_actor)
            key_revoke = await client.post(
                "/v1/account/api-keys/" + issued["api_key"]["id"] + "/revoke",
                headers=unsafe,
                json={"expected_revision": issued["api_key"]["revision"]},
            )
            assert key_revoke.status_code == 200
            assert (await authorize_key()).status_code == 401
            live_body = {
                "service": "agents",
                "method": "GET",
                "path": "/v1/agent-workbench/sessions",
                "assertion": authorized.headers[HEADER],
            }
            live_headers = {"Authorization": "Bearer agents-test-service-credential-123456"}
            live = await client.post(
                "/_internal/v1/authorization/live", json=live_body, headers=live_headers
            )
            assert live.status_code == 200 and live.json()["active"] is True
            task_body = {
                "service": "agents",
                "owner_user_id": owner,
                "permission": "cloud-control.access",
            }
            task = await client.post(
                "/_internal/v1/tasks/authorize", json=task_body, headers=live_headers
            )
            assert task.status_code == 200 and task.json()["allowed"] is True
            assert type(task.json()["revision"]) is int
            forbidden = await client.post(
                "/_internal/v1/tasks/authorize",
                json={**task_body, "permission": "configuration.manage"},
                headers=live_headers,
            )
            assert forbidden.status_code == 403
            anonymous = await client.post("/_internal/v1/tasks/authorize", json=task_body)
            assert anonymous.status_code == 403
            unknown_owner = await client.post(
                "/_internal/v1/tasks/authorize",
                json={**task_body, "owner_user_id": "absent"},
                headers=live_headers,
            )
            assert unknown_owner.status_code == 200 and unknown_owner.json()["allowed"] is False
            unauthenticated_live = await client.post(
                "/_internal/v1/authorization/live", json=live_body
            )
            assert unauthenticated_live.status_code == 403
            source = await client.get(
                "/_internal/v1/authorize",
                headers={
                    **unsafe,
                    "X-Fpl-Target-Service": "gateway",
                    "X-Fpl-Request-Method": "POST",
                    "X-Fpl-Request-Uri": "/v1/automation/open",
                },
            )
            assert source.status_code == 204, source.text
            delegation_body = {
                "caller": "gateway",
                "purpose": "automation.resource.read",
                "source_method": "POST",
                "source_path": "/v1/automation/open",
                "target_service": "visual",
                "target_method": "GET",
                "target_path": "/v1/visual-workshop/projects/owned-id",
                "assertion": source.headers[HEADER],
            }
            delegation_headers = {"Authorization": "Bearer gateway-test-service-credential-123456"}
            delegated = await client.post(
                "/_internal/v1/authorization/delegate",
                headers=delegation_headers,
                json=delegation_body,
            )
            assert delegated.status_code == 200, delegated.text
            delegated_actor = verify_context(
                delegated.json()["assertion"],
                service="visual",
                method="GET",
                path=delegation_body["target_path"],
                public_key=private.public_key(),
            )
            assert delegated_actor.user_id == owner and delegated_actor.local is False
            rejected_delegation = await client.post(
                "/_internal/v1/authorization/delegate", headers=live_headers, json=delegation_body
            )
            assert rejected_delegation.status_code == 403
            wrong_source = await client.post(
                "/_internal/v1/authorization/delegate",
                headers=delegation_headers,
                json={**delegation_body, "assertion": authorized.headers[HEADER]},
            )
            assert wrong_source.status_code == 401
            asset_source = await client.get(
                "/_internal/v1/authorize",
                headers={
                    **auth_headers,
                    "X-Fpl-Target-Service": "assets",
                    "X-Fpl-Request-Method": "GET",
                    "X-Fpl-Request-Uri": "/v1/files",
                },
            )
            assert asset_source.status_code == 204, asset_source.text
            asset_grant = {
                **delegation_body,
                "caller": "assets",
                "purpose": "assets.visual-project.read",
                "source_method": "GET",
                "source_path": "/v1/files",
                "assertion": asset_source.headers[HEADER],
            }
            asset_headers = {"Authorization": "Bearer assets-test-service-credential-123456"}
            asset_result = await client.post(
                "/_internal/v1/authorization/delegate", headers=asset_headers, json=asset_grant
            )
            assert asset_result.status_code == 200, asset_result.text
            asset_actor = verify_context(
                asset_result.json()["assertion"],
                service="visual",
                method="GET",
                path=asset_grant["target_path"],
                public_key=private.public_key(),
            )
            assert asset_actor.user_id == owner and asset_actor.local is False
            assert (
                await client.post(
                    "/_internal/v1/authorization/delegate",
                    headers=delegation_headers,
                    json=asset_grant,
                )
            ).status_code == 403
            forged = await client.get(
                "/_internal/v1/authorize", headers={**auth_headers, "X-Fpl-Gateway": "untrusted"}
            )
            assert forged.status_code == 403
            wrong_service = await client.get(
                "/_internal/v1/authorize",
                headers={**auth_headers, "X-Fpl-Target-Service": "remote"},
            )
            assert wrong_service.status_code == 403
            management_headers = {
                "Host": "127.0.0.1:19002",
                "Origin": "http://127.0.0.1:19002",
                "X-Fpl-Gateway": "management-test-gateway-" * 3,
            }
            management_login = await client.post(
                "/v1/auth/login",
                json={"username": "identity-admin", "password": password},
                headers=management_headers,
            )
            assert management_login.status_code == 200
            management_headers["X-CSRF-Token"] = client.cookies["fpl_management_csrf"]
            created = await client.post(
                "/v1/platform/accounts",
                headers=management_headers,
                json={
                    "username": "second-account",
                    "display_name": "Second Account",
                    "email": "",
                    "platform_role": "user",
                },
            )
            assert created.status_code == 201, created.text
            async with app.state.database.sessions() as session:
                events = list(await session.scalars(select(AccountEvent)))
                assert len(events) == 2
            creative_source = await client.get(
                "/_internal/v1/authorize",
                headers={
                    **unsafe,
                    "X-Fpl-Target-Service": "creative",
                    "X-Fpl-Request-Method": "POST",
                    "X-Fpl-Request-Uri": SOURCE_PATH,
                },
            )
            assert creative_source.status_code == 204, creative_source.text
            source_token = creative_source.headers[HEADER]
            raw = b'{"kind":"skill","source_id":"owned-id"}'
            evidence_path = "/_internal/v1/authorization/creative-source-evidence"
            evidence_body = {
                "assertion": source_token,
                "body_base64": base64.b64encode(raw).decode(),
            }
            evidence_headers = {"Authorization": "Bearer gateway-test-service-credential-123456"}
            minted = await client.post(evidence_path, headers=evidence_headers, json=evidence_body)
            assert minted.status_code == 200, minted.text
            token = minted.json()["evidence"]
            source_claims = jwt.decode(
                source_token,
                private.public_key(),
                algorithms=["EdDSA"],
                issuer="fpl-identity",
                audience="creative",
            )
            expected = dict(
                public_key=private.public_key(),
                owner_user_id=owner,
                request_id=source_claims["jti"],
                body_sha256=hashlib.sha256(raw).hexdigest(),
                kind="skill",
                source_id="owned-id",
            )
            assert verify_source_evidence(token, **expected).owner_user_id == owner
            # Reuse remains valid only for the identical scope until expiry.
            assert verify_source_evidence(token, **expected).request_id == source_claims["jti"]
            for change in (
                {"owner_user_id": "other"},
                {"kind": "mcp"},
                {"source_id": "other"},
                {"body_sha256": "0" * 64},
                {"request_id": "other"},
            ):
                try:
                    verify_source_evidence(token, **(expected | change))
                    raise AssertionError("mismatched evidence accepted")
                except jwt.InvalidTokenError:
                    pass
            try:
                verify_source_evidence(token + "x", **expected)
                raise AssertionError("tampered evidence accepted")
            except jwt.InvalidTokenError:
                pass
            assert (
                await client.post(evidence_path, headers=live_headers, json=evidence_body)
            ).status_code == 403
            for bad in (
                b'{"kind":"skill","kind":"mcp","source_id":"x"}',
                b'{"kind":"skill","source_id":"x","extra":1}',
                b'{"kind":"bundle","source_id":"x"}',
                b"\xff",
                b"x" * 16385,
            ):
                response = await client.post(
                    evidence_path,
                    headers=evidence_headers,
                    json={**evidence_body, "body_base64": base64.b64encode(bad).decode()},
                )
                assert response.status_code == 400
                assert response.json()["detail"] == "creative_evidence_request_invalid"
            assert (
                await client.post(
                    evidence_path,
                    headers=evidence_headers,
                    json={**evidence_body, "assertion": source_token + "x"},
                )
            ).status_code == 400
            original_gateway = app.state.identity_options["service_credentials"]["gateway"]
            app.state.identity_options["service_credentials"]["assets"] = original_gateway
            assert (
                await client.post(evidence_path, headers=evidence_headers, json=evidence_body)
            ).status_code == 403
            app.state.identity_options["service_credentials"]["assets"] = (
                "assets-test-service-credential-123456"
            )
            install_source = await client.get(
                "/_internal/v1/authorize",
                headers={
                    **unsafe,
                    "X-Fpl-Target-Service": "creative",
                    "X-Fpl-Request-Method": "POST",
                    "X-Fpl-Request-Uri": INSTALL_PATH,
                },
            )
            assert install_source.status_code == 204
            install_token = install_source.headers[HEADER]
            install_raw = b'{"release_id":"release-1","names":{"release-1":"Local name"}}'
            install_path = "/_internal/v1/authorization/creative-install-evidence"
            install_body = {
                "assertion": install_token,
                "body_base64": base64.b64encode(install_raw).decode(),
            }
            install_evidence = await client.post(
                install_path, headers=evidence_headers, json=install_body
            )
            assert install_evidence.status_code == 200, install_evidence.text
            claims = jwt.decode(
                install_token,
                private.public_key(),
                algorithms=["EdDSA"],
                issuer="fpl-identity",
                audience="creative",
            )
            install_expected = dict(
                public_key=private.public_key(),
                owner_user_id=owner,
                request_id=claims["jti"],
                body_sha256=hashlib.sha256(install_raw).hexdigest(),
                release_id="release-1",
            )
            assert (
                verify_install_evidence(
                    install_evidence.json()["evidence"], **install_expected
                ).owner_user_id
                == owner
            )
            from studio.apps.creative_workshop.install_authorization import (
                IdentityInstallAuthorization,
                InstallAuthorizationDenied,
                InstallSource,
            )
            from studio.apps.identity.clients.authorization import LiveAuthorization
            from studio.contracts.creative_workshop.catalog import CreativeInstallPreviewIn

            live_creative = LiveAuthorization(
                service="creative",
                credential="creative-test-service-credential-123456",
                transport=transport,
            )
            authorizer = IdentityInstallAuthorization(
                public_key=private.public_key(), identity=live_creative
            )
            install_source_value = InstallSource(
                install_token, install_evidence.json()["evidence"], install_raw
            )
            install_request = CreativeInstallPreviewIn.model_validate_json(install_raw)
            assert await authorizer.require(install_source_value, install_request) == owner
            for bad in (
                {"owner_user_id": "other"},
                {"request_id": "other"},
                {"body_sha256": "0" * 64},
                {"release_id": "other"},
            ):
                try:
                    verify_install_evidence(
                        install_evidence.json()["evidence"], **(install_expected | bad)
                    )
                    raise AssertionError("mismatched install evidence accepted")
                except jwt.InvalidTokenError:
                    pass
            for raw_bad in (
                b'{"release_id":"one","release_id":"two"}',
                b'{"release_id":"one","names":{"one":3}}',
                b'{"release_id":"one","extra":true}',
            ):
                response = await client.post(
                    install_path,
                    headers=evidence_headers,
                    json={**install_body, "body_base64": base64.b64encode(raw_bad).decode()},
                )
                assert response.status_code == 400
            assert (
                await client.post(
                    install_path,
                    headers=evidence_headers,
                    json={**install_body, "assertion": source_token},
                )
            ).status_code == 400
            assert (
                await client.post(install_path, headers=live_headers, json=install_body)
            ).status_code == 403
            expired_actor = verify_context(
                source_token,
                service="creative",
                method="POST",
                path=SOURCE_PATH,
                public_key=private.public_key(),
            )
            expired_token = issue_context(
                expired_actor,
                service="creative",
                method="POST",
                path=SOURCE_PATH,
                private_key=private,
                key_id="identity-1",
                now=int(time.time()) - 30,
            )
            assert (
                await client.post(
                    evidence_path,
                    headers=evidence_headers,
                    json={**evidence_body, "assertion": expired_token},
                )
            ).status_code == 400
            write_key = await client.post(
                "/v1/account/api-keys",
                headers=unsafe,
                json={"name": "Creative evidence", "scopes": ["studio:write"]},
            )
            assert write_key.status_code == 201
            key_info = write_key.json()["api_key"]
            key_actor = replace(
                expired_actor,
                auth_kind="management_api_key",
                session_id=None,
                api_key_id=key_info["id"],
                local=False,
                scopes=("studio:write", "studio:read", "studio:private_read"),
            )
            key_token = issue_context(
                key_actor,
                service="creative",
                method="POST",
                path=SOURCE_PATH,
                private_key=private,
                key_id="identity-1",
            )
            key_body = {**evidence_body, "assertion": key_token}
            assert (
                await client.post(evidence_path, headers=evidence_headers, json=key_body)
            ).status_code == 200
            key_revoked = await client.post(
                "/v1/account/api-keys/" + key_info["id"] + "/revoke",
                headers=unsafe,
                json={"expected_revision": key_info["revision"]},
            )
            assert key_revoked.status_code == 200
            assert (
                await client.post(evidence_path, headers=evidence_headers, json=key_body)
            ).status_code == 401
            logout = await client.post("/v1/auth/logout", headers=unsafe)
            assert logout.status_code == 204, logout.text
            assert (
                await client.post(evidence_path, headers=evidence_headers, json=evidence_body)
            ).status_code == 401
            assert (
                await client.post(install_path, headers=evidence_headers, json=install_body)
            ).status_code == 401
            try:
                await authorizer.require(install_source_value, install_request)
                raise AssertionError("revoked installation authorized")
            except InstallAuthorizationDenied:
                pass
            await live_creative.close()
            revoked_delegation = await client.post(
                "/_internal/v1/authorization/delegate",
                headers=delegation_headers,
                json=delegation_body,
            )
            assert revoked_delegation.status_code == 401
            revoked_asset_grant = await client.post(
                "/_internal/v1/authorization/delegate",
                headers=asset_headers,
                json=asset_grant,
            )
            assert revoked_asset_grant.status_code == 401
            revoked = await client.get("/_internal/v1/authorize", headers=auth_headers)
            assert revoked.status_code == 401
            live = await client.post(
                "/_internal/v1/authorization/live", json=live_body, headers=live_headers
            )
            assert live.status_code == 200 and live.json()["active"] is False

        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1:19000"
        ) as direct:
            response = await direct.post(
                "/v1/auth/login",
                headers={"X-Fpl-Ingress": "local"},
                json={"username": "identity-admin", "password": password},
            )
            assert response.status_code == 403
        async with httpx.AsyncClient(
            transport=transport,
            base_url="https://studio.example.test",
            headers={**headers, "X-Fpl-Ingress": "public"},
        ) as public:
            login = await public.post(
                "/v1/auth/login", json={"username": "identity-admin", "password": password}
            )
            assert login.status_code == 200, login.text
            assert all(
                "; secure" in value.lower() for value in login.headers.get_list("set-cookie")
            )
            assert (await public.get("/v1/auth/me")).status_code == 200
            spoof = await public.get("/v1/auth/me", headers={"X-Fpl-Ingress": "local"})
            assert spoof.status_code == 403
            assert login.headers["Cache-Control"] == "no-store"

        async with app.state.database.engine.connect() as connection:
            names = set(
                (
                    await connection.exec_driver_sql(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                ).scalars()
            )
            assert names == {
                "users",
                "auth_sessions",
                "management_api_keys",
                "security_audit_events",
                "registration_invite_codes",
                "registration_redemptions",
                "identity_account_events",
                "identity_model_audit_receipts",
                "identity_visual_generation_approvals",
                "identity_model_audit_intents",
                "identity_integration_intents",
                "identity_certification_audit_receipts",
                "identity_import_receipts",
                "cloud_control_factors",
                "cloud_control_unlocks",
                "_fpl_service_schema",
            }, names
    assert (
        "studio.assembly.website.application" not in sys.modules
        and "studio.assembly.website.models" not in sys.modules
    )
    assert not any(
        name.startswith("studio.apps.model_service") or name.startswith("app.apps")
        for name in sys.modules
    )


asyncio.run(scenario())
print("Identity isolated accounts, sessions, CSRF, assertions and durable events passed")
