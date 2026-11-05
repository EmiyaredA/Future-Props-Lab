"""Public deterministic rendering exports are loaded only when requested."""

from importlib import import_module
from types import MappingProxyType

_EXPORTS = MappingProxyType(
    {
        "RenderCaptureFrame": ("contracts", "RenderCaptureFrame"),
        "RenderPlan": ("contracts", "RenderPlan"),
        "render_plan_frame": ("frame_renderer", "render_plan_frame"),
        "RenderCancelled": ("render_engine", "RenderCancelled"),
        "render_document": ("render_engine", "render_document"),
        "render_plan": ("render_engine", "render_plan"),
    }
)
__all__ = list(_EXPORTS)


def __getattr__(name):
    try:
        module, attribute = _EXPORTS[name]
    except KeyError:
        raise AttributeError(name) from None
    return getattr(import_module(__name__ + "." + module), attribute)
