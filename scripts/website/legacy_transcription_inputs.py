"""Resolve explicitly approved missing transcription inputs in a sealed website source."""

import sqlite3
from contextlib import closing
from types import SimpleNamespace

from studio.apps.asset_library.migration_blobs import FrozenAssetStorage, FrozenPaths
from studio.apps.model_service.storage.migration_originals import LegacyTranscriptionInputs
from studio.runtime.files.migration_files import checked_path, inspect_blob

from .legacy_snapshot import DATABASE


def resolve_legacy_transcription_inputs(runtime, owners, *, unavailable_ids, recovered_ids):
    if unavailable_ids & recovered_ids:
        raise ValueError("缺失音频与恢复音频不能重复登记")
    owners = {str(owner) for owner in owners}
    unavailable, recovered = set(), {}
    assets = FrozenAssetStorage(FrozenPaths(runtime))
    with closing(
        sqlite3.connect((runtime / DATABASE).as_uri() + "?mode=ro&immutable=1", uri=True)
    ) as db:
        db.row_factory = sqlite3.Row
        for task in db.execute("SELECT * FROM model_test_transcription_tasks"):
            identifier, owner = task["id"], task["owner_user_id"]
            path = checked_path(
                runtime, "accounts", owner, "model-test", "references", task["input_storage_key"]
            )
            if path.exists():
                continue
            if owner not in owners or task["status"] not in {"completed", "failed"}:
                raise ValueError("缺失音频的任务不属于已封存账号或尚未结束")
            if identifier in unavailable_ids and task["source_kind"] == "upload":
                unavailable.add(identifier)
                continue
            if identifier not in recovered_ids or task["source_kind"] != "library":
                raise ValueError("发现未核准的转录输入缺失")
            row = db.execute(
                "SELECT * FROM visual_assets WHERE id = ? AND owner_user_id = ?",
                (task["source_asset_id"], owner),
            ).fetchone()
            if (
                row is None
                or row["media_kind"] != "audio"
                or row["byte_size"] != task["input_byte_size"]
            ):
                raise ValueError("转录关联的素材原件与旧记录不符")
            original = assets.owned_path(SimpleNamespace(**dict(row)))
            inspect_blob(original, exact_size=task["input_byte_size"])
            recovered[identifier] = original
    if unavailable != unavailable_ids or recovered.keys() != recovered_ids:
        raise ValueError("封存来源与核准的转录输入缺失清单不符")
    return LegacyTranscriptionInputs(recovered=recovered, unavailable=frozenset(unavailable))
