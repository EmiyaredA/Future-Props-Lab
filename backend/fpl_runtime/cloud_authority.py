"""Private Cloud Control status and desktop ticket proof, bound to the source request."""

import hashlib
import re

from pydantic import BaseModel, ConfigDict, Field

DESKTOP_SOCKET = "/v1/cloud-control/desktop/socket"
DESKTOP_COOKIE = "fpl_desktop_ticket"
AUTHORITY_PATH = "/_internal/v1/cloud-control/authority"
TICKET_SECONDS = 30


def desktop_ticket_digest(token):
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        return None
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def is_desktop_upgrade(service, method, path):
    return (service, method.upper(), path) == ("remote", "GET", DESKTOP_SOCKET)


def permits_cloud_authority(service, method, path):
    if service == "remote":
        return (method, path) in {
            ("GET", "/v1/cloud-control/status"),
            ("GET", "/v1/cloud-control/settings"),
            ("PUT", "/v1/cloud-control/settings"),
            ("PUT", "/v1/cloud-control/desktop/idle"),
            ("POST", "/v1/cloud-control/desktop/connect"),
            ("GET", DESKTOP_SOCKET),
        }
    if service != "agents":
        return False
    if (method, path) in {
        ("GET", "/v1/agent-workbench/execution/catalog"),
        ("GET", "/v1/agent-workbench/execution/directories"),
        ("POST", "/v1/agent-workbench/execution/projects"),
    }:
        return True
    return method == "POST" and bool(
        re.fullmatch(
            r"/v1/agent-workbench/chats(?:/[^/]+/turns(?:/[^/]+/approvals/[^/]+)?)?",
            path,
        )
    )


class CloudAuthorityQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    service: str = Field(max_length=16)
    method: str = Field(max_length=8)
    path: str = Field(max_length=1024)
    assertion: str = Field(max_length=8192, repr=False)


class CloudAuthority(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    active: bool
    enabled: bool = False
    enrolled: bool = False
    unlocked_until: int = Field(default=0, ge=0)
    desktop_configured: bool = False
    desktop_authorized: bool = False
    factor_epoch: str | None = None
