"""Public exports are loaded on demand so a service imports only its own models/capabilities."""

from importlib import import_module
from types import MappingProxyType

_EXPORTS = MappingProxyType(
    {
        "VisualAssets": ("app.capabilities.asset_store.assets", "VisualAssets"),
        "asset_out": ("app.capabilities.asset_store.assets", "asset_out"),
        "folder_out": ("app.capabilities.asset_store.assets", "folder_out"),
        "IncomingFile": ("app.capabilities.asset_store.incoming", "IncomingFile"),
        "AssetError": ("app.capabilities.asset_store.library", "AssetError"),
        "AssetLibrary": ("app.capabilities.asset_store.library", "AssetLibrary"),
        "download_filename": ("app.capabilities.asset_store.policy", "download_filename"),
        "ProjectFolderError": (
            "app.capabilities.asset_store.project_folders",
            "ProjectFolderError",
        ),
        "open_library_folder": (
            "app.capabilities.asset_store.project_folders",
            "open_library_folder",
        ),
        "open_project_folder": (
            "app.capabilities.asset_store.project_folders",
            "open_project_folder",
        ),
        "ExportedProjectSnapshot": (
            "app.capabilities.asset_store.project_snapshots",
            "ExportedProjectSnapshot",
        ),
        "ProjectSnapshotError": (
            "app.capabilities.asset_store.project_snapshots",
            "ProjectSnapshotError",
        ),
        "SnapshotAssetSource": (
            "app.capabilities.asset_store.project_snapshots",
            "SnapshotAssetSource",
        ),
        "StagedProjectSnapshot": (
            "app.capabilities.asset_store.project_snapshots",
            "StagedProjectSnapshot",
        ),
        "cleanup_snapshot_staging": (
            "app.capabilities.asset_store.project_snapshots",
            "cleanup_snapshot_staging",
        ),
        "export_project_snapshot": (
            "app.capabilities.asset_store.project_snapshots",
            "export_project_snapshot",
        ),
        "move_staged_asset": (
            "app.capabilities.asset_store.project_snapshots",
            "move_staged_asset",
        ),
        "stage_project_snapshot": (
            "app.capabilities.asset_store.project_snapshots",
            "stage_project_snapshot",
        ),
        "AssetStorage": ("app.capabilities.asset_store.storage", "AssetStorage"),
    }
)

__all__ = list(_EXPORTS)


def __getattr__(name):
    try:
        module, attribute = _EXPORTS[name]
    except KeyError:
        raise AttributeError(name) from None
    return getattr(import_module(module), attribute)
