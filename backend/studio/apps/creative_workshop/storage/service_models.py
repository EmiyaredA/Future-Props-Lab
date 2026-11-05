"""Creative-owned records; foreign account IDs are opaque in the service schema."""

from app.console.creative_workshop.models import CreativeInstallation, CreativeItem, CreativeRelease
from studio.apps.creative_workshop.storage.fence_records import (
    CreativeInstallCancellation,
    CreativeInstallFence,
)
from studio.apps.creative_workshop.storage.installation_records import CreativeInstallOperation

MODELS = (
    CreativeItem,
    CreativeRelease,
    CreativeInstallation,
    CreativeInstallOperation,
    CreativeInstallFence,
    CreativeInstallCancellation,
)
# Items are intentionally publicly queryable after publication; writes must use
# explicit origin-owner checks in Creative use cases. Installations remain private.
ACCOUNT_MODELS = (CreativeInstallation, CreativeInstallOperation)
