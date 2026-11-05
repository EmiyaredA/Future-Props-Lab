"""Project validated legacy installation mirrors from the migrated Creative catalogue."""

from uuid import uuid5

from sqlalchemy import select

from app.console.creative_workshop.models import CreativeInstallation, CreativeItem, CreativeRelease
from studio.apps.creative_workshop.install_batch import ReleaseSnapshot, install_part
from studio.contracts.creative_workshop.creative_integrations import part_fingerprint
from studio.contracts.creative_workshop.installation_migration import (
    DATASET,
    PAGE_SIZE,
    InstalledPart,
    InstalledParts,
    InstalledPartsPage,
    InstalledResource,
)
from studio.runtime.database.project_history_migration import blocked

COMPONENTS = {"tool_api", "mcp", "skill"}


class InstalledPartsExport:
    def __init__(self, sessions, plan, packer):
        self.sessions, self.plan, self.packer = sessions, plan, packer

    async def inventory(self):
        count = 0
        owners = {str(owner) for owner in self.plan.owner_ids}
        async with self.sessions(info={"allow_system_reads": True}) as db:
            rows = await db.stream_scalars(select(CreativeInstallation))
            async for installation in rows:
                owner = installation.owner_user_id
                if owner not in owners or owner != installation.installed_by_user_id:
                    raise blocked("migration_creative_install_owner_conflict")
                release = await db.get(CreativeRelease, installation.release_id)
                item = await db.get(CreativeItem, release.item_id) if release else None
                if item is None:
                    raise blocked("migration_creative_release_missing")
                if item.kind in COMPONENTS:
                    self.resource(installation, release, item)
                    count += 1
                elif item.kind == "bundle":
                    await self.verify_bundle(db, installation, release)
                else:
                    raise blocked("migration_creative_install_kind_invalid")
        return {"record_count": count}

    @staticmethod
    def resource(installation, release, item):
        try:
            (entry,) = installation.resources
            resource = InstalledResource.model_validate(entry)
        except (TypeError, ValueError):
            raise blocked("migration_creative_install_resource_invalid") from None
        if (
            resource.release_id != release.id
            or resource.kind != item.kind
            or (resource.state == "pending_setup" and release.manifest.get("transport") != "stdio")
        ):
            raise blocked("migration_creative_install_resource_invalid")
        return resource

    async def verify_bundle(self, db, installation, release):
        try:
            resources = [
                InstalledResource.model_validate(entry) for entry in installation.resources
            ]
        except (TypeError, ValueError):
            raise blocked("migration_creative_install_resource_invalid") from None
        if [resource.release_id for resource in resources] != release.components:
            raise blocked("migration_creative_install_bundle_conflict")
        for resource in resources:
            component = await db.scalar(
                select(CreativeInstallation).where(
                    CreativeInstallation.owner_user_id == installation.owner_user_id,
                    CreativeInstallation.release_id == resource.release_id,
                )
            )
            if component is None or component.resources != [resource.model_dump()]:
                raise blocked("migration_creative_install_bundle_conflict")

    async def page(self, owner, after):
        owner_id = str(owner)
        query = (
            select(CreativeInstallation, CreativeRelease, CreativeItem)
            .join(CreativeRelease, CreativeInstallation.release_id == CreativeRelease.id)
            .join(CreativeItem, CreativeRelease.item_id == CreativeItem.id)
            .where(
                CreativeInstallation.owner_user_id == owner_id,
                CreativeInstallation.id > (after or ""),
                CreativeItem.kind.in_(COMPONENTS),
            )
            .order_by(CreativeInstallation.id)
            .limit(PAGE_SIZE + 1)
        )
        async with self.sessions(info={"owner_user_id": owner_id}) as db:
            rows = (await db.execute(query)).all()
        records = []
        for installation, release, item in rows[:PAGE_SIZE]:
            if installation.installed_by_user_id != owner_id:
                raise blocked("migration_creative_install_owner_conflict")
            resource = self.resource(installation, release, item)
            snapshot = ReleaseSnapshot(
                release.id,
                item.kind,
                release.title,
                release.summary,
                release.tags,
                release.manifest,
                item.origin_owner_user_id,
                release.skill_path,
            )
            try:
                part = await install_part(self.packer, snapshot, resource.name)
                records.append(
                    InstalledPart(
                        id=installation.id,
                        release_id=release.id,
                        fingerprint=part_fingerprint(part),
                        description=release.summary,
                        result=resource,
                        created_at=installation.created_at,
                    )
                )
            except (OSError, ValueError):
                raise blocked("migration_creative_install_release_invalid") from None
        batch = InstalledParts(
            run_id=self.plan.run_id,
            source_revision=self.plan.source_revision,
            source_database_sha256=self.plan.source_database_sha256,
            dataset=DATASET,
            owner_id=owner,
            batch_id=uuid5(self.plan.run_id, f"{DATASET}/{owner}/{after or ''}"),
            records=tuple(records),
        )
        return InstalledPartsPage(
            batch=batch,
            sha256=batch.digest,
            next_cursor=records[-1].id if len(rows) > PAGE_SIZE else None,
        )
