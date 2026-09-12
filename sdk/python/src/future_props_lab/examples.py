"""Runnable examples imported by documentation checks and isolated API tests."""

from .builders import edit_batch, entity_edit, presentation_document


def create_deck(client):
    return client.presentation.create_project(
        body={
            "title": "由 Python 创建的文稿",
            "document": presentation_document(),
        }
    )


async def create_deck_async(client):
    return await client.presentation.create_project(
        body={
            "title": "由 Python 创建的文稿",
            "document": presentation_document(),
        }
    )


def update_slide_notes(client, project, text):
    slide = project.document.slides[0]
    return client.presentation.apply_presentation_operations(
        project_id=project.id,
        body=edit_batch(
            project.revision, entity_edit("slide", "update", slide.id, value={"notes": text})
        ),
    )
