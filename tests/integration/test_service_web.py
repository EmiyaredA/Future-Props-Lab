"""Owned program files never fall back to HTML for missing resources or APIs."""

import gzip
import hashlib
import json

import httpx
import pytest
from fastapi import FastAPI

from studio.runtime.http.web import attach_web, load_release


def write_release(root, **changes):
    root.mkdir(exist_ok=True)
    (root / "assets").mkdir(exist_ok=True)
    values = {
        "thought.html": b"<div>owned program</div>",
        "assets/main.js": b"console.log('owned')",
    }
    values["assets/main.js.gz"] = gzip.compress(values["assets/main.js"], mtime=0)
    for name, value in values.items():
        (root / name).write_bytes(value)
    manifest = {
        "version": 1,
        "service": "thought",
        "build_id": "a" * 20,
        "api_sha256": "b" * 64,
        "entry": "thought.html",
        "files": [
            {"path": name, "bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}
            for name, value in values.items()
        ],
        **changes,
    }
    (root / "build.json").write_text(json.dumps(manifest))
    return manifest


async def test_program_pages_assets_ranges_and_missing_resources(tmp_path):
    write_release(tmp_path)
    release = load_release(tmp_path, "thought")
    app = FastAPI()
    attach_web(
        app, release, pages=("/apps/thought-workshop", "/apps/thought-workshop/notes/{note_id}")
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://fixture"
    ) as client:
        page = await client.get("/apps/thought-workshop")
        assert page.status_code == 200 and "owned program" in page.text
        assert page.headers["cache-control"] == "no-cache"
        url = release.prefix + "/assets/main.js"
        encoded = await client.get(url, headers={"Accept-Encoding": "gzip"})
        assert encoded.headers["content-encoding"] == "gzip"
        assert encoded.text == "console.log('owned')"
        assert "immutable" in encoded.headers["cache-control"]
        cached = await client.get(
            url, headers={"Accept-Encoding": "gzip", "If-None-Match": encoded.headers["etag"]}
        )
        assert cached.status_code == 304 and cached.content == b""
        identity = await client.get(url, headers={"Accept-Encoding": "gzip;q=0"})
        assert "content-encoding" not in identity.headers
        part = await client.get(url, headers={"Range": "bytes=0-6", "Accept-Encoding": "gzip"})
        assert part.status_code == 206 and part.text == "console"
        assert "content-encoding" not in part.headers
        for missing in (
            release.prefix + "/assets/missing.js",
            release.prefix + "/assets/main.js.gz",
            "/apps/thought-workshop/missing",
            "/v1/not-found",
            release.prefix + "/../private.txt",
        ):
            response = await client.get(missing, headers={"Accept": "text/html"})
            assert response.status_code == 404
            assert "owned program" not in response.text


async def test_only_outdated_matching_application_writes_are_blocked(tmp_path):
    write_release(tmp_path)
    app = FastAPI()
    writes = []

    @app.post("/v1/example")
    async def action():
        writes.append(True)
        return {"saved": True}

    @app.get("/v1/example")
    async def read():
        return {"saved": bool(writes)}

    attach_web(app, load_release(tmp_path, "thought"), pages=("/apps/thought-workshop",))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://fixture"
    ) as client:
        old = {"X-Application-Id": "thought", "X-Application-Build": "old"}
        response = await client.post("/v1/example", headers=old)
        assert response.status_code == 409 and writes == []
        assert response.headers["x-application-id"] == "thought"
        assert response.headers["x-application-build"] == "a" * 20
        assert (await client.get("/v1/example", headers=old)).status_code == 200
        assert (await client.post("/v1/example")).status_code == 200
        assert (
            await client.post("/v1/example", headers={**old, "X-Application-Id": "portal"})
        ).status_code == 200
        assert (
            await client.post("/v1/example", headers={**old, "X-Application-Build": "a" * 20})
        ).status_code == 200
        assert len(writes) == 3


@pytest.mark.parametrize(
    "change",
    [
        {"service": "portal"},
        {"build_id": "../escape"},
        {"entry": "missing.html"},
        {"api_sha256": "invalid"},
    ],
)
def test_manifest_rejects_wrong_service_or_contract_metadata(tmp_path, change):
    write_release(tmp_path, **change)
    with pytest.raises(ValueError):
        load_release(tmp_path, "thought")


def test_modified_or_untracked_files_and_links_block_program_publication(tmp_path):
    write_release(tmp_path)
    (tmp_path / "assets/main.js").write_text("changed")
    with pytest.raises(ValueError):
        load_release(tmp_path, "thought")
    write_release(tmp_path)
    extra = tmp_path / "private.toml"
    extra.write_text("must not be served")
    with pytest.raises(ValueError):
        load_release(tmp_path, "thought")
    extra.unlink()
    (tmp_path / "linked").symlink_to(tmp_path / "assets", target_is_directory=True)
    with pytest.raises(ValueError):
        load_release(tmp_path, "thought")


