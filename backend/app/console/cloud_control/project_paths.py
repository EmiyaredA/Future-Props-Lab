"""Project path boundaries shared by configuration and execution."""

from pathlib import Path

from fastapi import HTTPException

from app.runtime.config import REPO_ROOT
from fpl_config import CONFIG_FILE

PRIVATE_NAMES = {
    "config.toml",
    "credentials",
    "credentials.json",
    "secrets",
    "secrets.toml",
    "secrets.json",
    "node_modules",
    "accounts",
    "profiles",
    "__pycache__",
}
PRIVATE_SUFFIXES = (".pem", ".key", ".sqlite", ".sqlite3", ".db", ".p12")


def visible(name):
    return not (
        not name
        or name.startswith(".")
        or name.casefold() in PRIVATE_NAMES
        or name.casefold().endswith(PRIVATE_SUFFIXES)
    )


def validate_project_root(root, settings):
    root = Path(root)
    if not root.is_absolute() or len(root.parts) < 3:
        raise HTTPException(409, "项目目录不可用")
    try:
        resolved = root.resolve(strict=True)
    except (OSError, RuntimeError):
        raise HTTPException(409, "项目目录不可用") from None
    # macOS normalizes /var to /private/var, but project roots must be explicit.
    home = Path.home().resolve()
    database_root = settings.database_path.resolve().parent
    forbidden = (database_root, REPO_ROOT / ".runtime", CONFIG_FILE.resolve())
    if (
        not resolved.is_dir()
        or resolved != root
        or resolved
        in {
            home,
            home / "Projects",
            home / "Desktop",
            home / "Documents",
            home / "Downloads",
            Path("/private/var"),
        }
        or any(
            resolved.is_relative_to(path)
            for path in (
                home / "Library",
                Path("/System"),
                Path("/Library"),
                Path("/Applications"),
                Path("/private/etc"),
                Path("/usr"),
            )
        )
        or (len(resolved.parts) == 3 and resolved.parts[1] in {"Users", "Volumes"})
        or resolved in home.parents
        or any(resolved.is_relative_to(path) for path in forbidden)
        or any(
            path.is_relative_to(resolved)
            and all(visible(part) for part in path.relative_to(resolved).parts)
            for path in forbidden
        )
        or any(not visible(part) for part in resolved.parts[1:])
    ):
        raise HTTPException(409, "项目目录不可用")
    return resolved
