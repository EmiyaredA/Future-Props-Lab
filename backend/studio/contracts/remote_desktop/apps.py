from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

AppId = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
APPS_PATH = "/v1/cloud-control/apps"
APP_SOCKET = APPS_PATH + "/socket"
APP_PROTOCOL = "fpl-remote-app-v1"


class RemoteApp(BaseModel):
    id: AppId
    name: str = Field(min_length=1, max_length=160)
    recommended: bool = False


class RemoteAppCatalog(BaseModel):
    apps: list[RemoteApp]


class InstalledRemoteApps(RemoteAppCatalog):
    revision: str
    allowed_ids: list[AppId]


class SaveRemoteApps(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    app_ids: list[AppId] = Field(max_length=32)


class RemoteAppConnect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    app_id: AppId


class RemoteAppIceServer(BaseModel):
    urls: list[str]
    username: str
    credential: str


class RemoteAppHandshake(BaseModel):
    ticket: str
    ice_servers: list[RemoteAppIceServer]


class NativeAppLease(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session: str = Field(pattern=r"^[a-f0-9]{32}$")
    app_id: AppId
