"""A real sandboxed script uses the SDK against owned workshop APIs and approvals."""

import base64
from contextlib import aclosing

import pytest

from tests.apps.agent_runtime.test_code_agents import configured, wait_run  # noqa: F401
from tests.apps.visual_workshop.test_workspace_governance import client_account

pytestmark = pytest.mark.real_auth


@pytest.mark.parametrize("outcome", ["approve", "reject", "plan"])
async def test_workspace_script_reads_two_workshops_and_proposes_one_edit(configured, outcome):  # noqa: F811
    assert configured
    client, *_ = await client_account(admin=True)
    async with aclosing(client):
        visual = await client.post(
            "/v1/visual-workshop/projects", json={"title": "Visual", "kind": "canvas"}
        )
        video = await client.post("/v1/video-editor/projects", json={"title": "Video"})
        assert visual.status_code == video.status_code == 200
        visual_id, video_id = visual.json()["id"], video.json()["id"]
        source = (
            "from future_props_lab import task_client\n"
            "from pathlib import Path\n"
            "with task_client() as client:\n"
            f"    visual = client.visual.get_project(project_id={visual_id!r})\n"
            f"    video = client.video.get_project(project_id={video_id!r})\n"
            "    assert visual.title == 'Visual' and video.title == 'Video'\n"
            "    Path('analysis.txt').write_text(visual.title + video.title)\n"
            f"    client.visual.patch_project(project_id={visual_id!r}, body={{\n"
            "        'title': 'Reviewed', 'expected_revision': visual.revision})\n"
            "    raise AssertionError('script continued after proposal')\n"
        )
        command = "cat > analyze.py <<'PY'\n" + source + "PY\npython analyze.py"
        prompt = "WORKSPACE_COMMAND:" + base64.b64encode(command.encode()).decode()
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        await client.post(
            root + "/messages",
            json={
                "role": "user",
                "content": prompt,
                "expected_revision": 0,
            },
        )
        started = await client.post(
            root + "/runs",
            json={
                "agent_id": "codex",
                "mode": "plan" if outcome == "plan" else "agent",
            },
        )
        assert started.status_code == 200, started.text
        result = await wait_run(client, root, started.json()["run"]["id"])
        detail = (await client.get(root)).json()
        assert (await client.get(f"/v1/visual-workshop/projects/{visual_id}")).json()[
            "title"
        ] == "Visual"
        operations = [
            e["payload"].get("arguments", {}).get("operation")
            for e in result["events"]
            if e["kind"] == "tool_call"
        ]
        assert {"visual.get_project", "video.get_project"} <= set(operations), result
        if outcome == "plan":
            assert detail["actions"] == []
            assert result["run"]["status"] == "completed", result
            return
        assert result["run"]["status"] == "waiting_approval", result
        assert len(detail["actions"]) == 1
        action = detail["actions"][0]
        assert action["tool_name"] == "fpl_operation:visual.patch_project"
        path = root + f"/actions/{action['id']}"
        assert (await client.post(path + "/execute")).status_code == 409
        decided = await client.post(
            path + "/decision",
            json={
                "approve": outcome == "approve",
                "arguments_sha256": action["arguments_sha256"],
            },
        )
        assert decided.status_code == 200
        if outcome == "approve":
            executed = await client.post(path + "/execute")
            assert executed.json()["status"] == "completed", executed.text
            assert (await client.post(path + "/execute")).status_code == 409
        final = (await client.get(f"/v1/visual-workshop/projects/{visual_id}")).json()
        assert final["title"] == ("Reviewed" if outcome == "approve" else "Visual")
