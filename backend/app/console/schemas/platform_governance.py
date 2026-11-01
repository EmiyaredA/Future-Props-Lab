from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class QuotaLimit(BaseModel):
    total: int = Field(ge=0, le=1024)
    realtime_voice: int = Field(ge=0, le=1024)

    @model_validator(mode="after")
    def voice_subset(self):
        if self.realtime_voice > self.total:
            raise ValueError("语音额度不能超过总额度")
        return self


class GenerationQueueLimits(BaseModel):
    user: int = Field(default=20, ge=0, le=1024)
    admin: int = Field(default=20, ge=0, le=1024)


class RuntimeQuotas(BaseModel):
    generation_queue: GenerationQueueLimits = Field(default_factory=GenerationQueueLimits)
    user: QuotaLimit = QuotaLimit(total=2, realtime_voice=1)
    admin: QuotaLimit = QuotaLimit(total=4, realtime_voice=2)
    instance: QuotaLimit = QuotaLimit(total=16, realtime_voice=8)
    reserved_for_admins: int = Field(default=2, ge=0, le=1024)

    @model_validator(mode="after")
    def limits(self):
        if self.instance.total < 1:
            raise ValueError("账号额度不能超过实例总额度")
        if self.reserved_for_admins > self.instance.total:
            raise ValueError("管理员预留额度不能超过实例总额度")
        for role in (self.user, self.admin):
            if (
                role.total > self.instance.total
                or role.realtime_voice > self.instance.realtime_voice
            ):
                raise ValueError("账号额度不能超过实例额度")
        return self


class RuntimeQuotasOut(BaseModel):
    revision: int
    value: RuntimeQuotas


class RuntimeQuotasIn(BaseModel):
    expected_revision: int = Field(ge=0)
    value: RuntimeQuotas


class RegistrationIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str = Field(default="", max_length=120)
    email: str | None = Field(default=None, max_length=254)
    password: str = Field(min_length=1, max_length=256)
    invite_code: str = Field(min_length=1, max_length=200)


class RegistrationInviteIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    max_uses: int = Field(default=1, ge=1, le=10000)
    validity_days: int = Field(default=7, ge=1, le=365)


class RegistrationInvitePatch(BaseModel):
    expected_revision: int = Field(ge=0)
    enabled: bool | None = None
    max_uses: int | None = Field(default=None, ge=1, le=10000)


class RegistrationInviteAction(BaseModel):
    expected_revision: int = Field(ge=0)
    action: Literal["extend", "reset_expiry", "delete"]
    days: int = Field(default=7, ge=1, le=365)


class RegistrationInviteOut(BaseModel):
    id: str
    name: str
    code_hint: str
    enabled: bool
    status: Literal["active", "disabled", "expired", "exhausted", "deleted"]
    max_uses: int
    used_count: int
    validity_days: int
    expires_at: datetime
    revision: int
    created_at: datetime


class RegistrationInvitePage(BaseModel):
    items: list[RegistrationInviteOut]
    total: int
    page: int
    page_size: int


class SecretOut(BaseModel):
    secret: str


class RegistrationInviteCreated(BaseModel):
    invite: RegistrationInviteOut
    secret: str


class RedemptionOut(BaseModel):
    id: str
    username: str
    display_name: str
    created_at: datetime


class RedemptionPage(BaseModel):
    items: list[RedemptionOut]
    total: int
    page: int
    page_size: int


class DeveloperDocumentOut(BaseModel):
    id: str
    source: str
    group: str
    markdown: str


class DeveloperDocumentsOut(BaseModel):
    items: list[DeveloperDocumentOut]


class CertificationIn(BaseModel):
    is_official: bool
    expected_revision: int = Field(ge=0)


class CertificationOut(BaseModel):
    id: str
    is_official: bool
    revision: int
