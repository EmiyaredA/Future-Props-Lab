import asyncio
import json
import os
import shutil
from copy import deepcopy

from app.capabilities.agents.cli.process import execute, probe
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.console.governance.code_agents import authorized
from app.runtime.ids import new_id
from fpl_runtime.visual_agent_report import AgentReport

from ..access import AcceptanceError, asset
from ..catalog import cli_configuration, connection_signature
from ..media import flush_evidence
from ..models import AcceptanceAssetReference
from .task_execution import execute_review_task
from .task_tools import file_digest, safe_file


async def prepare(session, settings, run):
    storage = AssetStorage(settings)
    root = (
        storage.project_root("visual-workshop", run.project_id, owner_user_id=run.owner_user_id)
        / "acceptance-tasks"
        / run.id
    )
    root.mkdir(parents=True, mode=0o700, exist_ok=False)
    os.chmod(root, 0o700)
    try:
        manifest = {
            "task": {
                "criteria": run.snapshot["criteria"],
                "prompt": run.snapshot["prompt"],
                "coverage": run.snapshot["coverage"],
                "output": run.snapshot["output"],
            },
            "media": [],
            "evidence": [],
        }
        index = 0
        for group, items in (
            ("media", run.snapshot["inputs"]["assets"]),
            ("evidence", run.evidence),
        ):
            for item in items:
                row = await asset(session, run.owner_user_id, run.project_id, item["asset_id"])
                source = storage.path_for(row)
                name = f"input-{index}{source.suffix}"
                index += 1
                target = root / name
                await asyncio.to_thread(shutil.copyfile, source, target)
                os.chmod(target, 0o600)
                manifest[group].append(
                    {
                        "id": item.get("id", row.id),
                        "file": name,
                        "sha256": await asyncio.to_thread(file_digest, target),
                        "label": row.display_name,
                        "kind": row.media_kind,
                        "source_asset_id": item.get("source_asset_id", row.id),
                        "position_ms": item.get("position_ms"),
                    }
                )
        (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False))
        (root / "output-schema.json").write_text(json.dumps(AgentReport.model_json_schema()))
        return root
    except BaseException:
        await asyncio.to_thread(shutil.rmtree, root, True)
        raise


async def evaluate_agent(session, settings, run, cancelled, executor=execute):
    identity, owner_user_id, project_id = run.id, run.owner_user_id, run.project_id
    scheme_id = run.scheme_id
    snapshot, original_evidence = deepcopy(run.snapshot), deepcopy(run.evidence)
    kind, path, users = cli_configuration(settings, scheme_id)
    if connection_signature(scheme_id, settings) != snapshot.get("executor", {}).get(
        "connection_signature"
    ):
        raise AcceptanceError("固定 Agent 连接已变化，请手动重新发起验收")

    if not await authorized(
        session,
        owner_user_id,
        snapshot.get("executor", {}).get("user_id"),
        kind,
        "visual_acceptance",
    ):
        raise AcceptanceError("本机 Agent 执行授权已失效")
    available, message = await probe(kind, path)
    if not available:
        raise AcceptanceError(message)
    root = await prepare(session, settings, run)
    await session.rollback()
    written = []
    try:
        report, extras, _read_ids = await execute_review_task(
            kind, path, root, snapshot, original_evidence, cancelled, executor=executor
        )
        if await cancelled():
            raise AcceptanceError("验收已取消或授权已失效")
        storage = AssetStorage(settings)
        imported = []
        for item in extras:
            source = safe_file(root, item["file"])
            key = new_id() + ".png"
            target = storage.target_path(
                key,
                visual_project_id=project_id,
                galgame_project_id=None,
                owner_user_id=owner_user_id,
            )
            target.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(shutil.copyfile, source, target)
            written.append(target)
            asset_id = new_id()
            session.add(
                VisualAsset(
                    id=asset_id,
                    owner_user_id=owner_user_id,
                    project_id=project_id,
                    original_filename=f"agent-frame-{item['position_ms']}ms.png",
                    display_name="Agent 验收证据",
                    storage_key=key,
                    storage_version=TARGET_STORAGE_VERSION,
                    media_kind="image",
                    mime_type="image/png",
                    byte_size=target.stat().st_size,
                )
            )
            session.add(
                AcceptanceAssetReference(
                    owner_id=identity, project_id=project_id, asset_id=asset_id
                )
            )
            imported.append(
                {
                    "id": item["id"],
                    "asset_id": asset_id,
                    "source_asset_id": item["source_asset_id"],
                    "position_ms": item["position_ms"],
                }
            )
        await flush_evidence(session)
        return report, imported, written
    except BaseException:
        for file in written:
            file.unlink(missing_ok=True)
        raise
    finally:
        await asyncio.to_thread(shutil.rmtree, root, True)