async def test_portal_docs_alias_only_redirects_verified_program_resources(tmp_path):
    manifest = write_release(tmp_path, service="portal")
    (tmp_path / "docs").mkdir()
    body = b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"
    (tmp_path / "docs/fixture.svg").write_bytes(body)
    manifest["files"].append(
        {"path": "docs/fixture.svg", "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    )
    (tmp_path / "build.json").write_text(json.dumps(manifest))
    release = load_release(tmp_path, "portal")
    app = FastAPI()
    attach_web(app, release, pages=("/docs.html",), resource_aliases={"/docs/{path:path}": "docs/"})
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://fixture"
    ) as client:
        redirect = await client.get("/docs/fixture.svg")
        assert redirect.status_code == 307 and redirect.headers["cache-control"] == "no-store"
        assert redirect.headers["location"] == release.prefix + "/docs/fixture.svg"
        resource = await client.get(redirect.headers["location"])
        assert resource.content == body and "immutable" in resource.headers["cache-control"]
        assert (await client.get("/docs/missing.svg")).status_code == 404
    manifest["service"] = "thought"
    (tmp_path / "build.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        load_release(tmp_path, "thought")


async def test_frontend_publication_retains_live_tabs_and_rolls_back_without_restart(tmp_path):
    from studio.host.deployment.web_release import activate, seed, stage

    apps = []
    for service, initial_id in [("thought", "a" * 20), ("visual", "c" * 20)]:
        baked = tmp_path / service
        directory = tmp_path / (service + "-versions")
        write_release(baked, service=service, build_id=initial_id)
        release = seed(baked, directory, service)
        app = FastAPI()

        @app.post("/v1/example")
        async def write():
            return {"saved": True}

        attach_web(app, release, pages=("/page",), release_root=directory)
        apps.append(
            (
                httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test"),
                service,
                release,
                directory,
            )
        )

    async with apps[0][0] as old_tab, apps[1][0] as second:
        _, service, baked, directory = apps[0]
        assert (await old_tab.get("/page")).headers["x-application-build"] == baked.build_id
        assert (await second.get("/page")).headers["x-application-build"] == "c" * 20
        candidate = tmp_path / "candidate"
        next_id = "d" * 20
        write_release(candidate, build_id=next_id)
        stage(candidate, directory, service)
        activate(directory, service, next_id, expected=baked.build_id, api_sha256=baked.api_sha256)
        assert (await old_tab.get("/page")).headers["x-application-build"] == next_id
        assert (await second.get("/page")).headers["x-application-build"] == "c" * 20
        _, second_service, second_baked, second_dir = apps[1]
        second_candidate = tmp_path / "second-candidate"
        second_id = "b" * 20
        write_release(second_candidate, service=second_service, build_id=second_id)
        stage(second_candidate, second_dir, second_service)
        activate(
            second_dir,
            second_service,
            second_id,
            expected=second_baked.build_id,
            api_sha256=second_baked.api_sha256,
        )
        assert (await second.get("/page")).headers["x-application-build"] == second_id
        assert (await second.get(second_baked.prefix + "/assets/main.js")).status_code == 200
        assert (await old_tab.get(baked.prefix + "/assets/main.js")).status_code == 200
        assert (await old_tab.get("/_apps/thought/current/build.json")).json()[
            "build_id"
        ] == next_id
        old_headers = {"X-Application-Id": service, "X-Application-Build": baked.build_id}
        assert (await old_tab.post("/v1/example", headers=old_headers)).status_code == 200

        incompatible = tmp_path / "incompatible"
        incompatible_id = "e" * 20
        write_release(incompatible, build_id=incompatible_id, api_sha256="f" * 64)
        stage(incompatible, directory, service)
        with pytest.raises(ValueError, match="契约不同"):
            activate(
                directory, service, incompatible_id, expected=next_id, api_sha256=baked.api_sha256
            )
        assert (
            await old_tab.get(f"/_apps/thought/{incompatible_id}/assets/main.js")
        ).status_code == 200
        blocked = await old_tab.post(
            "/v1/example",
            headers={
                **old_headers,
                "X-Application-Build": incompatible_id,
            },
        )
        assert blocked.status_code == 409 and blocked.headers["x-application-update"] == "required"
        activate(directory, service, baked.build_id, expected=next_id, api_sha256=baked.api_sha256)
        assert (await old_tab.get("/page")).headers["x-application-build"] == baked.build_id
        assert (await old_tab.get(f"/_apps/thought/{next_id}/assets/main.js")).status_code == 200
