# ruff: noqa: F403, F405, I001

from __future__ import annotations

from scripts.demo.galgame_runaway.performance_upgrade import *  # noqa: F403


def request_json(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    files: list[tuple[str, tuple[str, Any, str]]] | None = None,
    data: dict[str, str] | None = None,
) -> dict[str, Any]:
    response = client.request(method, path, json=payload, files=files, data=data)
    if response.is_error:
        raise ApiError(
            f"API {method} {path} 返回 {response.status_code}: {response.text[:2000]}",
            response.status_code,
        )
    return response.json()


def project_path(project_id: str, suffix: str) -> str:
    return f"/v1/galgame-workshop/projects/{project_id}{suffix}"


def apply_story(
    client: httpx.Client,
    project_id: str,
    mapping: dict[str, Any],
    source_root: Path,
    original_source_root: Path,
    annotation_path: Path,
) -> dict[str, Any]:
    for attempt in range(1, 4):
        latest = request_json(client, "GET", project_path(project_id, "/story"))
        backup_path = BACKUP_ROOT / f"{timestamp()}-performance-before.json"
        write_json(backup_path, latest)
        document, audit = transform_latest_story(
            latest,
            mapping,
            source_root,
            original_source_root,
            annotation_path,
        )
        try:
            saved = request_json(
                client,
                "PUT",
                project_path(project_id, "/story"),
                payload={"expected_revision": latest["revision"], "document": document},
            )
        except ApiError as exc:
            if exc.status_code == 409 and attempt < 3:
                print("故事 revision 已变化，重新读取并重算演出", flush=True)
                continue
            raise
        audit_path = BACKUP_ROOT / f"{timestamp()}-performance-apply-audit.json"
        write_json(
            audit_path,
            {
                **audit,
                "beforeSnapshot": str(backup_path),
                "savedRevision": saved["revision"],
            },
        )
        print(
            json.dumps(
                {
                    "savedRevision": saved["revision"],
                    "audit": str(audit_path),
                },
                ensure_ascii=False,
            )
        )
        return saved
    raise RuntimeError("连续三次 revision 冲突，未覆盖任何故事数据")


def inspect(client: httpx.Client, project_id: str) -> dict[str, Any]:
    story = request_json(client, "GET", project_path(project_id, "/story"))
    fragment = target_fragment(story["document"])
    summary = {
        "revision": story["revision"],
        "durationMs": fragment.get("timeline", {}).get("durationMs"),
        "dialogueCount": len(dialogue_signature(fragment)),
        "characters": [
            {
                "id": character["id"],
                "name": character["name"],
                "expressions": len(character.get("expressions", [])),
            }
            for character in story["document"].get("characters", [])
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


def rename_live_expression_labels(
    client: httpx.Client,
    project_id: str,
    *,
    character_ids: set[str] | None = None,
    backup_name: str = "expression-labels",
) -> dict[str, Any]:
    checked_ids = character_ids or set(AUDITED_EXPRESSION_LABELS)
    checked_expressions = sum(
        len(AUDITED_EXPRESSION_LABELS[character_id]) for character_id in checked_ids
    )
    for attempt in range(1, 4):
        latest = request_json(client, "GET", project_path(project_id, "/story"))
        document = deepcopy(latest["document"])
        changes = rename_audited_expression_labels(document, character_ids)
        if not changes:
            result = {
                "revision": latest["revision"],
                "checkedCharacters": len(checked_ids),
                "checkedExpressions": checked_expressions,
                "changed": 0,
                "changes": [],
            }
            print(json.dumps(result, ensure_ascii=False))
            return result
        backup_path = BACKUP_ROOT / f"{timestamp()}-{backup_name}-before.json"
        write_json(backup_path, latest)
        try:
            saved = request_json(
                client,
                "PUT",
                project_path(project_id, "/story"),
                payload={"expected_revision": latest["revision"], "document": document},
            )
        except ApiError as exc:
            if exc.status_code == 409 and attempt < 3:
                continue
            raise
        result = {
            "revision": saved["revision"],
            "checkedCharacters": len(checked_ids),
            "checkedExpressions": checked_expressions,
            "changed": len(changes),
            "changes": changes,
            "beforeSnapshot": str(backup_path),
        }
        print(json.dumps(result, ensure_ascii=False))
        return result
    raise RuntimeError("连续三次 revision 冲突，未覆盖任何故事数据")


def rename_live_kurisu_expressions(client: httpx.Client, project_id: str) -> dict[str, Any]:
    return rename_live_expression_labels(
        client,
        project_id,
        character_ids={"kurisu-makise"},
        backup_name="kurisu-labels",
    )


def audit_live(
    client: httpx.Client,
    project_id: str,
    mapping: dict[str, Any],
    source_root: Path,
    original_source_root: Path,
    annotation_path: Path,
) -> dict[str, Any]:
    story = request_json(client, "GET", project_path(project_id, "/story"))
    listed = request_json(client, "GET", project_path(project_id, "/assets"))["items"]
    existing_ids = {asset["id"] for asset in listed}
    missing_assets = [
        relative
        for relative, item in mapping.get("items", {}).items()
        if item["assetId"] not in existing_ids
    ]
    document = deepcopy(story["document"])
    annotation_audit = apply_annotation(document, annotation_path)
    if dialogue_signature(target_fragment(document)) != dialogue_signature(
        target_fragment(story["document"])
    ):
        raise RuntimeError("线上故事尚未与新版对白标注完全一致")
    checks = audit_document(
        story["document"],
        mapping,
        source_root,
        original_source_root,
        annotation_audit,
    )
    checks["missingProjectAssets"] = missing_assets
    if missing_assets:
        raise RuntimeError("映射中的项目素材记录不存在")
    audit_path = BACKUP_ROOT / f"{timestamp()}-performance-final-audit.json"
    write_json(audit_path, {"revision": story["revision"], "checks": checks})
    print(json.dumps({"audit": str(audit_path), **checks}, ensure_ascii=False))
    return checks
