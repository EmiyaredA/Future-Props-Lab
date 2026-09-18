from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request, Response, status

from app.capabilities.identity.error_views import error_detail
from app.capabilities.identity.permissions import role_permissions
from app.console.governance.member_roles import update_member_role
from app.console.governance.service import AccountError
from app.console.governance.workspaces import (
    act_on_invitation,
    create_invitation,
    invitation_views,
    list_members,
    list_workspaces,
    patch_workspace,
    remove_member,
    switch_workspace,
)
from app.deps import (
    SessionDep,
    authenticate_studio_request,
    client_ip,
)
from app.schemas.accounts import (
    WorkspaceInvitationActionIn,
    WorkspaceInvitationCreateIn,
    WorkspaceInvitationListOut,
    WorkspaceInvitationOut,
    WorkspaceListItem,
    WorkspaceListOut,
    WorkspaceMemberListOut,
    WorkspaceMemberOut,
    WorkspaceMemberRemoveIn,
    WorkspaceMemberRoleIn,
    WorkspaceOut,
    WorkspacePatchIn,
    WorkspaceSwitchIn,
)

router = APIRouter(prefix="/account/workspaces", tags=["account-workspaces"])
invitation_router = APIRouter(prefix="/account/workspace-invitations", tags=["account-workspaces"])


async def _browser_auth(request: Request, session: SessionDep):
    principal = await authenticate_studio_request(request, session, required_scope="studio:read")
    if principal.auth_kind != "session":
        raise HTTPException(403, detail={"code": "browser_session_required"})
    return principal


def _raise(exc: AccountError) -> None:
    status_code, detail = error_detail(exc)
    raise HTTPException(status_code, detail=detail) from exc


def _workspace_out(workspace, access: str, role: str | None) -> WorkspaceOut:
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        visibility=workspace.visibility,
        revision=workspace.revision,
        access_kind=access,
        role=role,
        permission_keys=sorted(role_permissions(access, role)),
    )


