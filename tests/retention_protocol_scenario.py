"""Real Identity + owned Assets HTTP retention; all storage lives in the test directory."""

import asyncio
import os
from dataclasses import replace
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from starlette.responses import JSONResponse

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.problem_details import http_exception_handler, validation_exception_handler
from fpl_assets.migrations.registry import MIGRATIONS as ASSET_MIGRATIONS
from fpl_assets.models import MODELS
from fpl_assets.reference_changes import ReferenceChanges
from fpl_assets.retention_api import router
from fpl_identity.accounts import create_account
from fpl_identity.application import create_app
from fpl_identity.migrations.registry import MIGRATIONS
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied
from fpl_runtime.claims import HEADER, issue_context, verify_context
from fpl_runtime.database import Database
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.retention_authority import verify_retention
from fpl_runtime.retention_client import RetentionClient
from fpl_runtime.routing import RouteCatalog

state = Path(os.environ["IDENTITY_TEST_ROOT"])
private = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
credential = "thought-test-retention-credential-1234567890"
asset_credential = "assets-test-retention-credential-1234567890"
app = create_app(
    state_root=state,
    catalog=catalog,
    gateway_token="gateway-retention-test-" * 3,
    local_origin="http://127.0.0.1:19000",
    public_origin="https://studio.example.test",
    private_key=private,
    service_credentials={"thought": credential, "assets": asset_credential},
)
apply(state / "service.db", "identity", MIGRATIONS)
asset_root = state.parent / "assets"
apply(asset_root / "service.db", "assets", ASSET_MIGRATIONS)
database = Database("assets", asset_root, models=MODELS)
assets = FastAPI()
assets.state.identity_public_key = private.public_key()
assets.state.reference_changes = ReferenceChanges(database)
assets.include_router(router)
assets.add_exception_handler(HTTPException, http_exception_handler)
assets.add_exception_handler(RequestValidationError, validation_exception_handler)


async def asset_error(_request, exc):
    return JSONResponse(
        {"code": exc.code}, status_code=exc.status, headers={"Cache-Control": "no-store"}
    )


assets.add_exception_handler(AssetError, asset_error)
identity_transport = httpx.ASGITransport(app=app)
asset_transport = httpx.ASGITransport(app=assets)


class Transport(httpx.AsyncBaseTransport):
    async def handle_async_request(self, request):
        assert not request.headers.get("cookie")
        if request.url.host == "identity":
            return await identity_transport.handle_async_request(request)
        assert request.url.host == "assets"
        return await asset_transport.handle_async_request(request)


transport = Transport()
assets.state.identity = LiveAuthorization(
    service="assets",
    credential=asset_credential,
    transport=transport,
)
headers = {
    "X-Fpl-Gateway": "gateway-retention-test-" * 3,
    "X-Fpl-Ingress": "local",
    "X-Fpl-Client-Ip": "127.0.0.1",
}
password = "Retention-Test-Password-2026!"


def change(request_id, **overrides):
    return PrepareReferenceChange(
        **{
            "request_id": request_id,
            "resource_kind": "note",
            "resource_id": "owned-note",
            "expected_resource_revision": -1,
            "asset_ids": ["owned-file"],
            **overrides,
        }
    )


