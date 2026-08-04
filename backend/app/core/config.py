from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE), env_file_encoding="utf-8", extra="ignore"
    )

    app_host: str = "127.0.0.1"
    app_port: int = 9000
    fpl_database_path: str = ".runtime/future-props.db"
    cors_origins: str = "http://127.0.0.1:3000,http://localhost:3000"
    fpl_secrets_key: str = ""
    fpl_studio_token: str = ""
    fpl_visual_asset_max_bytes: int = 200 * 1024 * 1024
    fpl_temp_media_upload_url: str = "https://temp.sh/upload"

    @model_validator(mode="after")
    def validate_security(self) -> Settings:
        try:
            Fernet(self.fpl_secrets_key.encode("ascii"))
        except Exception as exc:
            raise ValueError("FPL_SECRETS_KEY must be a valid Fernet key") from exc
        if self.fpl_studio_token and len(self.fpl_studio_token) < 32:
            raise ValueError("FPL_STUDIO_TOKEN must contain at least 32 characters")
        if self.fpl_visual_asset_max_bytes < 1:
            raise ValueError("FPL_VISUAL_ASSET_MAX_BYTES must be positive")
        parsed_upload_url = urlsplit(self.fpl_temp_media_upload_url)
        if (
            parsed_upload_url.scheme != "https"
            or not parsed_upload_url.hostname
            or parsed_upload_url.username
            or parsed_upload_url.password
        ):
            raise ValueError("FPL_TEMP_MEDIA_UPLOAD_URL must be an unauthenticated HTTPS URL")
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
        return (self.database_path.parent / "visual-workshop" / "assets").resolve()

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
    return Settings()
