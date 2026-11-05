"""HTTP dependency declarations; the entrypoint supplies concrete adapters."""

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Annotated

from fastapi import Depends, Request

from studio.apps.audio_annotation.ports import ProjectOperations
from studio.apps.audio_annotation.schemas.document import AudioAnnotationSegmentTranscriptionOut
from studio.apps.audio_annotation.use_cases.create_project import CreateProject
from studio.apps.audio_annotation.use_cases.edit_document import EditDocument
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


def staging_directory(request: Request) -> Path | None:
    return request.app.state.annotation_staging


TranscriberDep = Annotated[
    Callable[..., Awaitable[AudioAnnotationSegmentTranscriptionOut]], Depends(segment_transcriber)
]
StagingDep = Annotated[Path | None, Depends(staging_directory)]
