"""Run the Galgame project owner against its dedicated state directory."""

from fpl_runtime.project_owner_cli import run_project_owner

from .application import create_app
from .migrations.registry import MIGRATIONS


def main():
    run_project_owner("galgame", MIGRATIONS, create_app)


if __name__ == "__main__":
    main()
