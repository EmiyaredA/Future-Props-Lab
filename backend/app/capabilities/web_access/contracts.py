import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator


class GatewayProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: str = ""
    local_port: int = Field(default=28081, ge=1024, le=65535)
    host: str = Field(default="", max_length=253)
    ssh_port: int = Field(default=22, ge=1, le=65535)
    user: str = Field(default="", max_length=64)
    remote_port: int = Field(default=28080, ge=1024, le=65535)
    identity_id: str = Field(default="", pattern=r"^(?:[a-f0-9]{32})?$")
    known_hosts_id: str = Field(default="", pattern=r"^(?:[a-f0-9]{32})?$")

    @model_validator(mode="after")
    def validate_addresses(self):
        if self.origin:
            parsed = urlsplit(self.origin)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or self.origin != f"https://{parsed.netloc}"
                or any(c.isspace() for c in self.origin)
            ):
                raise ValueError("公网地址必须是精确 HTTPS 来源")
        if self.host and not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.:-]*", self.host):
            raise ValueError("SSH 主机格式无效")
        if self.user and not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_-]*", self.user):
            raise ValueError("SSH 用户格式无效")
        return self


class AccessConfigOut(BaseModel):
    revision: str
    profile: GatewayProfile
    identity_fingerprint: str = ""
    known_hosts_fingerprint: str = ""
    legacy_available: bool = False


class AccessConfigIn(BaseModel):
    expected_revision: str = Field(min_length=64, max_length=64)
    profile: GatewayProfile


class ConfigPrepared(BaseModel):
    apply_receipt: str
    restart_required: bool = True


class AccessAction(BaseModel):
    action: Literal["local_start", "local_stop", "public_start", "public_stop", "check"]


class EndpointStatus(BaseModel):
    phase: Literal["off", "starting", "ready", "connecting", "reconnecting", "failed"] = "off"
    url: str = ""
    error: str = ""
    last_checked_at: str = ""


class AccessStatus(BaseModel):
    local: EndpointStatus
    public: EndpointStatus
    build_id: str = ""
    bytes_received: int = 0
    bytes_sent: int = 0
    requests: int = 0


class CredentialTicketIn(BaseModel):
    kind: Literal["identity", "known_hosts"]


class CredentialTicketOut(BaseModel):
    ticket: str


class CredentialImportIn(BaseModel):
    ticket: str = Field(min_length=32, max_length=128)
    path: str = Field(min_length=1, max_length=4096)


class CredentialOut(BaseModel):
    id: str
    fingerprint: str


class ReceiptIn(BaseModel):
    receipt: str = Field(min_length=32, max_length=128)
