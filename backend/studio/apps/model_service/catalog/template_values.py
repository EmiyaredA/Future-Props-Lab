"""Encrypted template input and masked views; no governance storage or account ORM."""

from copy import deepcopy
from typing import Protocol

from studio.apps.model_service.catalog.metadata import categories_for_provider


class TemplateCipher(Protocol):
    """Deployment-owned encryption; only masked hints may leave the catalog."""

    def encrypt(self, value: str) -> str: ...

    def hint(self, value: str) -> str: ...


def template_view(payload, *, cipher: TemplateCipher):
    value = deepcopy(payload)
    for provider in value.get("providers", []):
        ciphertext = provider.pop("api_key_ciphertext", "")
        provider.pop("api_key", None)
        provider.pop("clear_api_key", None)
        provider.update(has_api_key=bool(ciphertext), api_key_hint=cipher.hint(ciphertext))
    return value


def prepare_template(body, current, *, cipher: TemplateCipher):
    old = {provider["template_key"]: provider for provider in current.get("providers", [])}
    value = body.model_dump()
    for provider, source in zip(value["providers"], body.providers, strict=True):
        for model in provider.get("models", []):
            model["categories"] = model.get("categories") or categories_for_provider(
                provider["kind"]
            )
        for field in ("api_key", "clear_api_key", "has_api_key", "api_key_hint"):
            provider.pop(field, None)
        provider["api_key_ciphertext"] = (
            cipher.encrypt(source.api_key)
            if source.api_key.strip()
            else ""
            if source.clear_api_key
            else old.get(source.template_key, {}).get("api_key_ciphertext", "")
        )
    return value
