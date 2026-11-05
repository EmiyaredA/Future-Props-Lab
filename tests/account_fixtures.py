"""Explicit isolated account records for storage-layer tests."""

from app.console.models import User


def account_record(*, id, name):
    return User(
        id=id,
        username=id,
        username_normalized=id,
        display_name=name,
        password_hash="unused-test-hash",
    )


def switch_desktop_account(backend):
    from uuid import uuid4

    username = "other-" + uuid4().hex[:10]
    result = backend.client.post(
        "/v1/platform/accounts", json={"username": username, "display_name": username}
    )
    assert result.status_code == 201, result.text
    body = result.json()
    login = backend.client.post(
        "/v1/auth/login", json={"username": username, "password": body["temporary_password"]}
    )
    assert login.status_code == 200, login.text
    backend.client.headers["X-CSRF-Token"] = backend.client.cookies["fpl_csrf"]
    changed = backend.client.post(
        "/v1/auth/change-password",
        json={
            "current_password": body["temporary_password"],
            "new_password": "Other-Account-Tests-2026!",
        },
    )
    assert changed.status_code == 204, changed.text
    backend.client.headers["X-CSRF-Token"] = backend.client.cookies["fpl_csrf"]
    return body["user"]["id"] if "user" in body else body["account"]["id"]


async def clear_private_projects(owner="test-user"):
    """Fixture cleanup uses the same ordered reference deletion as business writes."""
    from sqlalchemy import delete, select

    from app.apps.galgame_workshop.models import GalgameWorkshopProject
    from app.apps.galgame_workshop.projects import GalgameWorkshopProjects
    from app.apps.video_editor.models import VideoEditorProject
    from app.apps.video_editor.projects import VideoEditorProjects
    from app.apps.visual_workshop.models import VisualWorkshopProject
    from app.apps.visual_workshop.projects import VisualWorkshopProjects
    from app.orm import TENANT_MODELS
    from app.runtime.db import SessionLocal

    dependents = {
        "thought_sync_tasks",
        "thought_knowledge_bases",
        "audio_annotation_projects",
        "presentation_projects",
        "presentation_templates",
        "presentation_examples",
        "director_desk_projects",
        "motion_compositor_projects",
    }
    async with SessionLocal() as session:
        for model in TENANT_MODELS:
            if model.__tablename__ in dependents:
                await session.execute(delete(model).where(model.owner_user_id == owner))
        await session.commit()
    for model, use_case in [
        (VideoEditorProject, VideoEditorProjects),
        (GalgameWorkshopProject, GalgameWorkshopProjects),
        (VisualWorkshopProject, VisualWorkshopProjects),
    ]:
        async with SessionLocal() as reader:
            roots = list(
                (
                    await reader.execute(
                        select(model.id, model.revision).where(model.owner_user_id == owner)
                    )
                ).all()
            )
        for identity, revision in roots:
            async with SessionLocal() as session:
                await use_case(session, owner).delete(identity, revision)