@router.get("", response_model=WorkspaceListOut)
async def accessible_workspaces(
    request: Request,
    session: SessionDep,
    q: str = Query("", max_length=200),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    principal = await _browser_auth(request, session)
    rows, total = await list_workspaces(
        session,
        principal=principal,
        query=q,
        page=page,
        page_size=page_size,
    )
    return WorkspaceListOut(
        items=[
            WorkspaceListItem(
                **_workspace_out(item["workspace"], item["access_kind"], item["role"]).model_dump(),
                member_count=item["member_count"],
                owner_username=item["owner_username"],
                owner_display_name=item["owner_display_name"],
            )
            for item in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/switch", response_model=WorkspaceOut)
async def set_active_workspace(request: Request, session: SessionDep, body: WorkspaceSwitchIn):
    principal = await _browser_auth(request, session)
    try:
        workspace, access, membership = await switch_workspace(
            session,
            principal=principal,
            workspace_id=body.workspace_id,
            client_ip=client_ip(request),
        )
    except AccountError as exc:
        _raise(exc)
    return _workspace_out(workspace, access, membership.role if membership else None)


@router.patch("/current", response_model=WorkspaceOut)
async def update_workspace(request: Request, session: SessionDep, body: WorkspacePatchIn):
    principal = await _browser_auth(request, session)
    try:
        workspace = await patch_workspace(
            session,
            principal=principal,
            name=body.name,
            visibility=body.visibility,
            expected_revision=body.expected_revision,
            client_ip=client_ip(request),
        )
    except AccountError as exc:
        _raise(exc)
    return _workspace_out(workspace, principal.workspace_access, principal.member_role)


@router.get("/current/members", response_model=WorkspaceMemberListOut)
async def members(request: Request, session: SessionDep):
    principal = await _browser_auth(request, session)
    try:
        rows = await list_members(session, principal)
    except AccountError as exc:
        _raise(exc)
    items = [WorkspaceMemberOut(**row) for row in rows]
    return WorkspaceMemberListOut(items=items, total=len(items))


@router.delete("/current/members/{membership_id}", status_code=204)
async def delete_member(
    membership_id: str,
    request: Request,
    session: SessionDep,
    body: WorkspaceMemberRemoveIn,
):
    principal = await _browser_auth(request, session)
    try:
        await remove_member(
            session,
            principal=principal,
            membership_id=membership_id,
            expected_revision=body.expected_revision,
            client_ip=client_ip(request),
        )
    except AccountError as exc:
        _raise(exc)
    return Response(status_code=204)


@router.get("/current/invitations", response_model=WorkspaceInvitationListOut)
async def workspace_invitations(request: Request, session: SessionDep):
    principal = await _browser_auth(request, session)
    try:
        rows = await invitation_views(session, principal=principal, current_workspace_only=True)
    except AccountError as exc:
        _raise(exc)
    return WorkspaceInvitationListOut(
        items=[WorkspaceInvitationOut(**row) for row in rows], total=len(rows)
    )


@router.post(
    "/current/invitations",
    response_model=WorkspaceInvitationOut,
    status_code=status.HTTP_201_CREATED,
)
async def invite_member(request: Request, session: SessionDep, body: WorkspaceInvitationCreateIn):
    principal = await _browser_auth(request, session)
    try:
        invitation = await create_invitation(
            session,
            principal=principal,
            username=body.username,
            role=body.role,
            client_ip=client_ip(request),
        )
        rows = await invitation_views(session, principal=principal, current_workspace_only=True)
    except AccountError as exc:
        _raise(exc)
    return WorkspaceInvitationOut(**next(row for row in rows if row["id"] == invitation.id))


@router.delete("/current/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(
    invitation_id: str,
    request: Request,
    session: SessionDep,
    body: WorkspaceInvitationActionIn,
):
    principal = await _browser_auth(request, session)
    try:
        await act_on_invitation(
            session,
            principal=principal,
            invitation_id=invitation_id,
            expected_revision=body.expected_revision,
            action="revoked",
            client_ip=client_ip(request),
        )
    except AccountError as exc:
        _raise(exc)
    return Response(status_code=204)


@invitation_router.get("", response_model=WorkspaceInvitationListOut)
async def my_invitations(request: Request, session: SessionDep):
    principal = await _browser_auth(request, session)
    rows = await invitation_views(session, principal=principal, current_workspace_only=False)
    return WorkspaceInvitationListOut(
        items=[WorkspaceInvitationOut(**row) for row in rows], total=len(rows)
    )


async def _respond(
    action: str,
    invitation_id: str,
    request: Request,
    session: SessionDep,
    body: WorkspaceInvitationActionIn,
):
    principal = await _browser_auth(request, session)
    try:
        await act_on_invitation(
            session,
            principal=principal,
            invitation_id=invitation_id,
            expected_revision=body.expected_revision,
            action=action,
            client_ip=client_ip(request),
        )
    except AccountError as exc:
        _raise(exc)
    return Response(status_code=204)


@invitation_router.post("/{invitation_id}/accept", status_code=204)
async def accept_invitation(
    invitation_id: str,
    request: Request,
    session: SessionDep,
    body: WorkspaceInvitationActionIn,
):
    return await _respond("accepted", invitation_id, request, session, body)


@invitation_router.post("/{invitation_id}/decline", status_code=204)
async def decline_invitation(
    invitation_id: str,
    request: Request,
    session: SessionDep,
    body: WorkspaceInvitationActionIn,
):
    return await _respond("declined", invitation_id, request, session, body)


@router.patch("/current/members/{membership_id}", response_model=WorkspaceMemberOut)
async def set_member_role(
    membership_id: str, request: Request, session: SessionDep, body: WorkspaceMemberRoleIn
):
    principal = await _browser_auth(request, session)
    try:
        await update_member_role(
            session,
            principal,
            membership_id=membership_id,
            role=body.role,
            expected_revision=body.expected_revision,
            client_ip=client_ip(request),
        )
        rows = await list_members(session, principal)
    except AccountError as exc:
        _raise(exc)
    return WorkspaceMemberOut(**next(row for row in rows if row["membership_id"] == membership_id))
