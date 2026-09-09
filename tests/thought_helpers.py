"""Create explicit document projects through the public API for editor regressions."""

ROOT = "/v1/thought-workshop"


async def create_note(client, *, json, headers=None):
    project = (
        await client.post(ROOT + "/knowledge-bases", json={"title": "测试知识库"}, headers=headers)
    ).json()
    return await client.post(
        ROOT + "/notes",
        headers=headers,
        json={
            "knowledge_base_id": project["id"],
            "expected_knowledge_revision": project["revision"],
            **json,
        },
    )


async def all_notes(client):
    result = []
    for project in (await client.get(ROOT + "/knowledge-bases")).json():
        for view in ("all", "trash"):
            offset = 0
            while True:
                page = (
                    await client.get(
                        ROOT + "/notes",
                        params={
                            "knowledge_base_id": project["id"],
                            "view": view,
                            "limit": 100,
                            "offset": offset,
                        },
                    )
                ).json()
                result.extend(page["items"])
                offset += 100
                if offset >= page["total"]:
                    break
    return result


async def delete_note(client, path, *, params=None, headers=None):
    note_response = await client.get(path)
    revision = 0
    if note_response.status_code == 200:
        project = (
            await client.get(ROOT + "/knowledge-bases/" + note_response.json()["knowledge_base_id"])
        ).json()
        revision = project["revision"]
    return await client.delete(
        path, headers=headers, params={"expected_knowledge_revision": revision, **(params or {})}
    )
