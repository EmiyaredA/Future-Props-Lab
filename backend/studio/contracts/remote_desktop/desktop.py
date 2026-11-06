from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class CloudStatus(BaseModel):
    enabled: bool
    host_label: str
    desktop_configured: bool
    desktop_authorized: bool
    local: bool
    unlocked_until: int
    idle_minutes: int
    idle_revision: int
    happier_available: bool = False


class DesktopLogin(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    password: SecretStr = Field(min_length=1, max_length=128)

    @field_validator("password")
    @classmethod
    def check_password(cls, value):
        if "\x00" in value.get_secret_value():
            raise ValueError("VNC 密码格式无效")
        return value


class IdlePreference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idle_minutes: int = Field(strict=True, ge=5, le=120)
    revision: int = Field(ge=0)


class CloudSetup(BaseModel):
    revision: str
    host_label: str
    enabled: bool
    public_enabled: bool
    public_desktop_vnc_only: bool
    guacd_ready: bool
    screen_sharing_ready: bool | None


class CloudSetupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    host_label: str = Field(min_length=1, max_length=80)
    public_enabled: bool
