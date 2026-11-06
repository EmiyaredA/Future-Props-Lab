"""Independent Thought mutations which atomically preserve file references."""

from fastapi import APIRouter, HTTPException, Query, Request, Response

from studio.apps.thought_workshop.directory import Directory
from studio.apps.thought_workshop.duplicate_retention import duplicate_with_references
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.http_bindings import AssetMetadataDep, SessionDep
from studio.apps.thought_workshop.knowledge import KnowledgeBases
from studio.apps.thought_workshop.knowledge_retention import (
    create_knowledge_base_with_references,
    update_knowledge_base_with_references,
)
from studio.apps.thought_workshop.knowledge_tools.schemas import (
    DuplicateIn,
    DuplicateOut,
    TemplateApply,
    TemplateIn,
    TemplateOut,
    TemplatePut,
)
from studio.apps.thought_workshop.multitable.schemas import BatchIn, BatchOut, CsvIn, RestoreIn
from studio.apps.thought_workshop.multitable_retention import mutate_table_with_references
from studio.apps.thought_workshop.note_creation import create_note_with_references
from studio.apps.thought_workshop.note_retention import (
    apply_operations_with_references,
    purge_note_with_references,
    restore_history_with_references,
    save_note_with_references,
)
from studio.apps.thought_workshop.notes import Notes
from studio.apps.thought_workshop.schemas.knowledge import (
    KnowledgeBaseIn,
    KnowledgeBaseOut,
    KnowledgeBasePut,
    KnowledgeNoteCreate,
    ThoughtDirectoryOut,
    ThoughtMoveIn,
)
from studio.apps.thought_workshop.schemas.operations import ThoughtOperationsIn
from studio.apps.thought_workshop.schemas.workshop import (
    ThoughtNoteCreate,
    ThoughtNoteOut,
    ThoughtNotePut,
    ThoughtNoteTransitionIn,
    ThoughtRevisionIn,
)
from studio.apps.thought_workshop.template_retention import (
    apply_template_with_references,
    create_template_with_references,
    mutate_template_with_references,
)
from studio.assembly.http_dependencies import OwnerDep, StudioAuth
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

router = APIRouter(prefix="/thought-workshop", tags=["thought-workshop"])


def context(request):
    references = getattr(request.app.state, "thought_references", None)
    if references is None:
        raise HTTPException(503, "thought_retention_unavailable")
    return dict(
        assertion=request.state.service_assertion,
        source_method=request.method,
        source_path=request.url.path,
        references=references,
    )


@router.post("/knowledge-bases", response_model=KnowledgeBaseOut)
async def create_knowledge_base(
    request: Request,
    body: KnowledgeBaseIn,
    session: SessionDep,
    principal: StudioAuth,
):
    return await guarded(
        create_knowledge_base_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            body=body,
            **context(request),
        )
    )


async def guarded(operation):
    try:
        return await operation
    except (ThoughtError, OperationError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except CapabilityDenied as exc:
        raise HTTPException(exc.status, "thought_retention_denied") from None
    except CapabilityUnavailable:
        raise HTTPException(503, "thought_retention_unavailable") from None


@router.post("/notes", response_model=ThoughtNoteOut)
async def create_note(
    request: Request, body: ThoughtNoteCreate, session: SessionDep, principal: StudioAuth
):
    return await guarded(
        create_note_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            body=body,
            **context(request),
        )
    )


@router.post("/notes/{note_id}/duplicate", response_model=DuplicateOut)
async def duplicate_document(
    note_id: str,
    body: DuplicateIn,
    session: SessionDep,
    assets: AssetMetadataDep,
    principal: StudioAuth,
    request: Request,
):
    return await guarded(
        duplicate_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            note_id=note_id,
            body=body,
            assets=assets,
            **context(request),
        )
    )


@router.post("/knowledge-bases/{project_id}/documents", response_model=ThoughtNoteOut)
async def create_document(
    request: Request,
    project_id: str,
    body: KnowledgeNoteCreate,
    session: SessionDep,
    principal: StudioAuth,
):
    return await guarded(
        create_note_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            project_id=project_id,
            body=body,
            **context(request),
        )
    )


@router.put("/notes/{note_id}", response_model=ThoughtNoteOut)
async def put_note(
    request: Request, note_id: str, body: ThoughtNotePut, session: SessionDep, principal: StudioAuth
):
    return await guarded(
        save_note_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            note_id=note_id,
            body=body,
            **context(request),
        )
    )


@router.post("/notes/{note_id}/operations", response_model=ThoughtNoteOut)
async def apply_note_operations(
    request: Request,
    note_id: str,
    body: ThoughtOperationsIn,
    session: SessionDep,
    principal: StudioAuth,
):
    return await guarded(
        apply_operations_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            note_id=note_id,
            body=body,
            **context(request),
        )
    )


@router.post("/notes/{note_id}/history/{history_id}/restore", response_model=ThoughtNoteOut)
async def restore_note_history(
    request: Request,
    note_id: str,
    history_id: str,
    body: ThoughtRevisionIn,
    session: SessionDep,
    principal: StudioAuth,
):
    return await guarded(
        restore_history_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            note_id=note_id,
            history_id=history_id,
            expected_revision=body.expected_revision,
            **context(request),
        )
    )


