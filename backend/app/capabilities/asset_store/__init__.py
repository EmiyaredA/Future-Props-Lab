"""Public exports are loaded on demand so a service imports only its own models/capabilities."""

from importlib import import_module
from types import MappingProxyType

_EXPORTS = MappingProxyType(
    {
        "VisualAssets": ("app.capabilities.asset_store.assets", "VisualAssets"),
        "asset_out": ("app.capabilities.asset_store.assets", "asset_out"),
        "folder_out": ("app.capabilities.asset_store.assets", "folder_out"),
        "AssetLibrary": ("app.capabilities.asset_store.library", "AssetLibrary"),
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
