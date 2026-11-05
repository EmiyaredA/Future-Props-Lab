"""Bind Annotation editing to its request-owned SQLite session."""

from studio.apps.audio_annotation.clients.creation_inputs import AudioCreationInputs
from studio.apps.audio_annotation.clients.saved_audio import LocalClips, SegmentRecognition
from studio.apps.audio_annotation.storage.document_edits import SqlDocumentEdits
from studio.apps.audio_annotation.use_cases.create_project import CreateProject
from studio.apps.audio_annotation.use_cases.delete_project import DeleteProject
from studio.apps.audio_annotation.use_cases.edit_document import EditDocument
from studio.apps.audio_annotation.use_cases.saved_audio import SavedAudio
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


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


def project_deleter(request, session):
    return DeleteProject(request.app.state.annotation_projects(request, session))


def saved_audio(request, session):
    state = request.app.state
    records = state.annotation_projects(request, session)
    return SavedAudio(
        documents=records,
        clips=LocalClips(
            sources=records.sources,
            release_reads=session.rollback,
            staging=state.annotation_staging,
        ),
        recognition=SegmentRecognition(state.annotation_transcriber(request, session)),
        clock=utc_now,
    )
