from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from fpl_config import CONFIG_FILE, ConfigurationError, read_config

REPO_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[3]))
_desktop_settings: Settings | None = None


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
        # Sources are assembled once above, allowing desktop to opt out of ALL shell state.
        return (init_settings,)

    @classmethod
    def validate_file_values(cls, values: dict) -> Settings:
        from pydantic import ValidationError

        try:
            return cls(_config_file=None, _read_environment=False, **values)
        except ValidationError:
            raise ConfigurationError("配置校验失败，请检查加密密钥、地址和容量限制") from None

    fpl_database_path: str = ".runtime/future-props.db"
    fpl_interview_codex_enabled: bool = False
    fpl_interview_codex_executable: str = ""
    fpl_interview_codex_user_id: str = ""
    fpl_acceptance_model_workspace_id: str = ""
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
    def visual_asset_path(self) -> Path:
        """Legacy v1 asset root retained until explicit layout migration completes."""
        return (self.database_path.parent / "visual-workshop" / "assets").resolve()

    @property
    def runtime_path(self) -> Path:
        return self.database_path.parent.resolve()

    @property
    def auth_cookie_secure(self) -> bool:
        return self.fpl_auth_cookie_secure

    def workspace_path(self, workspace_id: str) -> Path:
        if not workspace_id or Path(workspace_id).name != workspace_id:
            raise ValueError("invalid workspace id")
        return (self.runtime_path / "workspaces" / workspace_id).resolve()

    def workspace_model_test_path(self, workspace_id: str, kind: str) -> Path:
        if kind not in {"attachments", "generated", "references"}:
            raise ValueError("invalid model-test storage kind")
        if workspace_id == "default":
            return (self.runtime_path / "model-test" / kind).resolve()
        return (self.workspace_path(workspace_id) / "model-test" / kind).resolve()

    def workspace_skill_path(self, workspace_id: str) -> Path:
        return (self.workspace_path(workspace_id) / "integrations" / "skills").resolve()

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
    def library_asset_path(self) -> Path:
        return (self.runtime_path / "library" / "assets").resolve()

    @property
    def applications_path(self) -> Path:
        return (self.runtime_path / "applications").resolve()

    @property
    def storage_trash_path(self) -> Path:
        return (self.runtime_path / ".trash").resolve()

    def visual_project_path(self, project_id: str) -> Path:
        return (self.applications_path / "visual-workshop" / "projects" / project_id).resolve()

    def galgame_project_path(self, project_id: str) -> Path:
        return (self.applications_path / "galgame-workshop" / "projects" / project_id).resolve()

    @property
    def model_test_attachment_path(self) -> Path:
        return (self.database_path.parent / "model-test" / "attachments").resolve()

    @property
    def model_test_generated_path(self) -> Path:
        return (self.database_path.parent / "model-test" / "generated").resolve()

    @property
    def model_test_reference_path(self) -> Path:
        return (self.database_path.parent / "model-test" / "references").resolve()


@lru_cache
def get_settings() -> Settings:
    return _desktop_settings or Settings()


def configure_desktop(settings: Settings) -> None:
    """Install explicit launch settings before importing database/application modules."""
    global _desktop_settings
    _desktop_settings = settings
    get_settings.cache_clear()