@router.delete("/notes/{note_id}", response_model=ThoughtNoteOut)
async def delete_note(
    request: Request,
    note_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
    permanent: bool = False,
    expected_knowledge_revision: int = Query(ge=0),
    cascade_children: bool = False,
):
    if not permanent:
        return await guarded(
            Notes(session, owner_user_id).transition(
                note_id,
                expected_revision,
                "trash",
                expected_knowledge_revision,
                cascade_children=cascade_children,
            )
        )
    if cascade_children:
        raise HTTPException(422, "thought_cascade_purge_unavailable")
    return await guarded(
        purge_note_with_references(
            session,
            owner=owner_user_id,
            note_id=note_id,
            expected_revision=expected_revision,
            expected_knowledge_revision=expected_knowledge_revision,
            **context(request),
        )
    )


@router.post("/templates", response_model=TemplateOut)
async def create_template(
    request: Request,
    body: TemplateIn,
    session: SessionDep,
    assets: AssetMetadataDep,
    owner_user_id: OwnerDep,
):
    return await guarded(
        create_template_with_references(
            session, owner=owner_user_id, body=body, asset_reader=assets, **context(request)
        )
    )


@router.post("/templates/{template_id}/apply", response_model=ThoughtNoteOut)
async def apply_template(
    request: Request,
    template_id: str,
    body: TemplateApply,
    session: SessionDep,
    assets: AssetMetadataDep,
    principal: StudioAuth,
):
    return await guarded(
        apply_template_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            template_id=template_id,
            body=body,
            asset_reader=assets,
            **context(request),
        )
    )


@router.put("/templates/{template_id}", response_model=TemplateOut)
async def put_template(
    request: Request,
    template_id: str,
    body: TemplatePut,
    session: SessionDep,
    assets: AssetMetadataDep,
    owner_user_id: OwnerDep,
):
    return await guarded(
        mutate_template_with_references(
            session,
            owner=owner_user_id,
            template_id=template_id,
            body=body,
            asset_reader=assets,
            **context(request),
        )
    )


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    request: Request,
    template_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    await guarded(
        mutate_template_with_references(
            session,
            owner=owner_user_id,
            template_id=template_id,
            expected_revision=expected_revision,
            **context(request),
        )
    )
    return Response(status_code=204)


@router.post(
    "/notes/{note_id}/multitable/operations",
    response_model=BatchOut,
    operation_id="operations_v1_thought_workshop_notes__note_id__multitable_operations_post",
    summary="Operations",
    tags=["thought-multitable"],
)
async def table_operations(
    request: Request, note_id: str, body: BatchIn, session: SessionDep, principal: StudioAuth
):
    return await guarded(
        mutate_table_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            note_id=note_id,
            expected_revision=body.expected_revision,
            body=body,
            **context(request),
        )
    )


@router.post(
    "/notes/{note_id}/multitable/history/{revision}/restore",
    response_model=BatchOut,
    operation_id="restore_v1_thought_workshop_notes__note_id__multitable_history__revision__restore_post",
    summary="Restore",
    tags=["thought-multitable"],
)
async def table_restore(
    request: Request,
    note_id: str,
    revision: int,
    body: RestoreIn,
    session: SessionDep,
    principal: StudioAuth,
):
    return await guarded(
        mutate_table_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            note_id=note_id,
            expected_revision=body.expected_revision,
            history_revision=revision,
            **context(request),
        )
    )


@router.post(
    "/notes/{note_id}/multitable/tables/{table_id}/csv-import",
    response_model=BatchOut,
    operation_id="csv_import_v1_thought_workshop_notes__note_id__multitable_tables__table_id__csv_import_post",
    summary="Csv Import",
    tags=["thought-multitable"],
)
async def table_csv_import(
    request: Request,
    note_id: str,
    table_id: str,
    body: CsvIn,
    session: SessionDep,
    principal: StudioAuth,
):
    return await guarded(
        mutate_table_with_references(
            session,
            owner=principal.user_id,
            author_id=principal.user_id,
            note_id=note_id,
            table_id=table_id,
            expected_revision=body.expected_revision,
            body=body,
            **context(request),
        )
    )


@router.post(
    "/notes/{note_id}/restore",
    response_model=ThoughtNoteOut,
    operation_id="restore_note_v1_thought_workshop_notes__note_id__restore_post",
    summary="Restore Note",
)
async def restore_trashed_note(
    note_id: str, body: ThoughtNoteTransitionIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await guarded(
        Notes(session, owner_user_id).transition(
            note_id, body.expected_revision, "restore", body.expected_knowledge_revision
        )
    )


@router.put("/knowledge-bases/{project_id}", response_model=KnowledgeBaseOut)
async def update_knowledge_base(
    request: Request,
    project_id: str,
    body: KnowledgeBasePut,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await guarded(
        update_knowledge_base_with_references(
            session, owner=owner_user_id, project_id=project_id, body=body, **context(request)
        )
    )


@router.delete("/knowledge-bases/{project_id}", response_model=KnowledgeBaseOut)
async def trash_knowledge_base(
    project_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    return await guarded(
        KnowledgeBases(session, owner_user_id).transition(project_id, expected_revision, False)
    )


@router.post("/knowledge-bases/{project_id}/restore", response_model=KnowledgeBaseOut)
async def restore_knowledge_base(
    project_id: str, body: ThoughtRevisionIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await guarded(
        KnowledgeBases(session, owner_user_id).transition(project_id, body.expected_revision, True)
    )


@router.post("/knowledge-bases/{project_id}/move", response_model=ThoughtDirectoryOut)
async def move_entry(
    project_id: str, body: ThoughtMoveIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await guarded(Directory(session, owner_user_id).move(project_id, body))