async def scenario():
    try:
        async with app.router.lifespan_context(app):
            async with app.state.database.sessions() as session:
                owner, _ = await create_account(
                    session,
                    username="retention-owner",
                    display_name="Retention Owner",
                    password=password,
                    platform_role="user",
                )
                owner_id = owner.id
            async with database.sessions() as session:
                session.info["owner_user_id"] = owner_id
                session.add(
                    VisualAsset(
                        id="owned-file",
                        owner_user_id=owner_id,
                        original_filename="test.png",
                        display_name="Test",
                        storage_key="owned",
                        storage_version=2,
                        media_kind="image",
                        mime_type="image/png",
                        byte_size=100,
                    )
                )
                await session.commit()
            async with httpx.AsyncClient(
                transport=identity_transport, base_url="http://127.0.0.1:19000", headers=headers
            ) as browser:
                response = await browser.post(
                    "/v1/auth/login",
                    json={
                        "username": "retention-owner",
                        "password": password,
                    },
                )
                assert response.status_code == 200, response.text
                csrf = browser.cookies["fpl_csrf"]
                unsafe = {"X-CSRF-Token": csrf, "Origin": "http://127.0.0.1:19000"}
                response = await browser.get(
                    "/_internal/v1/authorize",
                    headers={
                        **unsafe,
                        "X-Fpl-Target-Service": "thought",
                        "X-Fpl-Request-Method": "PUT",
                        "X-Fpl-Request-Uri": "/v1/thought-workshop/notes/owned-note",
                    },
                )
                assert response.status_code == 204, response.text
                assertion = response.headers[HEADER]
                actor = verify_context(
                    assertion,
                    service="thought",
                    method="PUT",
                    path="/v1/thought-workshop/notes/owned-note",
                    public_key=private.public_key(),
                )
                assert actor.user_id == owner_id
                client = RetentionClient(
                    service="thought", credential=credential, transport=transport
                )
                try:
                    value = change("first")
                    authority = await client.authorize(
                        assertion=assertion,
                        source_method="PUT",
                        source_path="/v1/thought-workshop/notes/owned-note",
                        change=value,
                    )
                    for forbidden in (
                        change("wrong-note", resource_id="another-note"),
                        change("wrong-kind", resource_kind="template"),
                    ):
                        try:
                            await client.authorize(
                                assertion=assertion,
                                source_method="PUT",
                                source_path="/v1/thought-workshop/notes/owned-note",
                                change=forbidden,
                            )
                        except CapabilityDenied as exc:
                            assert exc.status == 403
                        else:
                            raise AssertionError("Different resource received retention authority")
                    try:
                        await client.authorize(
                            assertion=assertion,
                            source_method="PUT",
                            source_path="/v1/thought-workshop/notes/another-note",
                            change=change("wrong-path", resource_id="another-note"),
                        )
                    except CapabilityDenied as exc:
                        assert exc.status == 401
                    else:
                        raise AssertionError("Original request assertion was rebound")
                    try:
                        await client.authorize(
                            assertion=assertion,
                            source_method="POST",
                            source_path="/v1/thought-workshop/notes/owned-note/operations",
                            change=change("wrong-method"),
                        )
                    except CapabilityDenied as exc:
                        assert exc.status == 401
                    else:
                        raise AssertionError("Original PUT assertion authorized a POST")
                    operations_path = "/v1/thought-workshop/notes/owned-note/operations"
                    supported_paths = (
                        operations_path,
                        "/v1/thought-workshop/notes/owned-note/history/old/restore",
                        "/v1/thought-workshop/notes/owned-note/multitable/operations",
                        "/v1/thought-workshop/notes/owned-note/multitable/history/2/restore",
                        "/v1/thought-workshop/notes/owned-note/multitable/tables/table/csv-import",
                    )
                    for index, path in enumerate(supported_paths):
                        source = issue_context(
                            actor,
                            service="thought",
                            method="POST",
                            path=path,
                            private_key=private,
                            key_id="test",
                        )
                        exact = change(f"operations-exact-{index}")
                        operation_authority = await client.authorize(
                            assertion=source, source_method="POST", source_path=path, change=exact
                        )
                        assert verify_retention(
                            operation_authority, public_key=private.public_key()
                        ).matches(exact)
                        for forbidden in (
                            change(f"operations-other-{index}", resource_id="another-note"),
                            change(
                                f"operations-template-{index}",
                                resource_kind="template",
                                resource_id="another",
                            ),
                        ):
                            try:
                                await client.authorize(
                                    assertion=source,
                                    source_method="POST",
                                    source_path=path,
                                    change=forbidden,
                                )
                            except CapabilityDenied as exc:
                                assert exc.status == 403
                            else:
                                raise AssertionError("Note operation authorized another resource")
                    # A creation authority can initialize only a new template projection.
                    create_path = "/v1/thought-workshop/templates"
                    create_assertion = issue_context(
                        actor,
                        service="thought",
                        method="POST",
                        path=create_path,
                        private_key=private,
                        key_id="test",
                    )
                    fresh = change(
                        "new-template",
                        resource_kind="template",
                        resource_id="12345678-1234-4234-8234-123456789abc",
                    )
                    fresh_authority = await client.authorize(
                        assertion=create_assertion,
                        source_method="POST",
                        source_path=create_path,
                        change=fresh,
                    )
                    assert verify_retention(
                        fresh_authority, public_key=private.public_key()
                    ).matches(fresh)
                    for forbidden in (
                        change("wrong-kind", resource_kind="note", resource_id=fresh.resource_id),
                        change(
                            "wrong-revision",
                            resource_kind="template",
                            resource_id=fresh.resource_id,
                            expected_resource_revision=0,
                        ),
                        change(
                            "wrong-id", resource_kind="template", resource_id="existing-template"
                        ),
                    ):
                        try:
                            await client.authorize(
                                assertion=create_assertion,
                                source_method="POST",
                                source_path=create_path,
                                change=forbidden,
                            )
                        except CapabilityDenied as exc:
                            assert exc.status == 403
                        else:
                            raise AssertionError(
                                "Template creation authorized a non-creation change"
                            )
                    apply_path = "/v1/thought-workshop/templates/example/apply"
                    apply_assertion = issue_context(
                        actor,
                        service="thought",
                        method="POST",
                        path=apply_path,
                        private_key=private,
                        key_id="test",
                    )
                    new_note = change(
                        "new-note", resource_id="12345678-1234-4234-8234-123456789abc"
                    )
                    auth = await client.authorize(
                        assertion=apply_assertion,
                        source_method="POST",
                        source_path=apply_path,
                        change=new_note,
                    )
                    assert verify_retention(auth, public_key=private.public_key()).matches(new_note)
                    for forbidden in (
                        change(
                            "apply-kind", resource_kind="template", resource_id=new_note.resource_id
                        ),
                        change(
                            "apply-version",
                            resource_id=new_note.resource_id,
                            expected_resource_revision=0,
                        ),
                        change("apply-id", resource_id="existing-note"),
                    ):
                        try:
                            await client.authorize(
                                assertion=apply_assertion,
                                source_method="POST",
                                source_path=apply_path,
                                change=forbidden,
                            )
                        except CapabilityDenied as exc:
                            assert exc.status == 403
                        else:
                            raise AssertionError("Template apply authorized a non-creation change")
                    forged = issue_context(
                        replace(actor, user_id="different-owner"),
                        service="thought",
                        method="PUT",
                        path="/v1/thought-workshop/notes/owned-note",
                        private_key=private,
                        key_id="test",
                    )
                    try:
                        await client.authorize(
                            assertion=forged,
                            source_method="PUT",
                            source_path="/v1/thought-workshop/notes/owned-note",
                            change=change("wrong-actor"),
                        )
                    except CapabilityDenied as exc:
                        assert exc.status == 401
                    else:
                        raise AssertionError("An unrelated account reused another session")
                    create_template_path = "/v1/thought-workshop/templates"
                    create_template_assertion = issue_context(
                        actor,
                        service="thought",
                        method="POST",
                        path=create_template_path,
                        private_key=private,
                        key_id="test",
                    )
                    try:
                        await client.authorize(
                            assertion=create_template_assertion,
                            source_method="POST",
                            source_path=create_template_path,
                            change=change("wrong-create-kind"),
                        )
                    except CapabilityDenied as exc:
                        assert exc.status == 403
                    else:
                        raise AssertionError("Template creation authorized non-template resource")
                    try:
                        await client.authorize(
                            assertion=create_template_assertion,
                            source_method="POST",
                            source_path=create_template_path,
                            change=change(
                                "new-template", resource_kind="template", resource_id="fresh"
                            ),
                        )
                    except CapabilityDenied as exc:
                        assert exc.status == 403
                    else:
                        raise AssertionError("Unbound creation received retention authority")
                    template_path = "/v1/thought-workshop/templates/owned-template"
                    template_assertion = issue_context(
                        actor,
                        service="thought",
                        method="PUT",
                        path=template_path,
                        private_key=private,
                        key_id="test",
                    )
                    template_change = change(
                        "template-correct", resource_kind="template", resource_id="owned-template"
                    )
                    template_authority = await client.authorize(
                        assertion=template_assertion,
                        source_method="PUT",
                        source_path=template_path,
                        change=template_change,
                    )
                    assert verify_retention(
                        template_authority, public_key=private.public_key()
                    ).matches(template_change)
                    for forbidden in (
                        change("template-wrong-id", resource_kind="template", resource_id="other"),
                        change(
                            "template-wrong-kind",
                            resource_kind="note",
                            resource_id="owned-template",
                        ),
                    ):
                        try:
                            await client.authorize(
                                assertion=template_assertion,
                                source_method="PUT",
                                source_path=template_path,
                                change=forbidden,
                            )
                        except CapabilityDenied as exc:
                            assert exc.status == 403
                        else:
                            raise AssertionError("Template grant was bound to a different resource")
                    grant = verify_retention(authority, public_key=private.public_key())
                    assert grant.actor.user_id == owner_id and grant.matches(value)
                    for method, path in (("POST", "/v1/files"), ("GET", "/v1/files")):
                        try:
                            verify_context(
                                authority,
                                service="assets",
                                method=method,
                                path=path,
                                public_key=private.public_key(),
                            )
                        except Exception:
                            pass
                        else:
                            raise AssertionError("Retention authority became a public bearer")
                    prepared = await client.prepare(authority=authority, change=value)
                    assert prepared["state"] == "prepared"
                    assert await client.prepare(authority=authority, change=value) == prepared
                    with_client = await client.status(
                        authority=authority, intent_id=prepared["intent_id"]
                    )
                    assert with_client["state"] == "prepared"
                    try:
                        await client.prepare(
                            authority=authority, change=change("first", asset_ids=[])
                        )
                    except CapabilityDenied as exc:
                        assert exc.status == 403
                    else:
                        raise AssertionError("Authority accepted a different asset set")
                    # A second authority cannot settle the first mutation's outcome.
                    another = await client.authorize(
                        assertion=assertion,
                        source_method="PUT",
                        source_path="/v1/thought-workshop/notes/owned-note",
                        change=change("second"),
                    )
                    try:
                        await client.abort(authority=another, intent_id=prepared["intent_id"])
                    except CapabilityDenied as exc:
                        assert exc.status == 404
                    else:
                        raise AssertionError("Wrong intent was settled")
                    assert (
                        await browser.post("/v1/auth/logout", headers=unsafe)
                    ).status_code == 204
                    # Revocation denies NEW preparation and authority issuance.
                    try:
                        await client.prepare(authority=another, change=change("second"))
                    except CapabilityDenied as exc:
                        assert exc.status == 403
                    else:
                        raise AssertionError("Logged-out session accepted another mutation")
                    try:
                        await client.authorize(
                            assertion=assertion,
                            source_method="PUT",
                            source_path="/v1/thought-workshop/notes/owned-note",
                            change=change("third"),
                        )
                    except CapabilityDenied as exc:
                        assert exc.status == 401
                    else:
                        raise AssertionError("Revoked session minted new authority")
                    # The source's durable commit can still be acknowledged after logout.
                    outcome = await client.commit(
                        authority=authority, intent_id=prepared["intent_id"], resource_revision=0
                    )
                    assert outcome["state"] == "committed"
                    assert (
                        await client.commit(
                            authority=authority,
                            intent_id=prepared["intent_id"],
                            resource_revision=0,
                        )
                        == outcome
                    )
                    # Lost preparation acknowledgement does not admit a new mutation.
                    assert await client.prepare(authority=authority, change=value) == prepared
                    try:
                        await client.abort(authority=authority, intent_id=prepared["intent_id"])
                    except CapabilityDenied as exc:
                        assert exc.status == 409
                    else:
                        raise AssertionError("Durable commit outcome was rewritten")
                    assert not any(path.startswith("/_internal") for path in app.openapi()["paths"])
                    assert not assets.openapi()["paths"]
                finally:
                    await client.close()
    finally:
        await assets.state.identity.close()
        await database.close()


asyncio.run(scenario())
print("retention protocol passed: owned mutation, revocation, replay and finalization")
