"""Public exports are loaded on demand so a service imports only its own models/capabilities."""

from importlib import import_module
from types import MappingProxyType

_EXPORTS = MappingProxyType(
    {
        "AuthSession": ("app.console.models.accounts", "AuthSession"),
        "ManagementApiKey": ("app.console.models.accounts", "ManagementApiKey"),
        "SecurityAuditEvent": ("app.console.models.accounts", "SecurityAuditEvent"),
        "User": ("app.console.models.accounts", "User"),
        "ModelTemplateSyncItem": ("app.console.models.model_templates", "ModelTemplateSyncItem"),
        "ModelTemplateSyncJob": ("app.console.models.model_templates", "ModelTemplateSyncJob"),
        "PlatformSetting": ("app.console.models.platform_governance", "PlatformSetting"),
        "RegistrationInviteCode": (
            "app.console.models.platform_governance",
            "RegistrationInviteCode",
        ),
        "RegistrationRedemption": (
            "app.console.models.platform_governance",
            "RegistrationRedemption",
        ),
        "RuntimeAdmission": ("app.console.models.runtime_admission", "RuntimeAdmission"),
    }
)

__all__ = list(_EXPORTS)


def __getattr__(name):
    try:
        module, attribute = _EXPORTS[name]
    except KeyError:
        raise AttributeError(name) from None
    return getattr(import_module(module), attribute)
