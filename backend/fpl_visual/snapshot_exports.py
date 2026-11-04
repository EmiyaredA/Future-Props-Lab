"""Export the compatible Visual ZIP using owner-verified project assets."""

import shutil
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
from pydantic import TypeAdapter
from sqlalchemy import select, text

from app.apps.visual_workshop.acceptance.snapshots import export_acceptance
from app.apps.visual_workshop.models import VisualGenerationTask
from app.apps.visual_workshop.outputs.snapshots import export_outputs
from app.apps.visual_workshop.project_values import project_out
from app.apps.visual_workshop.schemas.workshop import default_material_categories
from app.apps.visual_workshop.snapshot_values import canvas_asset_ids
from app.capabilities.asset_store.project_snapshots import (
    ProjectSnapshotError,
    SnapshotAssetSource,
    export_project_snapshot,
)
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.framed_media import SIZE, FramedInputs
from fpl_runtime.motion_preview import FrameFile
from fpl_runtime.motion_snapshot import SnapshotScope
from fpl_runtime.visual_snapshot import (
    ASSET_PURPOSE,
    ASSETS,
    MODEL_PURPOSE,
    ModelIdentity,
    SnapshotAssetQuery,
    SnapshotFiles,
    SnapshotModels,
)

from .projects import Projects

MODEL_IDENTITIES = TypeAdapter(dict[str, ModelIdentity])


@dataclass(frozen=True)
class SnapshotSettings:
    runtime_path: Path
    fpl_project_snapshot_max_bytes: int = 8 * 1024**3
    fpl_project_snapshot_max_files: int = 10_000

    def staging(self, total_bytes):
        root = self.runtime_path / ".tmp" / "project-snapshots"
        if root.is_symlink() or not root.resolve().is_relative_to(self.runtime_path):
            raise ProjectSnapshotError("项目快照暂存目录不可用", status=503)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if shutil.disk_usage(root).free < 2 * total_bytes:
            raise ProjectSnapshotError(
                "磁盘空间不足，无法生成项目快照", code="snapshot_disk_full", status=507
            )
        return root


