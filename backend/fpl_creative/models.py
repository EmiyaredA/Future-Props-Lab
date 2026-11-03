"""Creative-owned records; foreign account IDs are opaque in the service schema."""

from app.console.creative_workshop.models import CreativeInstallation, CreativeItem, CreativeRelease

MODELS = (CreativeItem, CreativeRelease, CreativeInstallation)
# Items are intentionally publicly queryable after publication; writes must use
# explicit origin-owner checks in Creative use cases. Installations remain private.
ACCOUNT_MODELS = (CreativeInstallation,)
