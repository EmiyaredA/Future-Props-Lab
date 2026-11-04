"""Exercise a real owned Annotation source and WAV through Galgame preflight."""

import hashlib
import time
from uuid import uuid4

import httpx
import pytest
from tests.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    scenario,
)
from tests.test_creative_project_certification import CREDENTIALS
from tests.test_galgame_annotation_import import _audio_bytes, _import_body
from tests.test_galgame_uploads_service import DropAcknowledgement
from tests.test_independent_project_catalog import ORIGIN, authorize

from fpl_annotation.application import create_app as create_annotation
from fpl_annotation.migrations.registry import MIGRATIONS as ANNOTATION_MIGRATIONS
from fpl_galgame.annotation_original import fetch_original
from fpl_galgame.application import create_app as create_galgame
from fpl_galgame.migrations.registry import MIGRATIONS as GALGAME_MIGRATIONS
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied
from fpl_runtime.claims import issue_context, verify_context
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.project_errors import ProjectResourceError

PROJECTS = "/v1/galgame-workshop/projects"
ANNOTATION = "/v1/audio-annotation"


async def test_annotation_import_recovers_exact_clips_after_lost_upload_acknowledgement(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    annotation_credential = "isolated-annotation-source-credential-" * 2
    case.identity.state.identity_options["service_credentials"].update(
        annotation=annotation_credential, galgame=CREDENTIALS["galgame"]
    )
    transport = DropAcknowledgement(case.mesh)
    apps = {}
    for service, migrations, factory, credential in (
        ("annotation", ANNOTATION_MIGRATIONS, create_annotation, annotation_credential),
        ("galgame", GALGAME_MIGRATIONS, create_galgame, CREDENTIALS["galgame"]),
    ):
        root = tmp_path / service
        apply(root / "service.db", service, migrations)
        apps[service] = factory(
            state_root=root,
            public_key=case.key.public_key(),
            catalog=CATALOG,
            credential=credential,
            transport=transport,
            run_worker=False,
        )
    case.mesh.apps.update(apps)
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live
    async with (
        live.client,
        apps["annotation"].router.lifespan_context(apps["annotation"]),
        apps["galgame"].router.lifespan_context(apps["galgame"]),
        httpx.AsyncClient(transport=case.mesh) as client,
    ):

        async def request(service, method, path, **kwargs):
            return await client.request(
                method,
                f"http://{service}" + path,
                headers=await authorize(case, service, method, path),
                **kwargs,
            )

        sound = _audio_bytes()
        source = await request(
            "assets",
            "POST",
            "/v1/files",
            files={"upload": ("annotation-source.wav", sound, "audio/wav")},
        )
        assert source.status_code == 200, source.text
        annotation = await request(
            "annotation",
            "POST",
            ANNOTATION + "/imports",
            json={
                "title": "Owned radio play",
                "asset_id": source.json()["id"],
                "schema_version": "1.0",
                "speakers": [{"id": "speaker", "name": "Speaker", "color": "#28B8A7"}],
                "segments": [
                    {
                        "id": f"segment-{index}",
                        "speaker_id": "speaker",
                        "start_ms": (index - 1) * 500,
                        "end_ms": index * 500,
                        "text": text,
                        "language": "zh",
                        "status": "reviewed",
                    }
                    for index, text in enumerate(("第一句", "第二句"), 1)
                ],
            },
        )
        assert annotation.status_code == 200, annotation.text
        project = await request("galgame", "POST", PROJECTS, json={"title": "Owned Galgame"})
        assert project.status_code == 200, project.text
        path = f"{PROJECTS}/{project.json()['id']}"
        master = await request(
            "galgame",
            "POST",
            path + "/assets",
            files={"upload": ("master.wav", sound, "audio/wav")},
            data={"category": "voice"},
        )
        assert master.status_code == 200, master.text
        story = (await request("galgame", "GET", path + "/story")).json()
        body = _import_body(story, annotation.json(), master.json(), sound)
        preview_path = path + "/annotation-imports/preview"
        preview = await request("galgame", "POST", preview_path, json=body)
        assert preview.status_code == 200 and preview.json()["ready"], preview.text
        assert preview.json()["sourceAssetId"] == source.json()["id"]
        assert preview.json()["masterAssetId"] == master.json()["id"]
        assert [item["text"] for item in preview.json()["segments"]] == ["第一句", "第二句"]
        changed = await request(
            "galgame",
            "POST",
            preview_path,
            json={**body, "expectedSourceRevision": body["expectedSourceRevision"] + 1},
        )
        assert changed.status_code == 200 and not changed.json()["ready"], changed.text
        assert {issue["code"] for issue in changed.json()["issues"]} == {"source_revision_conflict"}
        denied = await request(
            "galgame", "POST", preview_path, json={**body, "sourceProjectId": "missing"}
        )
        assert denied.status_code == 404

        output = tmp_path / "exact-original.wav"
        download_path = path + "/annotation-imports"
        assertion = (await authorize(case, "galgame", "POST", download_path))["x-fpl-context"]
        args = (
            apps["galgame"].state.capabilities,
            assertion,
            download_path,
            project.json()["id"],
            body["sourceProjectId"],
            source.json()["id"],
        )
        await fetch_original(*args, hashlib.sha256(sound).hexdigest(), output)
        assert output.read_bytes() == sound
        rejected = tmp_path / "rejected.wav"
        with pytest.raises(ProjectResourceError, match="摘要已变化"):
            await fetch_original(*args, "a" * 64, rejected)
        assert not rejected.exists()

        created = await request("galgame", "POST", download_path, json=body)
        assert created.status_code == 202, created.text
        identity = created.json()["id"]
        task_path = f"{download_path}/{identity}"
        repeated = await request("galgame", "POST", download_path, json=body)
        assert repeated.status_code == 202 and repeated.json()["id"] == identity
        altered = await request(
            "galgame", "POST", download_path, json={**body, "assetPrefix": "different"}
        )
        assert altered.status_code == 409 and altered.json()["code"] == "idempotency_conflict"

        runner = apps["galgame"].state.annotation_imports
        await runner.recover()
        transport.drop_next = True
        with pytest.raises(ProjectResourceError, match="回执未确认"):
            await runner.process_once()
        assert transport.dropped
        pending = await request("galgame", "GET", task_path)
        assert pending.json()["status"] == "running"
        unchanged = await request("galgame", "GET", path + "/story")
        assert unchanged.json()["revision"] == story["revision"]
        await runner.recover()
        await apps["galgame"].state.upload_intakes.process_once()
        await runner.process_once()

        completed = await request("galgame", "GET", task_path)
        assert completed.json()["status"] == "completed", completed.text
        result = completed.json()["result"]
        assert result["voiceAssetCount"] == 2 and result["dialogueCount"] == 2
        assert result["storyRevision"] == story["revision"] + 1 and result["ready"]
        history = await request("galgame", "GET", path + "/story/snapshots")
        assert [item["id"] for item in history.json()] == [result["snapshotId"]]
        manifest = await request("galgame", "GET", path + "/assets")
        assert manifest.status_code == 200, manifest.text
        assert {item["id"] for item in manifest.json()["items"]} == {
            master.json()["id"],
            *(item["assetId"] for item in result["segments"]),
        }
        final_replay = await request("galgame", "POST", download_path, json=body)
        assert final_replay.status_code == 202 and final_replay.json() == completed.json()

        actor = verify_context(
            assertion,
            service="galgame",
            method="POST",
            path=download_path,
            public_key=case.key.public_key(),
        )
        expired = issue_context(
            actor,
            service="galgame",
            method="POST",
            path=download_path,
            private_key=case.key,
            key_id="isolated",
            now=int(time.time()) - 120,
        )
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="story",
            resource_id=project.json()["id"],
            expected_resource_revision=result["storyRevision"],
            asset_ids=[master.json()["id"]],
            metadata_asset_ids=[master.json()["id"]],
        )
        assert await apps["galgame"].state.retention_client.authorize(
            assertion=expired, source_method="POST", source_path=download_path, change=change
        )

        revoked = await request(
            "galgame",
            "POST",
            download_path,
            json={
                **body,
                "requestId": "revoke-during-import",
                "expectedStoryRevision": result["storyRevision"],
            },
        )
        assert revoked.status_code == 202, revoked.text
        status_path = f"{download_path}/{revoked.json()['id']}"
        # Preserve an exact read token only to inspect the isolated owner's terminal job state.
        owner_read = await authorize(case, "galgame", "GET", status_path)
        logout = await case.browser.post(
            "/v1/auth/logout", headers={"Origin": ORIGIN, "X-CSRF-Token": case.csrf}
        )
        assert logout.status_code == 204, logout.text
        with pytest.raises(CapabilityDenied) as denial:
            await apps["galgame"].state.retention_client.authorize(
                assertion=expired, source_method="POST", source_path=download_path, change=change
            )
        assert denial.value.status == 401
        await runner.process_once()
        rejected_task = await client.get("http://galgame" + status_path, headers=owner_read)
        assert rejected_task.json()["status"] == "failed", rejected_task.text
        assert rejected_task.json()["result"] == {"phase": "failed"}
