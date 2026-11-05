"""Bind Annotation editing to its request-owned SQLite session."""

from studio.apps.audio_annotation.clients.creation_inputs import AudioCreationInputs
from studio.apps.audio_annotation.storage.document_edits import SqlDocumentEdits
from studio.apps.audio_annotation.use_cases.create_project import CreateProject
from studio.apps.audio_annotation.use_cases.edit_document import EditDocument
from studio.runtime.ids import new_id


def document_editor(request, session, owner):
    projects = request.app.state.annotation_projects(request, session)
    return EditDocument(SqlDocumentEdits(session, owner, projects))


def project_creator(request, session, owner):
    records = request.app.state.annotation_projects(request, session)
    return CreateProject(
        owner=owner,
        inputs=AudioCreationInputs(records.sources),
        store=records,
        ids=new_id,
    )
