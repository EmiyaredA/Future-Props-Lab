"""Start Amadeus with its own database and signed service ingress."""

from fpl_runtime.project_owner_cli import run_project_owner

from .application import create_app
from .migrations.registry import MIGRATIONS


def main():
    run_project_owner("amadeus", MIGRATIONS, create_app)


if __name__ == "__main__":
    main()
