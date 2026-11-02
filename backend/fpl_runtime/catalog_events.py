"""Version-one private account-created delivery; no passwords, sessions or provider secrets."""

import hashlib
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

EventId = Annotated[str, Field(min_length=1, max_length=36, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")]
Revision = Annotated[int, Field(strict=True, ge=0, le=2147483647)]


class AccountCreated(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    user_id: EventId
    platform_role: Literal["admin", "user"]


class CatalogEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    id: EventId
    type: Literal["account.created"]
    payload: AccountCreated
    revision: Revision

    def digest(self):
        data = json.dumps(
            self.model_dump(mode="json"), sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode()
        return hashlib.sha256(data).hexdigest()


class CatalogSubject(AccountCreated):
    revision: Revision


class CatalogDelivery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    event: CatalogEvent
    account: CatalogSubject
    expires_at: int = Field(strict=True, ge=0)

    @model_validator(mode="after")
    def matching_account(self):
        if self.account.user_id != self.event.payload.user_id:
            raise ValueError("目录事件与当前账号状态不匹配")
        return self


class CatalogEvents(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    events: tuple[CatalogDelivery, ...] = Field(max_length=100)


class AcknowledgeCatalogEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    revision: Revision


class CatalogAcknowledgment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    id: EventId
    revision: int = Field(strict=True, ge=1, le=2147483648)
    acknowledged: Literal[True]
