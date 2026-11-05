"""Mount Creative's private, owner-scoped catalogue transfer."""

from studio.apps.creative_workshop.skill_archive import SkillArchivePacker
from studio.apps.creative_workshop.storage.file_paths import (
    SKILL_ARCHIVE_MAX_BYTES,
    SKILL_EXPANDED_MAX_BYTES,
    SKILL_MAX_FILES,
)
from studio.apps.creative_workshop.storage.migration_catalog import (
    CreativeImportReceipt,
    datasets,
    verify_release_relationships,
)
from studio.apps.creative_workshop.storage.migration_installed_parts import InstalledPartsExport
from studio.apps.creative_workshop.storage.migration_originals import PREFIX as ORIGINALS
from studio.apps.creative_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.creative_workshop.transport.migration_originals_http import mount_originals
from studio.contracts.creative_workshop.installation_migration import (
    PREFIX as INSTALLED_PARTS,
)
from studio.contracts.creative_workshop.installation_migration import (
    InstalledParts,
    InstalledPartsPage,
)
from studio.runtime.database.migration_apps import export_app, import_app, mount_dataset
from studio.runtime.database.project_history_migration import CURSOR, blocked, mount_project_history

PREFIX = "/v1/migration/creative"
RELATIONSHIPS = PREFIX + "/relationships/inventory"
TRANSPORT = {"maximum": 32 * 1024 * 1024, "streaming_prefix": ORIGINALS + "/"}


def mount(app, plan, sessions, *, source=None):
    mount_project_history(
        app, plan, sessions, PREFIX, datasets(plan), CreativeImportReceipt, source=source
    )

    @app.get(RELATIONSHIPS)
    async def verify():
        try:
            if source is not None:
                source.check()
            result = await verify_release_relationships(sessions)
            if source is not None:
                source.check()
        except (ValueError, OSError):
            raise blocked("migration_source_changed") from None
        return result

    return app


def create_export_app(*, plan, source_path):
    app, sessions, source = export_app(plan, source_path, **TRANSPORT)
    mount_originals(app, plan, sessions, root=source.path.parent, source=source)
    return mount(app, plan, sessions, source=source)


def create_import_app(*, plan, state_root):
    models = (*(dataset.model for dataset in datasets(plan)), CreativeImportReceipt)
    app, db = import_app(plan, state_root, "creative", models, MIGRATIONS, **TRANSPORT)
    mount_originals(app, plan, db.sessions, root=db.root, source=None)
    packer = SkillArchivePacker(
        root=db.root,
        max_files=SKILL_MAX_FILES,
        max_expanded_bytes=SKILL_EXPANDED_MAX_BYTES,
        max_archive_bytes=SKILL_ARCHIVE_MAX_BYTES,
    )
    projected = InstalledPartsExport(db.sessions, plan, packer)
    mount_dataset(
        app,
        prefix=INSTALLED_PARTS,
        plan=plan,
        cursor_pattern=CURSOR,
        batch_model=InstalledParts,
        page_model=InstalledPartsPage,
        inventory=projected.inventory,
        page=projected.page,
    )
    return mount(app, plan, db.sessions)
