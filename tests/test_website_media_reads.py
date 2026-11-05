"""Real website identity is rechecked after processing, using only the isolated test database."""

import io

import httpx
import pytest
from PIL import Image
from tests.test_account_system import (
    create_test_account,
    login_and_change_password,
    unsafe_headers,
)

from website_test_support import app


@pytest.mark.real_auth
async def test_crop_shares_processor_and_rechecks_revoked_session(monkeypatch):
    username, temporary = await create_test_account()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await login_and_change_password(client, username, temporary)
        image = io.BytesIO()
        Image.new("RGB", (8, 6), "red").save(image, "PNG")
        upload = await client.post(
            "/v1/files",
            headers=unsafe_headers(client),
            files={"upload": ("picture.png", image.getvalue(), "image/png")},
        )
        assert upload.status_code in {200, 201}, upload.text
        identifier = upload.json()["id"]
        body = {"x": 0, "y": 0, "width": 2, "height": 3}
        path = f"/v1/files/{identifier}/crop"
        cropped = await client.post(path, json=body, headers=unsafe_headers(client))
        assert cropped.status_code == 200, cropped.text
        with Image.open(io.BytesIO(cropped.content)) as result:
            assert result.size == (2, 3)

        factory = app.state.media_reads

        def reads(request):
            case = factory(request)
            original = case.processor

            class Processor:
                async def crop(self, source, command):
                    # A second request revokes the credential after processing. The
                    # first operation holds no read transaction and discards the bytes.
                    result = await original.crop(source, command)
                    response = await client.post("/v1/auth/logout", headers=unsafe_headers(client))
                    assert response.status_code in {200, 204}, response.text
                    return result

            case.processor = Processor()
            return case

        monkeypatch.setattr(app.state, "media_reads", reads)
        rejected = await client.post(path, json=body, headers=unsafe_headers(client))
        assert rejected.status_code == 401, rejected.text


@pytest.mark.real_auth
async def test_upload_uses_the_current_website_file_limit(monkeypatch):
    username, temporary = await create_test_account()
    settings = app.state.settings.model_copy(update={"fpl_visual_asset_max_bytes": 8})
    monkeypatch.setattr(app.state, "settings", settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await login_and_change_password(client, username, temporary)
        image = io.BytesIO()
        Image.new("RGB", (2, 2), "red").save(image, "PNG")
        rejected = await client.post(
            "/v1/files",
            headers=unsafe_headers(client),
            files={"upload": ("too-large.png", image.getvalue(), "image/png")},
        )
        assert rejected.status_code == 413, rejected.text
        assert rejected.json()["code"] == "file_too_large"
        files = await client.get("/v1/files")
        assert files.status_code == 200
        assert files.json()["items"] == []
