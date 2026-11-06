"""Preserve the Remote Apps contract for independent deployments without a capture host."""

from fastapi import APIRouter, Depends, HTTPException, Request

from studio.contracts.remote_desktop.apps import (
    InstalledRemoteApps,
    RemoteAppCatalog,
    RemoteAppConnect,
    RemoteAppHandshake,
    SaveRemoteApps,
)
from studio.runtime.http.dependencies import StudioAuth, require_studio_auth
from studio.runtime.http.website import require_local_browser

router = APIRouter(prefix="/cloud-control/apps", tags=["cloud-control"])


def disabled():
    raise HTTPException(404, "远程应用尚未启用")


@router.get("", response_model=RemoteAppCatalog, dependencies=[Depends(require_studio_auth)])
async def list_apps():
    disabled()


@router.get("/installed", response_model=InstalledRemoteApps)
async def installed(request: Request, principal: StudioAuth):
    require_local_browser(request, principal)
    disabled()


@router.put("", response_model=InstalledRemoteApps)
async def save_apps(request: Request, _body: SaveRemoteApps, principal: StudioAuth):
    require_local_browser(request, principal)
    disabled()


@router.post(
    "/connect", response_model=RemoteAppHandshake, dependencies=[Depends(require_studio_auth)]
)
async def connect(_body: RemoteAppConnect):
    disabled()