class SnapshotExports:
    def __init__(self, request, session, owner):
        self.request, self.session, self.owner = request, session, owner
        self.projects = Projects(session, owner)
        self.peer = request.app.state.capabilities
        self.assertion = request.state.service_assertion
        self.source = request.url.path

    async def token(self, purpose, service, target):
        grant = RequestGrant("visual", purpose, "GET", self.source, service, "POST", target)
        return await self.peer.authorize_request(self.assertion, grant)

    async def query(self, purpose, service, target, body):
        try:
            token = await self.token(purpose, service, target)
            response = await self.peer.client.post(
                f"http://{service}:8080" + target, headers={HEADER: token}, json=body.model_dump()
            )
            self.check(response)
            return response.content
        except CapabilityDenied as exc:
            raise ProjectSnapshotError("项目快照授权已结束", status=exc.status) from exc
        except (httpx.HTTPError, CapabilityUnavailable, ValueError) as exc:
            raise ProjectSnapshotError("项目快照资料暂不可读", status=503) from exc

    @staticmethod
    def check(response):
        if response.status_code in {401, 403}:
            raise CapabilityDenied(response.status_code)
        if response.status_code in {404, 409, 413}:
            problem = response.json()
            raise ProjectSnapshotError(
                problem.get("title") or "项目素材不可用",
                code=problem.get("code") or "snapshot_source_changed",
                status=response.status_code,
            )
        response.raise_for_status()

    async def snapshot(self, project_id):
        await self.session.execute(text("BEGIN"))
        project = await self.projects.row(project_id)
        canvas = await self.projects.canvas_row(project_id)
        nodes = deepcopy(canvas.nodes or [])
        node_ids = {node["id"] for node in nodes}
        outputs = [
            row
            for row in await export_outputs(self.session, project_id)
            if row["node_id"] in node_ids
        ]
        acceptance, used = await export_acceptance(self.session, project_id)
        used.update(canvas_asset_ids(nodes))
        used.update(
            asset_id
            for output in outputs
            for asset_id in (
                output.get("asset_id"),
                output.get("inspection_asset_id"),
                *(item.get("asset_id") for item in output["input_snapshot"]),
            )
            if asset_id
        )
        generated = set(
            await self.session.scalars(
                select(VisualGenerationTask.result_asset_id).where(
                    VisualGenerationTask.project_id == project_id,
                    VisualGenerationTask.owner_user_id == self.owner,
                    VisualGenerationTask.result_asset_id.is_not(None),
                )
            )
        )
        project_values = {"title": project.title, "kind": project.kind, "status": project.status}
        payload = {
            "schema_version": 1,
            "project": project_values,
            "canvas": {
                "nodes": nodes,
                "edges": deepcopy(canvas.edges or []),
                "categories": canvas.categories
                or [item.model_dump(mode="json") for item in default_material_categories()],
            },
            "outputs": outputs,
            "acceptance": acceptance,
        }
        source = project_out(project).model_dump(mode="json")
        await self.session.rollback()
        return source, payload, used, generated - used

    async def export(self, project_id):
        provenance, payload, used, excluded = await self.snapshot(project_id)
        try:
            query = SnapshotAssetQuery(asset_ids=sorted(used), excluded_generated=sorted(excluded))
            files = SnapshotFiles.model_validate_json(
                await self.query(ASSET_PURPOSE, "assets", query.path(project_id), query)
            )
            identities = [row.id for row in files.assets]
            if identities != sorted(set(identities)) or not used.issubset(identities):
                raise ValueError("snapshot file projection is incomplete")
            models = SnapshotModels(
                model_ids=sorted(
                    {
                        model_id
                        for node in payload["canvas"]["nodes"]
                        if (model_id := (node.get("generation_draft") or {}).get("model_id"))
                    }
                )
            )
            refs = (
                MODEL_IDENTITIES.validate_json(
                    await self.query(MODEL_PURPOSE, "models", models.path, models)
                )
                if models.model_ids
                else {}
            )
            if not set(refs).issubset(models.model_ids):
                raise ValueError("snapshot Models projection is outside the request")
        except ValueError as exc:
            raise ProjectSnapshotError(
                "项目快照资料不一致", code="snapshot_scope_invalid", status=409
            ) from exc
        payload.update(
            folders=[row.model_dump() for row in files.folders],
            assets=[row.model_dump(exclude={"revision"}) for row in files.assets],
            model_references={key: model.model_dump() for key, model in refs.items()},
        )
        settings = SnapshotSettings(
            self.request.app.state.database.root, files.max_bytes, files.max_files
        )
        root = settings.staging(sum(row.byte_size for row in files.assets))
        with TemporaryDirectory(dir=root, prefix="visual-export-") as directory:
            originals = (
                await self.originals(project_id, files.assets, Path(directory))
                if files.assets
                else []
            )
            result = await export_project_snapshot(
                settings,
                application_id="visual-workshop",
                title=payload["project"]["title"],
                source_project=provenance,
                project=payload,
                assets=originals,
            )
        try:
            active = await self.request.app.state.snapshot_authorization.status(
                assertion=self.assertion, method="GET", path=self.source
            )
            if active is not True:
                raise ProjectSnapshotError(
                    "项目快照授权已结束", status=401 if active is False else 503
                )
            return result
        except BaseException:
            result.path.unlink(missing_ok=True)
            raise

    async def originals(self, project, assets, directory):
        scope = SnapshotScope(
            files=tuple(FrameFile(id=row.id, revision=row.revision) for row in assets)
        )
        target = f"{ASSETS}/{project}/originals/{scope.digest}"
        try:
            token = await self.token(ASSET_PURPOSE, "assets", target)
            async with self.peer.client.stream(
                "POST",
                "http://assets:8080" + target,
                json=scope.model_dump(mode="json"),
                headers={HEADER: token, "Accept-Encoding": "identity"},
                timeout=httpx.Timeout(300, connect=5),
            ) as response:
                if response.status_code != 200:
                    await response.aread()
                    self.check(response)
                expected = sum(SIZE.size + row.byte_size for row in assets)
                if (
                    response.headers.get("Content-Encoding", "identity") != "identity"
                    or response.headers.get("Content-Type") != "application/octet-stream"
                    or int(response.headers["Content-Length"]) != expected
                ):
                    raise ValueError("unexpected snapshot original response")
                framed = FramedInputs(response.aiter_bytes(chunk_size=1024 * 1024))
                output = []
                for index, row in enumerate(assets):
                    length = SIZE.unpack(await framed.read(SIZE.size))[0]
                    if length != row.byte_size:
                        raise ValueError("snapshot original size mismatch")
                    path = directory / str(index)
                    with path.open("xb") as destination:
                        await framed.transfer(destination, length)
                    output.append(SnapshotAssetSource(row.id, path))
                await framed.require_end(expected)
                return output
        except CapabilityDenied as exc:
            raise ProjectSnapshotError("项目快照素材授权已结束", status=exc.status) from exc
        except (httpx.HTTPError, CapabilityUnavailable, OSError, KeyError, ValueError) as exc:
            raise ProjectSnapshotError("项目快照原件暂不可用", status=503) from exc
