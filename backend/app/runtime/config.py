from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from studio.config import CONFIG_FILE, ConfigurationError, read_config
from studio.config.cloud_projection import CloudProjection

REPO_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[3]))


class CloudCommand(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    label: str = Field(min_length=1, max_length=80)
    argv: list[str] = Field(min_length=1, max_length=32)
    executables: list[str] = Field(default_factory=list, max_length=32)
    runtime_roots: list[str] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def validate_paths(self) -> CloudCommand:
        if any(
            not Path(path).is_absolute()
            for path in (self.argv[0], *self.executables, *self.runtime_roots)
        ) or any("\x00" in arg for arg in self.argv):
            raise ValueError("云控命令路径必须为绝对路径")
        return self


class CloudProject(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    label: str = Field(min_length=1, max_length=80)
    root: str
    user_ids: list[str]
    commands: dict[str, CloudCommand] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_root(self) -> CloudProject:
        path = Path(self.root)
        if not path.is_absolute() or ".." in path.parts or len(path.parts) < 3:
            raise ValueError("云控项目必须指向专用绝对路径")
        return self


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", hide_input_in_errors=True)

    def __init__(
        self, *, _config_file: Path | None = CONFIG_FILE, _read_environment: bool = True, **values
    ):
        from pydantic_settings import EnvSettingsSource

        configured = read_config(_config_file)
        if _read_environment:
            configured.update(EnvSettingsSource(type(self))())
        configured.update(
            {
                name.lower() if name.lower() in type(self).model_fields else name: value
                for name, value in values.items()
            }
        )
        super().__init__(**configured)

    @classmethod
    def settings_customise_sources(cls, _settings_cls, init_settings, **_unused):
        # Sources are assembled once above, allowing tests to opt out of shell state.
        return (init_settings,)

    @classmethod
    def validate_file_values(cls, values: dict) -> Settings:
        from pydantic import ValidationError

        try:
            return cls(_config_file=None, _read_environment=False, **values)
        except ValidationError:
            raise ConfigurationError("配置校验失败，请检查加密密钥、地址和容量限制") from None

    fpl_deployment_compose_file: str = ""
    fpl_deployment_project_name: str = "future-props-lab"
    fpl_deployment_environment: dict[str, str] = Field(default_factory=dict)
    fpl_management_host_base_url: str = "http://127.0.0.1:29092/management"
    fpl_management_host_credential_file: str = ""
    fpl_management_host_state_root: str = ".runtime/management-host"
    fpl_management_host_business_services: str = ""
    fpl_management_host_credentials_root: str = "backend/web-access/credentials"
    fpl_management_host_auto_start: bool = True
    fpl_management_remote_port: int = Field(default=28083, ge=1024, le=65535)
    fpl_management_remote_ssh_host: str = ""
    fpl_management_remote_ssh_user: str = ""
    fpl_management_remote_ssh_port: int = Field(default=22, ge=1, le=65535)
    fpl_management_remote_remote_port: int = Field(default=28082, ge=1024, le=65535)
    fpl_management_remote_identity_id: str = ""
    fpl_management_remote_known_hosts_id: str = ""
    fpl_management_remote_enabled: bool = False
    fpl_management_local_origin: str = "http://127.0.0.1:9002"
    fpl_management_public_origin: str = ""

    fpl_website_port: int = Field(default=9000, ge=1024, le=65535)
    fpl_website_web_root: str = ".local/studio-release"
    fpl_website_public_enabled: bool = False
    fpl_website_legacy_data_root: str = ""
    fpl_database_path: str = ".runtime/future-props.db"
    fpl_agent_workbench_enabled: bool = True
    fpl_agent_workbench_poll_seconds: int = Field(default=1, ge=1, le=30)
    fpl_agent_workbench_files_per_pass: int = Field(default=100, ge=1, le=1000)
    fpl_cloud_control_enabled: bool = False
    fpl_cloud_control_public_enabled: bool = False
    fpl_cloud_control_public_desktop_vnc_only: bool = False
    fpl_cloud_control_admin_user_ids: str = ""
    fpl_cloud_control_host_label: str = "Mac"
    fpl_cloud_control_guacd_port: int = Field(default=4822, ge=1, le=65535)
    fpl_cloud_control_vnc_host: str = "host.docker.internal"
    fpl_cloud_control_vnc_port: int = Field(default=5900, ge=1, le=65535)
    fpl_cloud_control_vnc_password: str = Field(default="", repr=False)
    fpl_cloud_control_projects: dict[str, CloudProject] = Field(default_factory=dict)
    fpl_code_agents_codex_enabled: bool | None = None
    fpl_code_agents_codex_executable: str = ""
    fpl_code_agents_claude_enabled: bool | None = None
    fpl_code_agents_claude_executable: str = ""
    fpl_code_agents_opencode_enabled: bool | None = None
    fpl_code_agents_opencode_executable: str = ""
    fpl_code_agents_dsh_enabled: bool | None = None
    fpl_code_agents_dsh_executable: str = ""
    fpl_code_agents_pi_enabled: bool | None = None
    fpl_code_agents_pi_executable: str = ""
    fpl_interview_codex_enabled: bool = False
    fpl_interview_codex_executable: str = ""
    fpl_interview_codex_user_id: str = ""
    fpl_acceptance_model_owner_user_id: str = ""
    fpl_acceptance_model_id: str = ""
    fpl_acceptance_codex_executable: str = ""
    fpl_acceptance_codex_user_ids: str = ""
    fpl_acceptance_claude_executable: str = ""
    fpl_acceptance_claude_user_ids: str = ""
    cors_origins: str = "http://127.0.0.1:3000,http://localhost:3000"
    fpl_secrets_key: str = ""
    legacy_fpl_studio_token: str = Field(
        default="", validation_alias="FPL_STUDIO_TOKEN", exclude=True
    )
    fpl_auth_cookie_secure: bool = False
    fpl_remote_web_enabled: bool = False
    fpl_remote_web_origin: str = ""
    fpl_remote_web_port: int = 28081
    fpl_remote_web_root: str = ""
    fpl_remote_web_ssh_host: str = ""
    fpl_remote_web_ssh_user: str = ""
    fpl_remote_web_ssh_port: int = Field(default=22, ge=1, le=65535)
    fpl_remote_web_remote_port: int = Field(default=28080, ge=1024, le=65535)
    fpl_remote_web_identity_id: str = ""
    fpl_remote_web_known_hosts_id: str = ""
    fpl_visual_asset_max_bytes: int = 200 * 1024 * 1024
    fpl_galgame_export_max_bytes: int = 8 * 1024 * 1024 * 1024
    fpl_temp_media_upload_url: str = ""
    fpl_mcp_stdio_allowed_commands: str = ""
    fpl_skill_archive_max_bytes: int = 20 * 1024 * 1024
    fpl_skill_expanded_max_bytes: int = 50 * 1024 * 1024
    fpl_skill_max_files: int = 500
    fpl_project_snapshot_max_bytes: int = 8 * 1024 * 1024 * 1024
    fpl_project_snapshot_max_files: int = 10_000

    @model_validator(mode="after")
    def validate_security(self) -> Settings:
        if not 1024 <= self.fpl_remote_web_port <= 65535:
            raise ValueError("远程 Web 端口必须位于 1024–65535")
        if self.fpl_remote_web_enabled:
            remote = urlsplit(self.fpl_remote_web_origin)
            if (
                remote.scheme != "https"
                or not remote.hostname
                or remote.username
                or remote.password
                or self.fpl_remote_web_origin != f"https://{remote.netloc}"
                or any(char.isspace() for char in remote.netloc)
            ):
                raise ValueError("远程 Web 必须配置精确 HTTPS 来源")
        if self.fpl_remote_web_root and not Path(self.fpl_remote_web_root).is_absolute():
            raise ValueError("远程 Web 构建目录必须为绝对路径")
        try:
            Fernet(self.fpl_secrets_key.encode("ascii"))
        except Exception as exc:
            raise ValueError("FPL_SECRETS_KEY must be a valid Fernet key") from exc
        if self.legacy_fpl_studio_token.strip():
            raise ValueError(
                "FPL_STUDIO_TOKEN is no longer supported; migrate to an account session "
                "or create a Management API Key through the account API"
            )
        if self.fpl_visual_asset_max_bytes < 1:
            raise ValueError("FPL_VISUAL_ASSET_MAX_BYTES must be positive")
        if self.fpl_galgame_export_max_bytes < 1:
            raise ValueError("FPL_GALGAME_EXPORT_MAX_BYTES must be positive")
        if (
            min(
                self.fpl_skill_archive_max_bytes,
                self.fpl_skill_expanded_max_bytes,
                self.fpl_skill_max_files,
            )
            < 1
        ):
            raise ValueError("Skill archive limits must be positive")
        if min(self.fpl_project_snapshot_max_bytes, self.fpl_project_snapshot_max_files) < 1:
            raise ValueError("Project snapshot limits must be positive")
        allowed_commands = [
            item.strip()
            for item in self.fpl_mcp_stdio_allowed_commands.split(os.pathsep)
            if item.strip()
        ]
        if any(not Path(item).is_absolute() for item in allowed_commands):
            raise ValueError("FPL_MCP_STDIO_ALLOWED_COMMANDS must contain absolute paths")
        if self.fpl_temp_media_upload_url:
            parsed_upload_url = urlsplit(self.fpl_temp_media_upload_url)
            if (
                parsed_upload_url.scheme != "https"
                or not parsed_upload_url.hostname
                or parsed_upload_url.username
                or parsed_upload_url.password
            ):
                raise ValueError(
                    "FPL_TEMP_MEDIA_UPLOAD_URL must be empty or an unauthenticated HTTPS URL"
                )
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def database_path(self) -> Path:
        configured = Path(self.fpl_database_path).expanduser()
        path = configured if configured.is_absolute() else REPO_ROOT / configured
        return path.resolve()

    @property
    def database_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.database_path.as_posix()}"

    @property
    def runtime_path(self) -> Path:
        return self.database_path.parent.resolve()

    @property
    def auth_cookie_secure(self) -> bool:
        return self.fpl_auth_cookie_secure

    def account_path(self, owner_user_id: str) -> Path:
        if (
            not owner_user_id
            or owner_user_id in {".", ".."}
            or Path(owner_user_id).name != owner_user_id
        ):
            raise ValueError("invalid account id")
        return (self.runtime_path / "accounts" / owner_user_id).resolve()

    def account_model_test_path(self, owner_user_id: str, kind: str) -> Path:
        if kind not in {"attachments", "generated", "references"}:
            raise ValueError("invalid model-test storage kind")
        return (self.account_path(owner_user_id) / "model-test" / kind).resolve()

    def account_skill_path(self, owner_user_id: str) -> Path:
        return (self.account_path(owner_user_id) / "integrations" / "skills").resolve()

    @property
    def mcp_stdio_allowed_commands(self) -> tuple[Path, ...]:
        return tuple(
            Path(item.strip()).expanduser().resolve()
            for item in self.fpl_mcp_stdio_allowed_commands.split(os.pathsep)
            if item.strip()
        )

    @property
    def profiles_path(self) -> Path:
        return (self.runtime_path / "profiles").resolve()

    @property
    def storage_trash_path(self) -> Path:
        return (self.runtime_path / ".trash").resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_cloud_settings() -> Settings:
    """Refresh only cloud configuration and the shared CLI connection settings."""
    base = get_settings()
    try:
        info = CONFIG_FILE.stat()
    except FileNotFoundError:
        configured = {}
    else:
        configured = _cloud_overrides(info.st_ino, info.st_mtime_ns, info.st_size)
    policy = os.getenv("FPL_IDENTITY_CLOUD_PROJECTION_DIR")
    commit = os.getenv("FPL_CLOUD_SETTINGS_COMMIT_DIR")
    if policy:
        if not commit:
            raise ConfigurationError("Identity 缺少云控配置提交目录")
        configured = {
            **configured,
            **CloudProjection("identity", Path(policy), Path(commit)).read(),
        }
    return base.model_copy(update=configured)


@lru_cache(maxsize=1)
def _cloud_overrides(*_fingerprint: int) -> dict:
    configured = Settings(_config_file=CONFIG_FILE)
    return {
        name: getattr(configured, name)
        for name in Settings.model_fields
        if name.startswith(("fpl_cloud_control_", "fpl_code_agents_"))
    }
