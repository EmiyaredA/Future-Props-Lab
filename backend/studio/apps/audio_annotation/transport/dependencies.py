"""HTTP dependency declarations; the entrypoint supplies concrete adapters."""

from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Request

from studio.apps.audio_annotation.ports import ProjectOperations
from studio.apps.audio_annotation.schemas.document import AudioAnnotationSegmentTranscriptionOut
from studio.apps.audio_annotation.use_cases.create_project import CreateProject
from studio.apps.audio_annotation.use_cases.delete_project import DeleteProject
from studio.apps.audio_annotation.use_cases.edit_document import EditDocument
from studio.apps.audio_annotation.use_cases.saved_audio import SavedAudio
from studio.assembly.http_dependencies import OwnerDep, SessionDep


def document_editor(request: Request, session: SessionDep, owner: OwnerDep) -> EditDocument:
    return request.app.state.annotation_document_editor(request, session, owner)


DocumentEditorDep = Annotated[EditDocument, Depends(document_editor)]


def project_operations(request: Request, session: SessionDep) -> ProjectOperations:
    return request.app.state.annotation_projects(request, session)


ProjectsDep = Annotated[ProjectOperations, Depends(project_operations)]


def project_creator(request: Request, session: SessionDep, owner: OwnerDep) -> CreateProject:
    return request.app.state.annotation_project_creator(request, session, owner)


CreatorDep = Annotated[CreateProject, Depends(project_creator)]


def segment_transcriber(request: Request, session: SessionDep):
    return request.app.state.annotation_transcriber(request, session)


TranscriberDep = Annotated[
    Callable[..., Awaitable[AudioAnnotationSegmentTranscriptionOut]], Depends(segment_transcriber)
]


def project_deleter(request: Request, session: SessionDep) -> DeleteProject:
    return request.app.state.annotation_project_deleter(request, session)


DeleterDep = Annotated[DeleteProject, Depends(project_deleter)]


def saved_audio(request: Request, session: SessionDep) -> SavedAudio:
    return request.app.state.annotation_saved_audio(request, session)


SavedAudioDep = Annotated[SavedAudio, Depends(saved_audio)]
