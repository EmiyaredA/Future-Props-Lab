"""Model execution limits; shared protocol values carry no storage dependencies."""

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
