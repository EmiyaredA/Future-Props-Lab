"""Start Amadeus with its own database and signed service ingress."""

from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.amadeus.application import create_app
from studio.assembly.independent.amadeus.maintenance import create_export_app, create_import_app
from studio.assembly.independent.project_cli import run_project_owner
from studio.assembly.independent.runtime_options import RuntimeLayout
from studio.runtime.http.agent_admission import AGENT_ADMISSION_MOUNT
from studio.runtime.http.native_ingress import NativeWorkerOptions


def installed_app(*, runtime=None, **settings):
    runtime = runtime or RuntimeLayout()
    options = runtime.path("/run/fpl/amadeus-native.json")
    native = (
        NativeWorkerOptions.model_validate_json(options.read_bytes()) if options.is_file() else None
    )
    return create_app(
        native_options=native, admission_root=runtime.path(AGENT_ADMISSION_MOUNT), **settings
    )


def main():
    run_project_owner(
        "amadeus", MIGRATIONS, installed_app, maintenance=(create_export_app, create_import_app)
    )


if __name__ == "__main__":
    main()
