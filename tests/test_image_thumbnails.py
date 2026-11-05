"""Bounded derived image previews, real browser auth and publication revocation."""

import asyncio
import io

import pytest
from PIL import Image
from tests.test_knowledge_community import COMM, ROOT
from tests.test_knowledge_community import community as community
from tests.test_thought_knowledge_tools import doc

from studio.runtime.files.raster import RasterPreviews

pytestmark = [pytest.mark.asyncio, pytest.mark.real_auth]


def png(size=(1600, 800)):
    output = io.BytesIO()
    Image.new("RGBA", size, (220, 50, 40, 110)).save(output, "PNG")
    return output.getvalue()


async def test_orientation_transparency_and_concurrent_atomic_generation(tmp_path):
    source = tmp_path / "source.png"
    source.write_bytes(png())
    target = tmp_path / "previews" / "128.webp"
    previews = RasterPreviews()
    await asyncio.gather(*(previews.render(source, target, 128) for _ in range(4)))
    with Image.open(target) as image:
        assert image.size == (128, 64)
        assert image.getpixel((20, 20))[3] == 110
    assert not list(target.parent.glob("*.tmp"))
    rotated = tmp_path / "rotated.jpg"
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (800, 400), "red").save(rotated, exif=exif)
    await previews.render(rotated, target.parent / "rotated.webp", 320)
    with Image.open(target.parent / "rotated.webp") as image:
        assert image.size == (160, 320)


async def test_authorized_variants_sizes_and_community_revocation(community):
    (owner, reader, other), names, project, notes, config = community
    upload = await owner.post(ROOT + "/images", files={"upload": ("large.png", png(), "image/png")})
    assert upload.status_code == 200, upload.text
    asset = upload.json()["asset_id"]
    for size in (128, 320, 640, 1280):
        response = await owner.get(f"/v1/files/{asset}/thumbnail?size={size}")
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "private, no-store"
        with Image.open(io.BytesIO(response.content)) as image:
            assert image.size == (size, size // 2)
        assert (await other.get(f"/v1/files/{asset}/thumbnail?size={size}")).status_code == 404
    assert (await owner.get(f"/v1/files/{asset}/thumbnail?size=99999")).status_code == 422
    original = await owner.get(f"/v1/files/{asset}/content")
    assert original.content == png()
    note = notes[2]
    document = doc("带图片的成员文档")
    document["content"].append(
        {"type": "image", "attrs": {"assetId": asset, "width": 480, "alt": "图片"}}
    )
    saved = await owner.put(
        ROOT + f"/notes/{note['id']}",
        json={
            "knowledge_base_id": project["id"],
            "expected_revision": note["revision"],
            "title": note["title"],
            "document": document,
            "tags": [],
        },
    )
    assert saved.status_code == 200, saved.text
    base = COMM + f"/publications/{config['publication']['id']}"
    url = base + f"/assets/{asset}/content?note_id={note['id']}&size=320"
    response = await reader.get(url)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/webp")
    assert response.headers["cache-control"] == "private, no-store"
    assert (await other.get(url)).status_code == 404
    # A cached derived file does not grant access after a role is revoked.
    current = (await owner.get(base + "/permissions", params={"note_id": note["id"]})).json()
    setting = current[0] if isinstance(current, list) else current
    setting.pop("title", None)
    setting["members"] = []
    setting["expected_revision"] = setting.pop("revision")
    revoked = await owner.put(base + "/permissions", json={"articles": [setting]})
    assert revoked.status_code == 200, revoked.text
    assert (await reader.get(url)).status_code == 404


async def test_avatar_variants_preserve_original_and_cannot_read_another_account(community):
    (owner, _, other), _, _, _, _ = community
    me = (await owner.get("/v1/auth/me")).json()
    uploaded = await owner.put(
        "/v1/account/profile/avatar",
        data={"expected_revision": str(me["user"]["revision"])},
        files={"file": ("avatar.png", png(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    response = await owner.get("/v1/account/profile/avatar?size=128")
    assert response.status_code == 200, response.text
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (128, 64)
    assert (await owner.get("/v1/account/profile/avatar")).content == png()
    assert (await other.get("/v1/account/profile/avatar?size=128")).status_code == 404


async def test_source_versions_use_distinct_cache_paths_and_unsupported_inputs_fail(tmp_path):
    from dataclasses import replace
    from types import SimpleNamespace

    from studio.apps.asset_library.previews.thumbnails import ThumbnailSource, asset_thumbnail
    from studio.contracts.asset_library.errors import AssetError

    source = tmp_path / "source.png"
    source.write_bytes(png())
    settings = SimpleNamespace(account_path=lambda owner: tmp_path / owner)
    info = ThumbnailSource("asset", 1, "owner", "image", "image/png")
    previews = RasterPreviews()
    first = await asset_thumbnail(settings, info, source, 128, previews=previews)
    second = await asset_thumbnail(
        settings, replace(info, revision=2), source, 128, previews=previews
    )
    assert first != second
    assert first.is_file() and second.is_file()
    source.write_bytes(b"not an image")
    with pytest.raises(AssetError):
        await asset_thumbnail(settings, replace(info, revision=3), source, 128, previews=previews)
    assert not (settings.account_path("owner") / "previews/asset/3-128.webp").exists()


async def test_svg_remains_a_safe_vector_preview(community):
    (owner, _, _), _, _, _, _ = community
    source = (
        b'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">'
        b'<rect width="100" height="50" fill="red"/></svg>'
    )
    upload = await owner.post("/v1/files", files={"upload": ("shape.svg", source, "image/svg+xml")})
    assert upload.status_code == 200, upload.text
    asset = upload.json()["id"]
    response = await owner.get(f"/v1/files/{asset}/thumbnail?size=128")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert "sandbox" in response.headers["content-security-policy"]
    assert b"<svg" in response.content
