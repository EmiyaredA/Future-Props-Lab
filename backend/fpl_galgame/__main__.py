"""Run the Galgame project owner against its dedicated state directory."""

from pathlib import Path

from fpl_runtime.project_owner_cli import run_project_owner

from .application import create_app
from .migrations.registry import MIGRATIONS


def deployed_application(**settings):
    web = Path("/app/web")
    has_web = (web / "build.json").is_file()
    if not has_web and not (web / ".api-only").is_file():
        raise ValueError("Galgame 缺少已安装的浏览器程序")
    return create_app(
        web_root=web if has_web else None,
        schema_path=Path("/app/deploy/contracts/openapi.json") if has_web else None,
        **settings,
    )


def main():
    run_project_owner("galgame", MIGRATIONS, deployed_application)


if __name__ == "__main__":
    main()
