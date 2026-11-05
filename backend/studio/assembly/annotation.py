"""Bind Annotation editing to its request-owned SQLite session."""

from studio.apps.audio_annotation.storage.document_edits import SqlDocumentEdits
from studio.apps.audio_annotation.use_cases.edit_document import EditDocument


def document_editor(request, session, owner):
    projects = request.app.state.annotation_projects(request, session)
    return EditDocument(SqlDocumentEdits(session, owner, projects))
