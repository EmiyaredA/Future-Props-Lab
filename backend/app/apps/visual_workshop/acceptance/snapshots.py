"""Portable review history; imported decisions never authorize new adoption."""

from copy import deepcopy

from sqlalchemy import select

from app.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRepairDraft,
    AcceptanceRun,
    AcceptanceStandard,
    AcceptanceStandardVersion,
)
from app.apps.visual_workshop.acceptance.schemas import AcceptanceDocument, AcceptanceSnapshot
from app.capabilities.asset_store import ProjectSnapshotError
from app.runtime.ids import new_id


async def export_acceptance(session, project_id):
    standard = await session.get(AcceptanceStandard, project_id)
    if standard is None:
        return None, set()
    versions = list(
        await session.scalars(
            select(AcceptanceStandardVersion).where(
                AcceptanceStandardVersion.project_id == project_id
            )
        )
    )
    runs = list(
        await session.scalars(select(AcceptanceRun).where(AcceptanceRun.project_id == project_id))
    )
    repairs = list(
        await session.scalars(
            select(AcceptanceRepairDraft).where(AcceptanceRepairDraft.project_id == project_id)
        )
    )
    refs = set(
        await session.scalars(
            select(AcceptanceAssetReference.asset_id).where(
                AcceptanceAssetReference.project_id == project_id
            )
        )
    )
    refs.update(
        value
        for item in standard.draft.get("criteria", [])
        for value in item["reference_asset_ids"]
    )
    return {
        "draft": standard.draft,
        "required": standard.required,
        "published_version": standard.published_version,
        "versions": [
            {"id": row.id, "version": row.version, "document": row.document} for row in versions
        ],
        "runs": [
            {
                "id": row.id,
                "node_id": row.node_id,
                "output_id": row.output_id,
                "standard_id": row.standard_id,
                "previous_run_id": row.previous_run_id,
                "snapshot": row.snapshot,
                "results": row.results,
                "evidence": row.evidence,
                "decisions": row.decisions,
                "status": row.status,
            }
            for row in runs
        ],
        "repairs": [{"run_id": row.run_id, "text": row.text} for row in repairs],
    }, refs


async def import_acceptance(
    session, value, project_id, workspace_id, node_ids, output_ids, asset_ids
):
    if value is None:
        return
    try:
        draft = AcceptanceDocument.model_validate(value["draft"]).model_dump(mode="json")
        version_ids = {item["id"]: new_id() for item in value["versions"]}
        run_ids = {item["id"]: new_id() for item in value["runs"]}
        if len(version_ids) != len(value["versions"]) or len(run_ids) != len(value["runs"]):
            raise ValueError("重复身份")

        def mapped(mapping, identity):
            if identity not in mapping:
                raise ValueError("验收引用不在快照中")
            return mapping[identity]

        def document(data):
            data["node_ids"] = [mapped(node_ids, identity) for identity in data["node_ids"]]
            for item in data["criteria"]:
                item["reference_asset_ids"] = [
                    mapped(asset_ids, identity) for identity in item["reference_asset_ids"]
                ]
            return data

        versions = []
        for item in value["versions"]:
            data = document(
                AcceptanceDocument.model_validate(item["document"]).model_dump(mode="json")
            )
            row = AcceptanceStandardVersion(
                id=version_ids[item["id"]],
                workspace_id=workspace_id,
                project_id=project_id,
                version=item["version"],
                document=data,
            )
            versions.append(row)
        numbers = [row.version for row in versions]
        if len(numbers) != len(set(numbers)) or any(number < 1 for number in numbers):
            raise ValueError("标准版本无效")
        if value["published_version"] and value["published_version"] not in numbers:
            raise ValueError("生效标准缺失")
        session.add(
            AcceptanceStandard(
                project_id=project_id,
                workspace_id=workspace_id,
                draft=document(draft),
                required=bool(value["required"]),
                published_version=value["published_version"],
            )
        )
        session.add_all(versions)
        await session.flush()
        for version in versions:
            for identity in {
                ref for item in version.document["criteria"] for ref in item["reference_asset_ids"]
            }:
                session.add(
                    AcceptanceAssetReference(
                        owner_id=version.id, project_id=project_id, asset_id=identity
                    )
                )
        for item in value["runs"]:
            snapshot = AcceptanceSnapshot.model_validate(item["snapshot"]).model_dump(mode="json")
            snapshot["criteria"] = document({"node_ids": [], "criteria": snapshot["criteria"]})[
                "criteria"
            ]
            snapshot["output"]["id"] = mapped(output_ids, item["output_id"])
            if snapshot["output"]["asset_id"]:
                snapshot["output"]["asset_id"] = mapped(asset_ids, snapshot["output"]["asset_id"])
            evidence = deepcopy(item["evidence"])
            evidence_ids = {entry["id"]: new_id() for entry in evidence}
            for entry in evidence:
                entry["id"] = evidence_ids[entry["id"]]
                entry["asset_id"] = mapped(asset_ids, entry["asset_id"])
                entry["source_asset_id"] = mapped(asset_ids, entry["source_asset_id"])
            from app.apps.visual_workshop.acceptance.schemas import (
                AcceptanceEvidence,
                AcceptanceResult,
            )

            evidence = [
                AcceptanceEvidence.model_validate(entry).model_dump(mode="json")
                for entry in evidence
            ]
            results = deepcopy(item["results"])
            for result in results:
                result["evidence_ids"] = [
                    mapped(evidence_ids, identity) for identity in result.get("evidence_ids", [])
                ]
            results = [
                AcceptanceResult.model_validate(result).model_dump(mode="json")
                for result in results
            ]
            row = AcceptanceRun(
                id=run_ids[item["id"]],
                workspace_id=workspace_id,
                project_id=project_id,
                node_id=mapped(node_ids, item["node_id"]),
                output_id=mapped(output_ids, item["output_id"]),
                standard_id=mapped(version_ids, item["standard_id"]),
                previous_run_id=mapped(run_ids, item["previous_run_id"])
                if item["previous_run_id"]
                else None,
                request_id=new_id(),
                fingerprint="snapshot",
                snapshot=snapshot,
                results=results,
                evidence=evidence,
                decisions=item["decisions"],
                status="completed" if item["status"] == "completed" else "failed",
                decision="historical",
            )
            session.add(row)
            refs = {entry["asset_id"] for entry in evidence} | {
                ref for entry in snapshot["criteria"] for ref in entry["reference_asset_ids"]
            }
            if snapshot["output"]["asset_id"]:
                refs.add(snapshot["output"]["asset_id"])
            for identity in refs:
                session.add(
                    AcceptanceAssetReference(
                        owner_id=row.id, project_id=project_id, asset_id=identity
                    )
                )
        await session.flush()
        for item in value["repairs"]:
            if not isinstance(item["text"], str) or not 0 < len(item["text"]) <= 6000:
                raise ValueError("返修草稿无效")
            session.add(
                AcceptanceRepairDraft(
                    workspace_id=workspace_id,
                    project_id=project_id,
                    run_id=mapped(run_ids, item["run_id"]),
                    text=item["text"],
                )
            )
    except (ValueError, KeyError, TypeError) as exc:
        raise ProjectSnapshotError("验收快照格式或引用无效") from exc
