"""Retain Creative's original creator, published versions and installation history."""

import re
from dataclasses import replace
from datetime import datetime
from functools import partial
from typing import Literal

from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import DeclarativeBase

from app.console.creative_workshop.models import CreativeInstallation, CreativeItem, CreativeRelease
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.migration_receipts import ImportReceiptFields
from studio.runtime.database.project_history_migration import ProjectDataset, blocked

OWNER = "origin_owner_user_id"
COVER = r"creative-workshop/covers/[a-f0-9]{32}\.webp"


class ReceiptBase(DeclarativeBase):
    pass


class CreativeImportReceipt(ImportReceiptFields, ReceiptBase):
    __tablename__ = "creative_import_receipts"


class Described(HistoryRecord):
    id: Identifier
    title: str
    summary: str
    description: str
    tags: list[str]
    cover_preset: str
    created_at: datetime


class Item(Described):
    author_user_id: Identifier
    kind: str
    status: str
    draft_manifest: dict
    draft_components: list[str]
    draft_cover_path: str
    draft_skill_path: str
    current_release_id: Identifier | None
    revision: int = Field(ge=0)
    updated_at: datetime


class Release(Described):
    item_id: Identifier
    version: int = Field(gt=0)
    cover_path: str
    manifest: dict
    components: list[str]
    skill_path: str


class Installation(HistoryRecord):
    id: Identifier
    release_id: Identifier
    installed_by_user_id: Identifier
    resources: list[dict]
    created_at: datetime


class Items(MigrationBatch[Item]):
    dataset: Literal["creative.items"]


class Releases(MigrationBatch[Release]):
    dataset: Literal["creative.releases"]


class Installations(MigrationBatch[Installation]):
    dataset: Literal["creative.installations"]


DATASETS = (
    ProjectDataset(
        "creative.items",
        CreativeItem,
        Item,
        Items,
        MigrationPage[Items],
        owner_key=OWNER,
        page_size=16,
    ),
    ProjectDataset(
        "creative.releases",
        CreativeRelease,
        Release,
        Releases,
        MigrationPage[Releases],
        project=CreativeItem,
        parent_key="item_id",
        owner_key=OWNER,
        owns_record=False,
        page_size=16,
    ),
    ProjectDataset(
        "creative.installations",
        CreativeInstallation,
        Installation,
        Installations,
        MigrationPage[Installations],
        page_size=16,
    ),
)


async def validate(approved, db, row):
    if isinstance(row, Installation):
        if row.installed_by_user_id not in approved:
            raise blocked("migration_creative_actor_unassigned")
        if await db.get(CreativeRelease, row.release_id) is None:
            raise blocked("migration_creative_release_missing")
        return

    if isinstance(row, Item):
        if row.author_user_id not in approved:
            raise blocked("migration_creative_actor_unassigned")
        cover = row.draft_cover_path
        invalid_skill = row.draft_skill_path and not re.fullmatch(
            rf"creative-workshop/skill-drafts/{re.escape(row.id)}/[a-f0-9]{{32}}",
            row.draft_skill_path,
        )
    else:
        cover = row.cover_path
        invalid_skill = (
            row.skill_path and row.skill_path != f"creative-workshop/skill-releases/{row.id}"
        )
    if invalid_skill or (cover and not re.fullmatch(COVER, cover)):
        raise blocked("migration_creative_file_path_invalid")


def datasets(plan):
    owners = frozenset(str(owner) for owner in plan.owner_ids)
    return tuple(replace(entry, validate=partial(validate, owners)) for entry in DATASETS)


async def verify_release_relationships(sessions):
    async with sessions(info={"allow_system_reads": True}) as db:
        items = await db.stream_scalars(select(CreativeItem).order_by(CreativeItem.id))
        count = 0
        async for item in items:
            release_id = item.current_release_id
            if release_id is None:
                if item.status == "published":
                    raise blocked("migration_creative_release_missing")
                continue
            release = await db.get(CreativeRelease, release_id)
            if release is None or release.item_id != item.id:
                raise blocked("migration_creative_release_missing")
            count += 1
    return {"record_count": count}
