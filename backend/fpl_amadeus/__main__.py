"""Start Amadeus with its own database and signed service ingress."""

from pathlib import Path

from fpl_runtime.native_ingress import NativeWorkerOptions
from fpl_runtime.project_owner_cli import run_project_owner

from .application import create_app
from .migrations.registry import MIGRATIONS


def installed_app(**settings):
    options = Path("/run/fpl/amadeus-native.json")
    native = (
        NativeWorkerOptions.model_validate_json(options.read_bytes()) if options.is_file() else None
    )
    return create_app(native_options=native, **settings)


def main():
    run_project_owner("amadeus", MIGRATIONS, installed_app)


if __name__ == "__main__":
    main()
